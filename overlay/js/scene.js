import { INK, SEAT, RANKCOL, R, charLook, chairBack, chairFront, drawChar, drawCrown, drawAura, badge, drawEffect, buildBackground, drawLights } from './art.js';

const MAX_FIELD_X_PAD = 14;
const WALK_SPEED = 20; // px logic / giây (đi dạo)
const RUN_SPEED = 46; // sau mốc tim
const VIP_SPEED = 80;
const JUMP_MS = 600;
const MAX_BUBBLES = 6; // số bong bóng tên hiển thị cùng lúc tối đa
const POLL_COL = ['#ff7eb6', '#5ee7ff']; // màu phe A (trái) và phe B (phải)

/**
 * Bố cục logic (pixel-art). Nội dung bắt đầu ngay mép trên của canvas, không có lề:
 * khi đưa vào OBS chỉ cần đặt vị trí nguồn Browser.
 * - stageTop: viền trên của sân (dải LED). Đầu và vương miện của VIP nhô LÊN TRÊN viền này (đè lên màn chiếu).
 * - Hệ số phóng S là số nguyên để pixel-art luôn nét.
 */
export function computeLayout(W, H, settings) {
  const landscape = W > H;
  const S = Math.max(1, Math.round(W / (landscape ? 480 : 270)));
  const Lw = Math.ceil(W / S);
  const Lh = Math.ceil(H / S);
  const stageTop = 20;
  const vipY = stageTop + 30; // ghế VIP ngồi cao: đầu cao ~38px nên nhô lên trên viền khoảng 8px
  const playTop = vipY + 44; // giữ để nhân vật dưới sân không che hàng chữ của ghế VIP
  const safeB = Math.round((Lh * (settings.safeBottomPct ?? 0)) / 100);
  // Giới hạn chiều cao vùng sân (px thật của canvas, 0 = tự động lấp đầy tới đáy)
  const fieldPx = Number(settings.fieldHeightPx) || 0;
  let playBottom = Math.max(Lh - safeB, playTop + 40);
  if (fieldPx > 0) playBottom = Math.min(playBottom, playTop + Math.max(40, Math.round(fieldPx / S)));
  const unit = Math.min(56, Lw * 0.2);
  const dx = [0, -unit, unit, -unit * 2, unit * 2];
  const dy = [0, 4, 4, 8, 8];
  const seats = dx.map((d, i) => ({ x: Lw / 2 + d, y: vipY + dy[i] }));
  return { W, H, Lw, Lh, S, landscape, stageTop, safeB, vipY, playTop, playBottom, seats };
}

const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n));
const trunc = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export class Scene {
  constructor({ main, W, H, settings, avatars, debug = false, showSafe = false }) {
    this.main = main;
    this.M = main.getContext('2d');
    this.avatars = avatars;
    this.debug = debug;
    this.showSafe = showSafe;
    this.chars = new Map();
    this.vips = new Map();
    this.fx = [];
    this.texts = [];
    this.offset = 0; // serverNow - Date.now()
    this.settings = settings;
    this.poll = null; // bình chọn 2 phe (xem StageEngine.#pollView)
    this.lookAllUntil = 0;
    this.nextLookAll = Date.now() + 8000;
    this.fps = 0;
    this.layout(W, H, settings);
  }

  layout(W, H, settings) {
    this.settings = { ...this.settings, ...settings };
    this.lay = computeLayout(W, H, this.settings);
    this.main.width = W;
    this.main.height = H;
    this.S = this.lay.S;
    this.avatars.setScale(this.S);
    this.bg = buildBackground(this.lay);
    // Vùng sân đổi: kéo những nhân vật đang đứng ngoài vùng mới trở vào
    const { Lw, playTop, playBottom } = this.lay;
    for (const ch of [...(this.chars?.values() ?? [])]) {
      if (ch.leaving) continue;
      ch.y = Math.max(playTop, Math.min(playBottom - 6, ch.y));
      ch.ty = Math.max(playTop, Math.min(playBottom - 6, ch.ty));
      ch.x = Math.max(-20, Math.min(Lw + 20, ch.x));
    }
  }

  get serverNow() {
    return Date.now() + this.offset;
  }

  // ------------------------------------------------------------------ bản đồ toạ độ
  fieldPos(p) {
    const { Lw, playTop, playBottom } = this.lay;
    return { x: MAX_FIELD_X_PAD + p.x * (Lw - MAX_FIELD_X_PAD * 2), y: playTop + p.y * (playBottom - 6 - playTop) };
  }
  edgePos(p) {
    const { Lw, playTop, playBottom } = this.lay;
    return { x: p.x < 0.5 ? -16 : Lw + 16, y: playTop + p.y * (playBottom - 6 - playTop) };
  }

  // ------------------------------------------------------------------ nạp trạng thái từ server
  #syncClock(serverNow) {
    if (serverNow) this.offset = serverNow - Date.now();
  }

  #newChar(key, name, avatarUrl) {
    const now = Date.now();
    return {
      key, name: name || '', avatarUrl: avatarUrl || '', look: charLook(key),
      x: 0, y: 0, tx: 0, ty: 0, state: 'idle', runUntil: 0, jumpT: 0, lookUntil: 0,
      nextLook: now + 4000 + Math.random() * 12000, nextWander: now + 1500 + Math.random() * 4000,
      greetUntil: 0, zUntil: 0, moveSeq: 0, leaving: false, side: null,
      // chỉ dành cho VIP
      rank: 0, giftTotal: 0, absent: false, seated: false,
      lead: false, // VIP đã bầu: rời ghế, xuống đứng làm "lead" của phe mình
    };
  }

  applySnapshot(s, initial) {
    this.#syncClock(s.serverNow);
    if (s.settings) this.#applySettings(s.settings);
    const keys = new Set(s.users.map((u) => u.key));
    for (const u of s.users) this.#upsert(u, !initial);
    // snapshot đầy đủ (reset / resync): người không còn trong danh sách biến mất ngay
    for (const k of [...this.chars.keys()]) if (!keys.has(k)) this.#drop(this.chars, k);
    this.#setVip(s.vip, initial);
    this.poll = s.poll || null;
  }

  applyPatch(p) {
    this.#syncClock(p.serverNow);
    if (p.settings) this.#applySettings(p.settings);
    for (const u of p.users) this.#upsert(u, true);
    if (p.vip) this.#setVip(p.vip, false);
    if (p.poll !== undefined) this.poll = p.poll; // null = bình chọn đã kết thúc
    for (const k of p.removed) {
      const ch = this.chars.get(k);
      if (ch) this.#leave(ch);
    }
    for (const e of p.effects) this.#effect(e);
  }

  #applySettings(st) {
    const old = [this.settings.safeBottomPct, this.settings.fieldHeightPx];
    this.settings = { ...this.settings, ...st };
    if (this.settings.safeBottomPct !== old[0] || this.settings.fieldHeightPx !== old[1]) this.layout(this.lay.W, this.lay.H, this.settings);
  }

  #drop(map, key) {
    map.delete(key);
    if (!this.chars.has(key) && !this.vips.has(key)) this.avatars.forget(key);
  }

  #upsert(u, anim) {
    let ch = this.chars.get(u.key);
    if (!ch && this.vips.has(u.key)) {
      // rời ghế VIP, quay lại sân
      ch = this.vips.get(u.key);
      this.vips.delete(u.key);
      ch.rank = 0;
      ch.seated = false;
      this.chars.set(u.key, ch);
    }
    const to = this.fieldPos(u.pos);
    if (!ch) {
      ch = this.#newChar(u.key, u.name, u.avatar);
      if (anim) {
        const fr = this.edgePos(u.from);
        ch.x = fr.x;
        ch.y = fr.y;
        ch.state = 'walk';
        ch.tx = to.x;
        ch.ty = to.y;
        ch.runUntil = Date.now() + 2500;
      } else {
        ch.x = ch.tx = to.x;
        ch.y = ch.ty = to.y;
      }
      this.chars.set(u.key, ch);
    } else if (u.moveSeq > ch.moveSeq) {
      ch.tx = to.x;
      ch.ty = to.y;
      ch.state = 'walk';
      ch.runUntil = Date.now() + 1400;
      ch.jumpT = Date.now();
    }
    if (u.name !== undefined) ch.name = u.name; // patch gọn không gửi lại tên/avatar nếu không đổi
    if (u.avatar !== undefined) ch.avatarUrl = u.avatar;
    ch.leaving = false;
    if (u.side !== undefined) ch.side = u.side; // 0 = phe A (nửa trái), 1 = phe B (nửa phải), null = tự do
    ch.moveSeq = u.moveSeq;
    ch.greetUntil = u.greetUntil;
    ch.zUntil = u.zUntil;
  }

  #leave(ch) {
    const { Lw } = this.lay;
    ch.leaving = true;
    ch.tx = ch.x < Lw / 2 ? -20 : Lw + 20;
    ch.ty = ch.y;
    ch.state = 'walk';
    ch.runUntil = Date.now() + 8000;
  }

  #setVip(list, initial) {
    const keys = new Set(list.map((v) => v.key));
    for (const [k, vc] of [...this.vips]) {
      if (keys.has(k)) continue;
      this.vips.delete(k);
      if (!this.chars.has(k)) {
        // bị Kick / vắng: đi ra khỏi sân
        vc.rank = 0;
        vc.seated = false;
        this.chars.set(k, vc);
        this.#leave(vc);
      }
    }
    for (const v of list) {
      const seat = this.lay.seats[v.rank - 1];
      let vc = this.vips.get(v.key);
      if (!vc) {
        const fromField = this.chars.get(v.key);
        if (fromField) {
          this.chars.delete(v.key);
          vc = fromField;
        } else {
          vc = this.#newChar(v.key, v.name, v.avatar);
          vc.x = seat.x;
          vc.y = this.lay.Lh + 16;
        }
        vc.leaving = false;
        vc.seated = false;
        this.vips.set(v.key, vc);
        if (initial) {
          vc.x = seat.x;
          vc.y = seat.y;
          vc.seated = true;
        }
      }
      if (vc.rank !== v.rank) vc.seated = vc.seated && initial;
      vc.rank = v.rank;
      vc.name = v.name;
      vc.avatarUrl = v.avatar;
      vc.giftTotal = v.giftTotal;
      vc.absent = v.absent;
      vc.tx = seat.x;
      vc.ty = seat.y;
      vc.lead = v.side === 0 || v.side === 1;
      vc.side = vc.lead ? v.side : null;
    }
    this.#placeLeads(list, initial);
  }

  /** VIP đã bầu rời ghế, xếp thành một hàng ở phía trên nửa sân của phe mình (theo hạng VIP). */
  #placeLeads(list, initial) {
    const { Lw, playTop } = this.lay;
    for (const side of [0, 1]) {
      const group = list.filter((v) => v.side === side).sort((a, b) => a.rank - b.rank);
      const n = group.length;
      const spacing = Math.min(28, (Lw / 2 - 20) / Math.max(1, n));
      const cx = Lw * (side ? 0.75 : 0.25);
      group.forEach((v, k) => {
        const vc = this.vips.get(v.key);
        if (!vc) return;
        vc.tx = cx + (k - (n - 1) / 2) * spacing;
        vc.ty = playTop + 14;
        vc.seated = false;
        if (initial) {
          vc.x = vc.tx;
          vc.y = vc.ty;
        }
      });
    }
  }

  #effect(e) {
    if (e.type === 'pollWin') {
      // phe thắng nhảy ăn mừng (hoà: không ai nhảy)
      const t0 = Date.now();
      if (e.side === 0 || e.side === 1) for (const c of [...this.chars.values(), ...this.vips.values()]) if (c.side === e.side) c.jumpT = t0;
      return;
    }
    const ch = this.chars.get(e.userKey) || this.vips.get(e.userKey);
    if (!ch) return;
    const now = Date.now();
    const { Lw } = this.lay;
    if (e.type === 'spawn') this.fx.push({ type: 'poof', x: Math.max(8, Math.min(Lw - 8, ch.x)), y: ch.y, t0: now, dur: 600 });
    else if (e.type === 'flash') this.fx.push({ type: 'flash', follow: ch, t0: now, dur: 1100 });
    else if (e.type === 'gift') this.texts.push({ text: `+${fmt(e.points)} ◆`, follow: ch, t0: now, dur: 1800 });
  }

  // ------------------------------------------------------------------ cập nhật
  update(dt) {
    const now = Date.now();
    const { Lw, playTop, playBottom } = this.lay;
    if (now > this.nextLookAll) {
      this.lookAllUntil = now + 2600;
      this.nextLookAll = now + 15000 + Math.random() * 8000;
    }
    const step = (ch, speed) => {
      const dx = ch.tx - ch.x;
      const dy = ch.ty - ch.y;
      const d = Math.hypot(dx, dy);
      if (d <= 0.8) return true;
      const s = Math.min(speed * dt, d);
      ch.x += (dx / d) * s;
      ch.y += (dy / d) * s;
      return false;
    };
    for (const [k, ch] of this.chars) {
      const arrived = step(ch, now < ch.runUntil ? RUN_SPEED : WALK_SPEED);
      if (arrived) {
        if (ch.leaving) {
          this.#drop(this.chars, k);
          continue;
        }
        ch.state = 'idle';
      }
      if (ch.state === 'idle' && !ch.leaving) {
        if (now > ch.nextLook) {
          ch.lookUntil = now + 2000;
          ch.nextLook = now + 9000 + Math.random() * 10000;
        }
        if (now > ch.nextWander) {
          ch.nextWander = now + 2500 + Math.random() * 4000;
          if (Math.random() < 0.5) {
            // đang bình chọn: chỉ đi dạo trong nửa sân của phe mình
            const lo = ch.side === 1 ? Lw / 2 + 4 : MAX_FIELD_X_PAD;
            const hi = ch.side === 0 ? Lw / 2 - 4 : Lw - MAX_FIELD_X_PAD;
            ch.tx = Math.max(lo, Math.min(hi, ch.x + (Math.random() - 0.5) * 70));
            ch.ty = Math.max(playTop, Math.min(playBottom - 6, ch.y + (Math.random() - 0.5) * 40));
            ch.state = 'walk';
            ch.runUntil = 0;
          }
        }
      }
    }
    for (const vc of this.vips.values()) {
      if (vc.seated) {
        vc.x = vc.tx;
        vc.y = vc.ty;
        continue;
      }
      const arrived = step(vc, VIP_SPEED);
      if (vc.lead) {
        vc.state = arrived ? 'idle' : 'walk'; // lead đứng tại chỗ (không ngồi lại ghế)
        continue;
      }
      if (arrived) {
        vc.seated = true;
        this.fx.push({ type: 'sparkle', x: vc.x, y: vc.y - 22, t0: now, dur: 900 });
      } else vc.state = 'walk';
    }
    this.fx = this.fx.filter((f) => now - f.t0 < f.dur);
    this.texts = this.texts.filter((f) => now - f.t0 < f.dur);
  }

  // ------------------------------------------------------------------ vẽ
  #charState(ch, now) {
    let jump = 0;
    let state = ch.state;
    if (ch.jumpT && now - ch.jumpT < JUMP_MS) {
      jump = Math.sin((Math.PI * (now - ch.jumpT)) / JUMP_MS) * 8;
      state = 'jump';
    } else if (state === 'idle' && (now < ch.lookUntil || now < this.lookAllUntil)) state = 'look';
    return { state, jump };
  }

  render() {
    const { M, lay } = this;
    const now = Date.now();
    const t = now / 1000;
    const sNow = this.serverNow;
    const labels = [];
    const bubbles = [];

    // đồ họa pixel-art vẽ thẳng lên canvas thật (phóng nguyên S lần, không làm mịn); avatar được vẽ nét ở độ phân giải thật
    M.setTransform(1, 0, 0, 1, 0, 0);
    M.clearRect(0, 0, this.main.width, this.main.height);
    M.setTransform(this.S, 0, 0, this.S, 0, 0);
    M.imageSmoothingEnabled = false;
    M.drawImage(this.bg, 0, 0);
    drawLights(M, lay, t);

    // ---- 5 ghế VIP (luôn hiện đủ, ghế trống để mời gọi)
    const seated = new Map();
    for (const vc of this.vips.values()) if (vc.seated) seated.set(vc.rank, vc);
    const walkingVips = [...this.vips.values()].filter((vc) => !vc.seated);
    for (let i = 0; i < 5; i++) {
      const s = SEAT[i];
      const seat = lay.seats[i];
      const vc = seated.get(i + 1);
      if (i === 0 && vc) drawAura(M, seat.x, seat.y - 20, t);
      if (!vc) M.globalAlpha = 0.65;
      chairBack(M, s, seat.x, seat.y);
      M.globalAlpha = 1;
      let info = null;
      if (vc) {
        const lookUp = now < this.lookAllUntil && !vc.absent;
        info = drawChar(M, vc.look, seat.x, seat.y - 1, 'sit', t, {
          noShadow: true, alpha: vc.absent ? 0.5 : 1, head: this.avatars.head(vc.key, vc.avatarUrl, lookUp),
        });
      }
      if (!vc) M.globalAlpha = 0.65;
      chairFront(M, s, seat.x, seat.y);
      M.globalAlpha = 1;
      badge(M, Math.round(seat.x + s.w / 2 - 1), seat.y - s.h - 1, vc ? RANKCOL[i] : '#59607a');
      if (i === 0 && vc && info) drawCrown(M, Math.round(seat.x), info.headTop, t);
      labels.push({ i, seat, s, vc });
    }

    // ---- bình chọn: tô nhạt hai nửa sân + vạch giữa (HUD chữ vẽ ở phần dưới)
    if (this.poll) {
      const mid = lay.Lw / 2;
      const h = lay.playBottom - lay.playTop;
      M.globalAlpha = 0.1;
      M.fillStyle = POLL_COL[0];
      M.fillRect(0, lay.playTop, mid, h);
      M.fillStyle = POLL_COL[1];
      M.fillRect(mid, lay.playTop, mid, h);
      M.globalAlpha = 0.35;
      M.fillStyle = '#ffffff';
      for (let y = lay.playTop; y < lay.playBottom; y += 6) M.fillRect(Math.floor(mid), y, 1, 3);
      M.globalAlpha = 1;
    }

    // ---- sân chơi: người dưới sân + VIP đang đi tới ghế, xếp theo trục Y (z-index), người vừa qua mốc nổi lên trên
    const field = [...this.chars.values(), ...walkingVips];
    const boost = (c) => (sNow < c.zUntil || c.lead ? 1000 : 0); // lead luôn nổi trên cùng
    field.sort((a, b) => a.y + boost(a) - (b.y + boost(b)));
    const leads = [];
    for (const ch of field) {
      const { state, jump } = this.#charState(ch, now);
      if (ch.lead) {
        // vòng sáng dưới chân theo màu phe + hào quang để lead nổi bật giữa đám đông
        M.globalAlpha = 0.55;
        M.fillStyle = POLL_COL[ch.side];
        M.fillRect(Math.round(ch.x) - 9, Math.round(ch.y) - 1, 18, 3);
        M.globalAlpha = 1;
        drawAura(M, ch.x, ch.y - 20, t);
      }
      const info = drawChar(M, ch.look, ch.x, ch.y, state, t, { jump, head: this.avatars.head(ch.key, ch.avatarUrl, state === 'look') });
      if (ch.lead) {
        drawCrown(M, Math.round(ch.x), info.headTop, t);
        leads.push(ch);
      }
      if (sNow < ch.greetUntil) bubbles.push({ ch, headTop: info.headTop });
    }

    // ---- hiệu ứng
    for (const f of this.fx) {
      const p = (now - f.t0) / f.dur;
      const pos = f.follow ? { x: f.follow.x, y: f.follow.y - 14 } : f;
      drawEffect(M, { ...f, x: pos.x, y: pos.y }, p);
    }

    // ---- chữ, bong bóng (vẽ ở độ phân giải thật)
    M.setTransform(1, 0, 0, 1, 0, 0);

    for (const { i, seat, s, vc } of labels) {
      if (!vc) continue;
      const ly = seat.y + 9;
      this.#text(String(i + 1), Math.round(seat.x + s.w / 2 - 1), seat.y - s.h - 1, 6, INK, 'transparent');
      this.#text(trunc(vc.name, 10), seat.x, ly, 7, '#ffffff');
      this.#text(`◆ ${fmt(vc.giftTotal)}`, seat.x, ly + 8, 6.5, RANKCOL[i]);
      if (vc.absent) this.#text('zZ', seat.x + 12, seat.y - 34, 7, '#c8d4ff');
    }
    for (const ch of leads) {
      this.#text(trunc(ch.name, 10), ch.x, ch.y + 8, 7, '#ffffff');
      this.#text(`◆ ${fmt(ch.giftTotal)}`, ch.x, ch.y + 16, 6.5, RANKCOL[Math.max(0, ch.rank - 1)]);
    }
    // Giảm rối khi phòng đông: tối đa MAX_BUBBLES bong bóng, ưu tiên cái mới nhất, không cho đè lên nhau
    bubbles.sort((a, b) => b.ch.greetUntil - a.ch.greetUntil);
    const placed = [];
    let shown = 0;
    for (const { ch, headTop } of bubbles) {
      if (shown >= MAX_BUBBLES) break;
      const name = trunc(ch.name, 10);
      const w = Math.max(34, name.length * 5.4 + 10);
      const x = Math.max(2, Math.min(lay.Lw - w - 2, ch.x - w / 2)); // không tràn ra mép màn hình
      const tx = Math.max(x + 4, Math.min(x + w - 4, ch.x)); // đuôi bong bóng luôn hướng về nhân vật
      let y = headTop - 14;
      const hit = (yy) => placed.some((r) => x < r.x + r.w + 1 && x + w + 1 > r.x && yy < r.y + 12 && yy + 12 > r.y);
      for (let k = 0; k < 3 && hit(y); k++) y -= 11; // thử đẩy lên trên
      if (hit(y)) continue;
      placed.push({ x, y, w });
      shown += 1;
      const S = this.S;
      M.fillStyle = '#fffbe8';
      M.strokeStyle = INK;
      M.lineWidth = 2;
      M.fillRect(x * S, y * S, w * S, 10 * S);
      M.strokeRect(x * S, y * S, w * S, 10 * S);
      M.beginPath();
      M.moveTo((tx - 2) * S, (y + 10) * S);
      M.lineTo((tx + 2) * S, (y + 10) * S);
      M.lineTo(tx * S, (y + 13) * S);
      M.fill();
      M.font = `700 ${6.5 * S}px "Pixelify Sans",monospace`;
      M.textAlign = 'center';
      M.textBaseline = 'middle';
      M.fillStyle = INK;
      M.fillText(name, (x + w / 2) * S, (y + 5.5) * S);
    }
    this.#drawPoll(sNow);
    for (const f of this.texts) {
      const p = (now - f.t0) / f.dur;
      M.globalAlpha = 1 - p * p;
      this.#text(f.text, f.follow.x, f.follow.y - 36 - p * 14, 7, '#ffe27a');
      M.globalAlpha = 1;
    }
    if (this.showSafe) {
      const sy = (lay.Lh - lay.safeB) * this.S;
      M.fillStyle = 'rgba(255,60,60,.28)';
      M.fillRect(0, sy, this.main.width, lay.safeB * this.S);
      M.strokeStyle = '#ff6b6b';
      M.setLineDash([8, 6]);
      M.lineWidth = 2;
      M.strokeRect(1, sy, this.main.width - 2, 1);
      M.setLineDash([]);
      this.#text('SAFE ZONE', lay.Lw / 2, lay.Lh - lay.safeB / 2, 7, '#ffffff');
    }
    if (this.debug) {
      this.#text(`${this.fps.toFixed(0)} fps · sân ${this.chars.size} · VIP ${this.vips.size}`, 4, 8, 6, '#5ee7ff', INK, 'left');
    }
  }

  /** HUD bình chọn: một dải mảnh ở mép trên cùng của overlay. Gọi khi transform đang ở độ phân giải thật. */
  #drawPoll(sNow) {
    const p = this.poll;
    if (!p) return;
    const { M, S, lay } = this;
    const { Lw, playTop } = lay;
    const [a, b] = p.counts;
    const total = a + b;
    const y = 5; // hàng chữ: sát mép trên cùng của overlay
    const barY = y + 5;
    const x0 = 6;
    const w = Lw - 12;
    // nền tối mờ phía sau để chữ luôn đọc được dù nhân vật/bong bóng tên đứng đè lên
    M.fillStyle = 'rgba(10,12,28,0.78)';
    M.fillRect(0, 0, lay.W, (y + 11) * S);
    // thanh tỉ lệ (chưa ai bầu: chia đôi)
    const aw = total ? Math.round((w * a) / total) : Math.round(w / 2);
    M.fillStyle = INK;
    M.fillRect((x0 - 1) * S, (barY - 1) * S, (w + 2) * S, 5 * S);
    M.fillStyle = POLL_COL[0];
    M.fillRect(x0 * S, barY * S, aw * S, 3 * S);
    M.fillStyle = POLL_COL[1];
    M.fillRect((x0 + aw) * S, barY * S, (w - aw) * S, 3 * S);
    // chữ: tên + số phiếu hai bên, giữa là câu hỏi + đồng hồ / kết quả
    this.#text(`${trunc(p.labels[0], 10)} ${a}`, x0, y, 6.5, POLL_COL[0], INK, 'left');
    this.#text(`${b} ${trunc(p.labels[1], 10)}`, x0 + w, y, 6.5, POLL_COL[1], INK, 'right');
    let mid;
    if (p.status === 'active') {
      const left = Math.max(0, Math.ceil((p.endsAt - sNow) / 1000));
      const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      mid = p.question ? `${trunc(p.question, 22)} ${clock}` : clock;
    } else {
      mid = p.result === 'tie' ? 'HÒA!' : `${trunc(p.labels[p.result], 12)} THẮNG!`;
    }
    this.#text(mid, Lw / 2, y, 6.5, p.status === 'active' ? '#ffffff' : '#ffe27a');
  }

  #text(s, lx, ly, size, color, stroke = INK, align = 'center') {
    const { M, S } = this;
    M.font = `700 ${size * S}px "Pixelify Sans",monospace`;
    M.textAlign = align;
    M.textBaseline = 'middle';
    M.lineJoin = 'round';
    M.lineWidth = Math.max(3, size * S * 0.3);
    M.strokeStyle = stroke;
    M.strokeText(s, lx * S, ly * S);
    M.fillStyle = color;
    M.fillText(s, lx * S, ly * S);
  }
}

export { R };
