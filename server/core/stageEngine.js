import { EventType } from '../../shared/events.js';
import { effectMs, tierIntensity, EFFECT_IDS, BURST_COOLDOWN_MS } from './heartEffects.js';

export const VIP_SEATS = 5;
const STREAK_TTL_MS = 60_000;
const MAX_EFFECTS_PER_PATCH = 60;
const MAX_TIER_PER_PATCH = 12;
const KEEP_EFFECTS = /^(vip|gift|tier|pollWin)/; // luôn giữ hiệu ứng VIP / quà / mốc tim / thắng poll
const TIER_KIND_RANK = { total: 3, burst: 2, preview: 1 };

/** Ưu tiên khi quá nhiều hiệu ứng mốc trong một patch: VIP > mốc tổng > dồn dập > xem thử, rồi độ mạnh. */
const tierPriority = (e) => (e.vip ? 1000 : 0) + (TIER_KIND_RANK[e.kind] || 0) * 10 + (e.intensity || 0);

function limitTier(list) {
  const tiers = list.filter((e) => e.type === 'tier');
  if (tiers.length <= MAX_TIER_PER_PATCH) return list;
  const keep = new Set([...tiers].sort((a, b) => tierPriority(b) - tierPriority(a)).slice(0, MAX_TIER_PER_PATCH));
  return list.filter((e) => e.type !== 'tier' || keep.has(e));
}

function capEffects(list) {
  if (list.length <= MAX_EFFECTS_PER_PATCH) return list;
  const keep = list.filter((e) => KEEP_EFFECTS.test(e.type));
  const rest = list.filter((e) => !KEEP_EFFECTS.test(e.type)).slice(0, Math.max(0, MAX_EFFECTS_PER_PATCH - keep.length));
  return [...keep, ...rest];
}

export const DEFAULT_SETTINGS = Object.freeze({
  heartsPerMove: 10, // vượt thêm mỗi N tim thì di chuyển + nổi lên
  idleTimeoutSec: 45, // ngừng tương tác quá lâu thì rời sân
  maxSlots: 30, // số nhân vật tối đa dưới sân (VIP không tính)
  minStaySec: 5, // người mới không được đẩy ra trước thời gian này (chống nhấp nháy khi sân đầy)
  vipMinGift: 1, // tổng diamond tối thiểu để được xét VIP
  vipAbsentSec: 300, // VIP không có event quá lâu -> trạng thái "vắng"
  vipAbsentPolicy: 'keep', // keep: giữ ghế | release: nhả ghế sau vipReleaseSec
  vipReleaseSec: 1800,
  zBoostSec: 12, // thời gian nổi lên trên cùng sau mốc tim
  greetSec: 3, // thời gian hiện tên lúc xuất hiện lần đầu
  actionGreetSec: 5, // follow / share / bình luận: hiện tên lâu hơn một chút
  actionCooldownSec: 10, // khoảng nghỉ giữa hai lần được thưởng cho cùng một người (chống spam)
  simulatedTtlSec: 30, // người xem test tự xoá (tính từ lần hoạt động cuối)
  tierTotal: Object.freeze([]), // [{hearts, effect}] mốc tích luỹ; rỗng = tắt
  tierBurst: Object.freeze([]), // [{hearts, windowSec, effect}] mốc dồn dập; rỗng = tắt
  tierSpotlight: 'light', // off | light | strong: đèn chiếu cho người đang diễn
  tierDim: false, // làm tối đám đông khi có người diễn
  fieldHeightPx: 0, // giới hạn chiều cao vùng sân dưới hàng VIP (px thật của canvas); 0 = tự động lấp đầy
  safeBottomPct: 0, // chừa trống ở đáy (% chiều cao); mặc định 0: không lề, chỉnh vị trí trong OBS
  giftValueOverrides: {}, // { giftId: diamond } ghi đè giá quà
});

/**
 * Trạng thái game của MỘT Stage. Thuần logic: không biết gì về socket / DB / connector.
 * Server là nguồn chân lý; overlay chỉ render từ snapshot + patch.
 *
 * Tọa độ nhân vật là chuẩn hoá 0..1 trong vùng sân chơi; overlay tự quy đổi ra pixel.
 */
export class StageEngine {
  constructor(stageId, settings = {}, { now = () => Date.now(), random = Math.random } = {}) {
    this.stageId = stageId;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.now = now;
    this.random = random;
    /** @type {Map<string, any>} */
    this.users = new Map();
    this.streaks = new Map(); // `${userKey}|${giftId}` -> { count, ts }
    this.vipKeys = [];
    this.visibleSet = new Set(); // userKey đang hiện dưới sân (không gồm VIP)
    this.seq = 0;
    this.dirty = false; // cần lưu DB
    this.#resetPatch();
    this._lastVipSig = '';
  }

  // ------------------------------------------------------------------ cấu hình
  setSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    this.#refreshVip(this.now());
    this.#enforceMaxSlots(this.now());
    this.patch.settings = true;
    this.dirty = true;
  }

  // ------------------------------------------------------------------ xử lý event
  handle(evt) {
    const now = this.now();
    switch (evt.eventType) {
      case EventType.JOIN:
        this.#onJoin(evt, now);
        break;
      case EventType.LIKE:
        this.#onLike(evt, now);
        break;
      case EventType.GIFT:
        this.#onGift(evt, now);
        break;
      case EventType.LEAVE:
        this.#onLeave(evt, now);
        break;
      case EventType.CHAT:
        this.#recordVote(evt, now); // ghi phiếu trước để nhân vật xuất hiện/di chuyển đúng phe
        this.#onAction(evt, now);
        this.#placeOnSide(evt.userKey, now);
        break;
      case EventType.FOLLOW:
      case EventType.SHARE:
        this.#onAction(evt, now);
        break;
      default:
        break;
    }
  }

  #getOrCreate(evt, now) {
    let u = this.users.get(evt.userKey);
    if (!u) {
      u = {
        userKey: evt.userKey,
        platform: evt.platform,
        userId: evt.userId,
        username: evt.username,
        avatar: evt.avatar,
        hearts: 0,
        giftTotal: 0,
        giftAt: 0,
        firstSeen: now,
        lastActive: now,
        greeted: false,
        greetUntil: 0,
        visible: false,
        spawnedAt: 0,
        pos: { x: 0.5, y: 0.5 },
        from: { x: 0.5, y: 1 },
        moveSeq: 0,
        zUntil: 0,
        leftAt: 0,
        lastActionAt: 0,
        kicked: false,
        simulated: false,
        expiresAt: 0,
        bw: [], // cửa sổ tim dồn dập (chỉ trong bộ nhớ)
        bwCool: 0,
      };
      if (evt.simulated) {
        u.simulated = true;
        u.expiresAt = now + this.settings.simulatedTtlSec * 1000;
      }
      this.users.set(u.userKey, u);
    }
    return u;
  }

  /** Cập nhật thông tin hiển thị + đánh dấu có hoạt động. */
  #touch(u, evt, now) {
    if ((evt.username && evt.username !== u.username) || (evt.avatar && evt.avatar !== u.avatar)) this.patch.fullViewKeys.add(u.userKey);
    if (evt.username) u.username = evt.username;
    if (evt.avatar) u.avatar = evt.avatar;
    u.lastActive = now;
    u.leftAt = 0;
    if (u.simulated && u.expiresAt) u.expiresAt = now + this.settings.simulatedTtlSec * 1000; // giữ người test sống khi đang được dùng
  }

  #onJoin(evt, now) {
    const u = this.users.get(evt.userKey);
    if (!u) return; // vào phòng chưa tương tác thì không tạo gì (giữ màn hình sạch)
    const wasAbsent = this.#isAbsent(u, now);
    this.#touch(u, evt, now);
    if (wasAbsent && this.vipKeys.includes(u.userKey)) this.patch.vip = true;
    this.#markUser(u);
  }

  #onLike(evt, now) {
    const count = Math.max(1, Math.floor(evt.value) || 1);
    const u = this.#getOrCreate(evt, now);
    this.#touch(u, evt, now);
    const prev = u.hearts;
    u.hearts += count;
    this.#activate(u, now);
    const n = Math.max(1, this.settings.heartsPerMove);
    // So sánh floor để không bỏ lỡ mốc khi nền tảng gộp nhiều lượt tap vào một event
    if (!this.vipKeys.includes(u.userKey) && Math.floor(u.hearts / n) > Math.floor(prev / n)) {
      this.#move(u, now);
    }
    this.#checkTiers(u, prev, count, now); // cả VIP đang ngồi cũng diễn
    this.#markUser(u);
    if (this.vipKeys.includes(u.userKey)) this.patch.vip = true;
  }

  /**
   * Follow / chia sẻ / bình luận: coi như đủ lượng tim cho mốc kế tiếp (nhân vật di chuyển, nổi lên),
   * đồng thời hiện tên lâu hơn một chút. Có khoảng nghỉ riêng cho từng người để chống spam.
   */
  #onAction(evt, now) {
    const u = this.#getOrCreate(evt, now);
    this.#touch(u, evt, now);
    const seated = this.vipKeys.includes(u.userKey);
    const rewarded = now - (u.lastActionAt || 0) >= this.settings.actionCooldownSec * 1000;
    const n = Math.max(1, this.settings.heartsPerMove);
    const prev = u.hearts;
    if (rewarded) {
      u.lastActionAt = now;
      u.hearts += n - (u.hearts % n); // đủ tim để chạm mốc kế tiếp
      if (!seated) {
        u.greeted = true;
        u.greetUntil = Math.max(u.greetUntil || 0, now + this.settings.actionGreetSec * 1000);
      }
    }
    if (!seated) {
      this.#activate(u, now);
      if (rewarded && u.visible && Math.floor(u.hearts / n) > Math.floor(prev / n)) this.#move(u, now);
    }
    if (u.hearts > prev) this.#checkTiers(u, prev, u.hearts - prev, now); // thưởng follow/share/bình luận cũng là tim
    this.#markUser(u);
    if (seated) this.patch.vip = true;
  }

  // ------------------------------------------------------------------ hiệu ứng theo mốc tim
  /**
   * Kiểm tra mốc tích luỹ và mốc dồn dập sau khi hearts tăng `added` (từ `prev`). Chạy cho mọi người, kể cả VIP đang ngồi.
   * Mốc tổng dựa trên việc hearts CẮT QUA ngưỡng trong chính sự kiện này nên restart hay sửa ngưỡng không làm bắn lại.
   * Một sự kiện vượt nhiều mốc chỉ phát mốc cao nhất; mốc tổng thắng mốc dồn dập.
   */
  #checkTiers(u, prev, added, now) {
    const total = this.settings.tierTotal;
    const burst = this.settings.tierBurst;
    if (!total?.length && !burst?.length) return;
    let fired = null;
    for (let i = (total?.length ?? 0) - 1; i >= 0; i--) {
      const t = total[i];
      if (prev < t.hearts && u.hearts >= t.hearts) {
        fired = { effect: t.effect, kind: 'total', level: i + 1, intensity: tierIntensity(i, total.length), hearts: t.hearts };
        break;
      }
    }
    if (burst?.length && added > 0 && now >= (u.bwCool || 0)) {
      const maxMs = Math.max(...burst.map((b) => b.windowSec)) * 1000;
      u.bw = (u.bw || []).filter((e) => now - e.t <= maxMs);
      u.bw.push({ t: now, n: added });
      if (!fired) {
        for (let i = burst.length - 1; i >= 0; i--) {
          const b = burst[i];
          const from = now - b.windowSec * 1000;
          let sum = 0;
          for (const e of u.bw) if (e.t >= from) sum += e.n;
          if (sum >= b.hearts) {
            fired = { effect: b.effect, kind: 'burst', level: i + 1, intensity: tierIntensity(i, burst.length), hearts: b.hearts };
            break;
          }
        }
      }
    }
    if (!fired) return;
    u.bw = [];
    u.bwCool = now + BURST_COOLDOWN_MS; // không bắn lại mỗi lần thả tim kế tiếp
    this.#pushTier(u, fired, now);
  }

  /**
   * Phát hiệu ứng mốc cho một người. Cũng kéo dài zUntil (nổi lên trên cùng) và greetUntil (bong bóng tên) suốt thời gian diễn.
   * Dedupe: mỗi người chỉ giữ một hiệu ứng mốc trong mỗi patch (ưu tiên tổng > dồn dập > xem thử, rồi độ mạnh).
   */
  #pushTier(u, fired, now) {
    const ms = effectMs(fired.effect);
    const seated = this.vipKeys.includes(u.userKey);
    const eff = { type: 'tier', userKey: u.userKey, effect: fired.effect, kind: fired.kind, level: fired.level, intensity: fired.intensity, hearts: fired.hearts, ms, vip: seated };
    const idx = this.patch.tierIdx.get(u.userKey);
    if (idx === undefined) {
      this.patch.tierIdx.set(u.userKey, this.patch.effects.length);
      this.patch.effects.push(eff);
    } else if (tierPriority(eff) >= tierPriority(this.patch.effects[idx])) {
      this.patch.effects[idx] = eff;
    }
    u.zUntil = Math.max(u.zUntil || 0, now + ms + 800);
    if (!seated) {
      u.greeted = true;
      u.greetUntil = Math.max(u.greetUntil || 0, now + ms + 800);
    }
    this.dirty = true;
  }

  /** Xem thử một hiệu ứng trên một người (Dashboard). Không đổi số tim. Trả false nếu không có người đó / hiệu ứng lạ. */
  previewTier(userKey, effect, intensity = 3) {
    const u = this.users.get(userKey);
    if (!u || !EFFECT_IDS.includes(effect)) return false;
    const now = this.now();
    this.#pushTier(u, { effect, kind: 'preview', level: 0, intensity: Math.min(3, Math.max(1, Math.round(intensity) || 1)), hearts: 0 }, now);
    this.#markUser(u);
    return true;
  }

  #onGift(evt, now) {
    const g = evt.gift;
    if (!g) return;
    const u = this.#getOrCreate(evt, now);
    this.#touch(u, evt, now);

    const delta = this.#giftDelta(evt.userKey, g, now);
    const diamond = this.settings.giftValueOverrides?.[g.giftId] ?? g.diamondValue ?? 0;
    const points = delta * diamond;
    if (points > 0) {
      u.giftTotal += points;
      u.giftAt = evt.timestamp || now; // người đạt mức trước thắng khi hoà
      u.kicked = false; // tặng quà mới thì được xét lại sau khi bị Kick
      this.patch.effects.push({ type: 'gift', userKey: u.userKey, points, giftName: g.giftName || '' });
    }
    this.#refreshVip(now);
    if (this.vipKeys.includes(u.userKey)) this.patch.vip = true; // điểm của người đang ngồi ghế đổi
    else this.#activate(u, now);
    this.#markUser(u);
    this.dirty = true;
  }

  /**
   * Phần quà MỚI cộng thêm từ event này.
   * Combo: repeatCount là số tích luỹ -> chỉ cộng phần chênh lệch với lần trước trong chuỗi.
   * Không combo: mỗi event tính theo repeatCount (mặc định 1).
   */
  #giftDelta(userKey, g, now) {
    if (!g.combo) return Math.max(1, g.repeatCount || 1);
    // Khoá theo groupId: hai lần tặng cùng loại quà (hai chuỗi khác nhau) phải được tính riêng
    const key = `${userKey}|${g.giftId}|${g.groupId || ''}`;
    const prev = this.streaks.get(key)?.count ?? 0;
    const cur = Math.max(1, g.repeatCount || 1);
    const delta = Math.max(0, cur - prev);
    if (g.streakEnded) this.streaks.delete(key);
    else this.streaks.set(key, { count: Math.max(prev, cur), ts: now });
    return delta;
  }

  #onLeave(evt, now) {
    const u = this.users.get(evt.userKey);
    if (!u) return;
    u.leftAt = now;
    if (this.vipKeys.includes(u.userKey)) {
      this.patch.vip = true;
      if (this.settings.vipAbsentPolicy === 'release') this.#refreshVip(now);
    } else if (u.visible) {
      this.#despawn(u, 'leave');
    }
    this.#markUser(u);
  }

  // ------------------------------------------------------------------ sân chơi
  #randPos(u) {
    const side = u ? this.#sideOf(u) : null;
    if (side === 0) return { x: 0.04 + this.random() * 0.42, y: this.random() };
    if (side === 1) return { x: 0.54 + this.random() * 0.42, y: this.random() };
    return { x: 0.05 + this.random() * 0.9, y: this.random() };
  }
  #edgePos() {
    return { x: this.random() < 0.5 ? 0 : 1, y: this.random() };
  }

  #activate(u, now) {
    if (this.vipKeys.includes(u.userKey)) return;
    if (!u.visible) {
      if (this.visibleSet.size >= this.settings.maxSlots) {
        // sân đầy: đẩy người tương tác cũ nhất (LRU) trong số đã ở đủ lâu; không có ai thì người mới chờ lượt sau
        const victim = this.#pickVictim(now);
        if (!victim) return;
        this.#despawn(victim, 'slots');
      }
      u.visible = true;
      this.visibleSet.add(u.userKey);
      this.patch.fullViewKeys.add(u.userKey);
      u.spawnedAt = now;
      u.from = this.#edgePos();
      u.pos = this.#randPos(u);
      this.patch.effects.push({ type: 'spawn', userKey: u.userKey });
      if (!u.greeted) {
        u.greeted = true; // tên chỉ hiện 1 lần duy nhất cho tới khi admin reset
        u.greetUntil = now + this.settings.greetSec * 1000;
      }
    }
    this.#enforceMaxSlots(now);
  }

  #pickVictim(now) {
    const minStay = this.settings.minStaySec * 1000;
    let best = null;
    for (const key of this.visibleSet) {
      const v = this.users.get(key);
      if (now - v.spawnedAt < minStay) continue;
      if (!best || v.lastActive < best.lastActive) best = v;
    }
    return best;
  }

  #move(u, now) {
    u.from = { ...u.pos };
    u.pos = this.#randPos(u);
    u.moveSeq += 1;
    u.zUntil = now + this.settings.zBoostSec * 1000;
    // một hiệu ứng chớp mỗi người trong mỗi patch (tránh bão hiệu ứng khi tim dồn dập)
    if (!this.patch.flashed.has(u.userKey)) {
      this.patch.flashed.add(u.userKey);
      this.patch.effects.push({ type: 'flash', userKey: u.userKey });
    }
  }

  #despawn(u, reason) {
    if (!u.visible) return;
    u.visible = false;
    this.visibleSet.delete(u.userKey);
    this.patch.removed.add(u.userKey);
    this.patch.users.delete(u.userKey);
    this.patch.effects.push({ type: 'despawn', userKey: u.userKey, reason });
    this.dirty = true;
  }

  /** Vượt Max Slots: ẩn người có lần tương tác gần nhất cũ nhất (LRU). Dữ liệu vẫn giữ. */
  #enforceMaxSlots(now) {
    const field = [...this.visibleSet].map((k) => this.users.get(k));
    let over = field.length - this.settings.maxSlots;
    if (over <= 0) return;
    field.sort((a, b) => a.lastActive - b.lastActive);
    for (const u of field) {
      if (over-- <= 0) break;
      this.#despawn(u, 'slots');
    }
  }

  // ------------------------------------------------------------------ VIP
  #isAbsent(u, now) {
    return u.leftAt > 0 || now - u.lastActive > this.settings.vipAbsentSec * 1000;
  }

  #isReleased(u, now) {
    if (this.settings.vipAbsentPolicy !== 'release') return false;
    return (u.leftAt > 0 && now - u.leftAt > 0) || now - u.lastActive > this.settings.vipReleaseSec * 1000;
  }

  #computeVipKeys(now) {
    const min = Math.max(1, this.settings.vipMinGift);
    return [...this.users.values()]
      .filter((u) => u.giftTotal >= min && !u.kicked && !this.#isReleased(u, now))
      .sort((a, b) => b.giftTotal - a.giftTotal || a.giftAt - b.giftAt || a.firstSeen - b.firstSeen)
      .slice(0, VIP_SEATS)
      .map((u) => u.userKey);
  }

  #refreshVip(now) {
    const next = this.#computeVipKeys(now);
    const prev = this.vipKeys;
    if (next.join('|') === prev.join('|')) return;
    this.vipKeys = next;
    this.patch.vip = true;
    this.dirty = true;
    for (const key of prev) {
      if (next.includes(key)) continue;
      const u = this.users.get(key);
      if (!u) continue;
      this.patch.effects.push({ type: 'vipUnseat', userKey: key });
      // trở lại sân nếu còn hoạt động gần đây
      if (!this.#isAbsent(u, now)) this.#activate(u, now);
    }
    next.forEach((key, i) => {
      const u = this.users.get(key);
      if (!u) return;
      if (!prev.includes(key)) {
        if (u.visible) this.#despawn(u, 'vip');
        this.patch.effects.push({ type: 'vipSeat', userKey: key, rank: i + 1 });
      } else if (prev.indexOf(key) !== i) {
        this.patch.effects.push({ type: 'vipMove', userKey: key, rank: i + 1 });
      }
    });
  }

  // ------------------------------------------------------------------ nhịp thời gian
  tick() {
    const now = this.now();
    // người xem test hết hạn
    for (const u of [...this.users.values()]) {
      if (u.simulated && u.expiresAt && now >= u.expiresAt) {
        this.#removeUser(u);
      }
    }
    // rời sân do không tương tác
    const idleMs = this.settings.idleTimeoutSec * 1000;
    for (const u of this.users.values()) {
      if (u.visible && now - u.lastActive > idleMs) this.#despawn(u, 'timeout');
    }
    // đổi trạng thái vắng / nhả ghế
    this.#refreshVip(now);
    const sig = this.vipKeys.map((k) => `${k}:${this.#isAbsent(this.users.get(k), now) ? 1 : 0}`).join('|');
    if (sig !== this._lastVipSig) {
      this._lastVipSig = sig;
      this.patch.vip = true;
    }
    // dọn chuỗi combo bỏ dở
    for (const [k, v] of this.streaks) if (now - v.ts > STREAK_TTL_MS) this.streaks.delete(k);
    this.#tickPoll(now);
  }

  // ------------------------------------------------------------------ bình chọn 2 phe
  #normText(s) {
    return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /** Phe của người dùng (0 = A, 1 = B) khi có poll; null nếu chưa bầu hoặc không có poll. */
  #sideOf(u) {
    return this.poll ? (this.poll.votes.get(u.userKey) ?? null) : null;
  }

  #pollView() {
    const p = this.poll;
    if (!p) return null;
    return {
      id: p.id,
      question: p.question,
      labels: p.labels,
      status: p.status,
      startedAt: p.startedAt,
      endsAt: p.endsAt,
      resultUntil: p.resultUntil,
      counts: [...p.counts],
      result: p.result, // 0 | 1 | 'tie' | null
    };
  }

  /**
   * Bắt đầu poll (thay poll đang có nếu còn). cfg đã được Hub kiểm tra; ở đây chỉ chuẩn hoá lại.
   * Không lưu DB: khởi động lại server thì poll kết thúc.
   */
  startPoll(cfg = {}) {
    const now = this.now();
    const labels = [String(cfg.labels?.[0] ?? 'A').slice(0, 16), String(cfg.labels?.[1] ?? 'B').slice(0, 16)];
    const keywords = [this.#normText(cfg.keywords?.[0] ?? '1'), this.#normText(cfg.keywords?.[1] ?? '2')];
    const durationSec = Math.min(600, Math.max(10, Number(cfg.durationSec) || 60));
    const resultSec = Math.min(60, Math.max(3, Number(cfg.resultSec) || 8));
    this.#clearPollUsers();
    this.patch.vip = true;
    this.poll = {
      id: `${now}-${Math.floor(this.random() * 1e6)}`,
      question: String(cfg.question ?? '').slice(0, 80),
      labels,
      keywords,
      resultSec,
      status: 'active',
      startedAt: now,
      endsAt: now + durationSec * 1000,
      resultUntil: 0,
      votes: new Map(),
      counts: [0, 0],
      result: null,
    };
    this.patch.poll = true;
    return this.#pollView();
  }

  /** Kết thúc ngay (chốt kết quả). */
  endPoll() {
    if (this.poll?.status !== 'active') return false;
    this.#finishPoll(this.now());
    return true;
  }

  /** Huỷ không hiện kết quả. */
  cancelPoll() {
    if (!this.poll) return false;
    this.#clearPollUsers();
    this.poll = null;
    this.patch.poll = true;
    this.patch.vip = true; // VIP trở lại ghế
    return true;
  }

  /** Gửi lại view cho mọi người đang hiện dưới sân để bỏ nhãn phe. */
  #clearPollUsers() {
    if (!this.poll) return;
    const keys = [...this.poll.votes.keys()];
    this.poll = null;
    for (const k of keys) {
      const u = this.users.get(k);
      if (u) this.#markUser(u);
    }
  }

  #recordVote(evt) {
    const p = this.poll;
    if (!p || p.status !== 'active') return;
    const t = this.#normText(evt.text);
    if (!t) return;
    const side = t === p.keywords[0] ? 0 : t === p.keywords[1] ? 1 : -1;
    if (side < 0) return;
    const prev = p.votes.get(evt.userKey);
    if (prev === side) return;
    if (prev !== undefined) p.counts[prev] -= 1;
    p.votes.set(evt.userKey, side);
    p.counts[side] += 1;
    this.patch.poll = true;
    if (this.vipKeys.includes(evt.userKey)) this.patch.vip = true; // VIP đổi phe: overlay cập nhật vị trí lead
  }

  /** Đưa nhân vật đã bầu về đúng nửa sân (đổi phe hoặc đang đứng sai phía). */
  #placeOnSide(userKey, now) {
    const u = this.users.get(userKey);
    if (!u || !u.visible || this.vipKeys.includes(userKey)) return;
    const side = this.#sideOf(u);
    if (side === null) return;
    const wrong = side === 0 ? u.pos.x > 0.46 : u.pos.x < 0.54;
    if (!wrong) return;
    u.from = { ...u.pos };
    u.pos = this.#randPos(u);
    u.moveSeq += 1;
    this.#markUser(u);
  }

  #finishPoll(now) {
    const p = this.poll;
    p.status = 'result';
    p.result = p.counts[0] === p.counts[1] ? 'tie' : p.counts[0] > p.counts[1] ? 0 : 1;
    p.resultUntil = now + p.resultSec * 1000;
    this.patch.poll = true;
    this.patch.effects.push({ type: 'pollWin', side: p.result === 'tie' ? null : p.result });
  }

  #tickPoll(now) {
    const p = this.poll;
    if (!p) return;
    if (p.status === 'active' && now >= p.endsAt) this.#finishPoll(now);
    else if (p.status === 'result' && now >= p.resultUntil) this.cancelPoll();
  }

  #removeUser(u) {
    const wasVip = this.vipKeys.includes(u.userKey);
    if (u.visible) this.#despawn(u, 'expired');
    this.users.delete(u.userKey);
    if (wasVip) this.#refreshVip(this.now());
    this.dirty = true;
  }

  // ------------------------------------------------------------------ lệnh admin
  kick(userKey) {
    const u = this.users.get(userKey);
    if (!u) return false;
    u.kicked = true;
    this.#refreshVip(this.now());
    this.#markUser(u);
    this.dirty = true;
    return true;
  }

  /** Xoá nhân vật dưới sân. `hearts` = true: xoá cả số tim đã tích luỹ. */
  resetStage({ hearts = false } = {}) {
    for (const u of this.users.values()) {
      if (this.vipKeys.includes(u.userKey)) continue;
      u.visible = false;
      this.visibleSet.delete(u.userKey);
      if (hearts) {
        u.hearts = 0;
        u.greeted = false;
        u.greetUntil = 0;
        u.moveSeq = 0;
        u.zUntil = 0;
        u.bw = [];
        u.bwCool = 0;
      }
    }
    this.#fullSync();
  }

  /** Xoá bảng xếp hạng quà (đầu phiên live mới). */
  resetVip() {
    for (const u of this.users.values()) {
      u.giftTotal = 0;
      u.giftAt = 0;
      u.kicked = false;
    }
    this.streaks.clear();
    this.vipKeys = [];
    this._lastVipSig = '';
    this.#fullSync();
  }

  /** Xoá toàn bộ dữ liệu của Stage. */
  resetAll() {
    this.poll = null;
    this.users.clear();
    this.visibleSet.clear();
    this.streaks.clear();
    this.vipKeys = [];
    this._lastVipSig = '';
    this.#fullSync();
  }

  #fullSync() {
    this.#resetPatch();
    this.patch.full = true;
    this.dirty = true;
  }

  // ------------------------------------------------------------------ xuất dữ liệu
  /** Bản gọn (không tên/avatar) cho patch của người đã có trên overlay: giảm băng thông. */
  #slimView(u) {
    return { key: u.userKey, hearts: u.hearts, pos: u.pos, from: u.from, moveSeq: u.moveSeq, zUntil: u.zUntil, greetUntil: u.greetUntil, side: this.#sideOf(u) };
  }

  #fieldView(u) {
    return {
      key: u.userKey,
      name: u.username,
      avatar: u.avatar,
      hearts: u.hearts,
      pos: u.pos,
      from: u.from,
      moveSeq: u.moveSeq,
      zUntil: u.zUntil,
      spawnedAt: u.spawnedAt,
      greetUntil: u.greetUntil,
      simulated: u.simulated,
      side: this.#sideOf(u),
    };
  }

  #vipView(now) {
    return this.vipKeys.map((k, i) => {
      const u = this.users.get(k);
      return {
        rank: i + 1,
        key: u.userKey,
        name: u.username,
        avatar: u.avatar,
        giftTotal: u.giftTotal,
        absent: this.#isAbsent(u, now),
        simulated: u.simulated,
        side: this.#sideOf(u), // VIP đã bầu: xuống sân làm "lead" của phe mình
      };
    });
  }

  /** Ảnh chụp đầy đủ: gửi cho overlay khi kết nối / refresh. */
  snapshot() {
    const now = this.now();
    return {
      stageId: this.stageId,
      serverNow: now,
      seq: this.seq,
      settings: this.settings,
      users: [...this.visibleSet].map((k) => this.#fieldView(this.users.get(k))),
      vip: this.#vipView(now),
      poll: this.#pollView(),
    };
  }

  #markUser(u) {
    if (u.visible && !this.vipKeys.includes(u.userKey)) {
      this.patch.users.set(u.userKey, this.patch.fullViewKeys.has(u.userKey) ? this.#fieldView(u) : this.#slimView(u));
      this.patch.removed.delete(u.userKey);
    }
    this.dirty = true;
  }

  #resetPatch() {
    this.patch = { full: false, users: new Map(), removed: new Set(), vip: false, settings: false, poll: false, effects: [], flashed: new Set(), fullViewKeys: new Set(), tierIdx: new Map() };
  }

  /** Lấy và xoá các thay đổi tích luỹ; null nếu không có gì. Hub gọi định kỳ (~10 lần/giây) để gộp event. */
  drainPatch() {
    const p = this.patch;
    const empty = !p.full && !p.users.size && !p.removed.size && !p.vip && !p.settings && !p.poll && !p.effects.length;
    if (empty) return null;
    this.#resetPatch();
    this.seq += 1;
    if (p.full) return { full: true, ...this.snapshot() };
    const now = this.now();
    return {
      full: false,
      seq: this.seq,
      serverNow: now,
      users: [...p.users.values()],
      removed: [...p.removed],
      vip: p.vip ? this.#vipView(now) : undefined,
      settings: p.settings ? this.settings : undefined,
      poll: p.poll ? this.#pollView() : undefined, // null = poll đã kết thúc
      effects: capEffects(limitTier(p.effects)),
    };
  }

  // ------------------------------------------------------------------ lưu / nạp
  exportUsers() {
    // bw / bwCool chỉ ở trong bộ nhớ nên không lưu
    return [...this.users.values()].map(({ bw, bwCool, ...rest }) => rest);
  }

  importUsers(rows) {
    this.users.clear();
    this.visibleSet.clear();
    for (const r of rows) {
      r.bw = [];
      r.bwCool = 0;
      this.users.set(r.userKey, r);
      if (r.visible) this.visibleSet.add(r.userKey);
    }
    this.vipKeys = this.#computeVipKeys(this.now());
    this._lastVipSig = '';
    this.dirty = false;
  }

  /** Thông tin cho Dashboard. */
  adminState() {
    const now = this.now();
    return {
      vip: this.#vipView(now),
      fieldCount: this.visibleSet.size,
      userCount: this.users.size,
      poll: this.#pollView(),
    };
  }
}
