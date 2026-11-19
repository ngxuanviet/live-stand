// Đồ họa pixel-art chibi vẽ bằng code (không dùng asset có sẵn). Nguồn gốc: design/mockup.html.
// Mọi hàm vẽ nhận ngữ cảnh 2D của canvas "logic" (độ phân giải thấp), sau đó được phóng nguyên lên màn hình.

export const INK = '#1a1530';
export const FACE = 20;
export const HEAD = 26;

export const JERSEY = [
  { m: '#e63946', t: '#f4f4f4' }, { m: '#2a9df4', t: '#f4f4f4' }, { m: '#ffd23f', t: '#1a1530' }, { m: '#3ddc97', t: '#1a1530' },
  { m: '#ff8fab', t: '#f4f4f4' }, { m: '#f4f4f4', t: '#e63946' }, { m: '#ff7a1a', t: '#1a1530' }, { m: '#9b5de5', t: '#ffd23f' },
];
const PANTS = ['#2b2f55', '#1d3a6b', '#3b2a22', '#222222', '#2b4a3b'];
const SKINS = ['#ffd9b8', '#f5c299', '#e0a878', '#c98a5a', '#a8693a'];
const HAIRS = ['#2a1a12', '#4a2c1a', '#8a5a2b', '#e0b44a', '#d64a6a', '#2a6fd6', '#1a1a1a'];

export const SEAT = [
  { w: 30, h: 28, main: '#d9a521', dark: '#a8741a', light: '#ffe27a', cush: '#c62f3e' },
  { w: 24, h: 24, main: '#8fa8c9', dark: '#5d7396', light: '#d9e6f7', cush: '#2a6fd6' },
  { w: 24, h: 24, main: '#8fa8c9', dark: '#5d7396', light: '#d9e6f7', cush: '#2a6fd6' },
  { w: 22, h: 22, main: '#c98a5a', dark: '#8a5a34', light: '#efc79c', cush: '#2fa36b' },
  { w: 22, h: 22, main: '#c98a5a', dark: '#8a5a34', light: '#efc79c', cush: '#2fa36b' },
];
export const RANKCOL = ['#ffd23f', '#d9e6f7', '#efc79c', '#a6e3c4', '#a6e3c4'];
const CROWN = ['g....g....g', 'gg..ggg..gg', 'ggggggggggg', 'gdgdgrgdgdg', 'ddddddddddd'];

// ---------------------------------------------------------------- tiện ích
export function hash(s) {
  let h = 2166136261;
  for (const ch of String(s)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function R(c, x, y, w, h, col) {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), w, h);
}

function disc(c, cx, cy, r, col) {
  for (let y = 0; y < HEAD; y++) for (let x = 0; x < HEAD; x++) if (Math.hypot(x - cx + 0.5, y - cy + 0.5) <= r) R(c, x, y, 1, 1, col);
}
function rows(c, rs, col) {
  for (const [x, y, w] of rs) R(c, x, y, w, 1, col);
}

/** Đặc điểm nhân vật ổn định theo userKey (áo, quần, tông da tay, nhịp hoạt ảnh). */
export function charLook(userKey) {
  const h = hash(userKey);
  return { team: h % 8, pants: (h >> 3) % 5, skin: SKINS[(h >> 5) % 4], ph: (h % 100) / 10 };
}

// ---------------------------------------------------------------- đầu = tóc/mũ + avatar làm mặt
export function plainFace(seed) {
  const r = rng(hash(seed));
  const cv = document.createElement('canvas');
  cv.width = cv.height = FACE;
  const c = cv.getContext('2d');
  const skin = SKINS[Math.floor(r() * 5)];
  for (let y = 0; y < FACE; y++)
    for (let x = 0; x < FACE; x++) {
      const d = Math.hypot(x - 9.5, y - 9.5);
      if (d > 9.7) continue;
      let col = d > 8.5 ? INK : skin;
      if (d <= 8.5) {
        if ((x === 6 || x === 13) && (y === 9 || y === 10)) col = INK;
        if ((x === 4 || x === 15) && y === 12) col = '#ff9aa8';
        if ((x === 9 || x === 10) && y === 14) col = '#c1495a';
      }
      R(c, x, y, 1, 1, col);
    }
  return cv;
}

/** Ảnh người xem -> mặt 20x20: cắt tròn (lệch lên để lấy mặt), giảm màu, viền tối. */
export function processFace(img) {
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  const s = Math.min(nw, nh);
  const sx = (nw - s) / 2;
  const sy = (nh - s) * 0.3;
  const a = document.createElement('canvas');
  a.width = a.height = FACE * 2;
  const ac = a.getContext('2d');
  ac.imageSmoothingQuality = 'high';
  ac.drawImage(img, sx, sy, s, s, 0, 0, FACE * 2, FACE * 2);
  const b = document.createElement('canvas');
  b.width = b.height = FACE;
  const bc = b.getContext('2d');
  bc.imageSmoothingQuality = 'high';
  bc.drawImage(a, 0, 0, FACE * 2, FACE * 2, 0, 0, FACE, FACE);
  try {
    const d = bc.getImageData(0, 0, FACE, FACE);
    const p = d.data;
    for (let i = 0; i < p.length; i++) if (i % 4 !== 3) p[i] = Math.round((p[i] / 255) * 5) * 51;
    bc.putImageData(d, 0, 0);
  } catch {
    /* canvas bị tainted: bỏ qua bước giảm màu */
  }
  const o = document.createElement('canvas');
  o.width = o.height = FACE;
  const oc = o.getContext('2d');
  for (let y = 0; y < FACE; y++)
    for (let x = 0; x < FACE; x++) {
      const d = Math.hypot(x - 9.5, y - 9.5);
      if (d > 9.7) continue;
      if (d > 8.5) R(oc, x, y, 1, 1, INK);
      else oc.drawImage(b, x, y, 1, 1, x, y, 1, 1);
    }
  return o;
}

/**
 * Ảnh người xem -> mặt độ phân giải CAO (px x px): cắt tròn (lệch lên để lấy mặt), viền tối mảnh.
 * Không giảm màu, không pixel hoá: được vẽ nguyên điểm ảnh lên canvas thật nên nét hơn nhiều so với avatar 20x20.
 */
export function processFaceHi(img, px) {
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  const s = Math.min(nw, nh);
  const sx = (nw - s) / 2;
  const sy = (nh - s) * 0.3;
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const c = cv.getContext('2d');
  const ring = Math.max(1, Math.round(px / FACE)); // viền dày ~1 pixel logic
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  c.save();
  c.beginPath();
  c.arc(px / 2, px / 2, px / 2 - ring / 2, 0, Math.PI * 2);
  c.clip();
  try {
    c.filter = 'contrast(1.06) saturate(1.08)'; // hơi tăng độ nét/sắc cho ảnh nhỏ
  } catch {
    /* trình duyệt không hỗ trợ filter */
  }
  c.drawImage(img, sx, sy, s, s, 0, 0, px, px);
  c.restore();
  c.beginPath();
  c.arc(px / 2, px / 2, px / 2 - ring / 2, 0, Math.PI * 2);
  c.lineWidth = ring;
  c.strokeStyle = INK;
  c.stroke();
  return cv;
}

/** Bản mặt bị nén theo chiều dọc (dùng khi nhân vật ngước lên). */
export function squashFace(face, k = 0.8) {
  const cv = document.createElement('canvas');
  cv.width = face.width;
  cv.height = Math.round(face.height * k);
  const c = cv.getContext('2d');
  c.imageSmoothingQuality = 'high';
  c.drawImage(face, 0, 0, cv.width, cv.height);
  return cv;
}

/**
 * Dựng hai lớp của đầu 26x26 (pixel-art): lớp SAU (tóc, vòng đầu) và lớp TRƯỚC (tóc mái, vành mũ).
 * Khuôn mặt (avatar) được vẽ xen giữa hai lớp ở độ phân giải thật. Tham số look = ngước lên.
 */
export function buildHeadLayers(userKey, look) {
  const r = rng(hash(userKey + 'h'));
  const mk = () => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = HEAD;
    return cv;
  };
  const back = mk();
  const front = mk();
  const b = back.getContext('2d');
  const c = front.getContext('2d');
  const hair = HAIRS[Math.floor(r() * 7)];
  const style = Math.floor(r() * 6);
  const T = JERSEY[Math.floor(r() * 8)];
  disc(b, 13, 13, 13, INK);
  disc(b, 13, 13, 12, hair);
  if (look) {
    R(b, 8, 19, 10, 2, '#e7b995'); // cằm lộ ra khi ngước
    R(b, 9, 21, 8, 1, '#c99874');
    c.globalAlpha = 0.22; // ánh sáng từ màn chiếu hắt lên mặt
    disc(c, 13, 10, 8, '#cfeaff');
    c.globalAlpha = 1;
    R(c, 10, 4, 3, 1, '#ffffffcc');
  }
  const dome = (col) => {
    const rs = [[8, 0, 10], [5, 1, 16], [4, 2, 18], [3, 3, 20], [3, 4, 20], [3, 5, 20]];
    rows(c, rs.map(([x, y, w]) => [x - 1, y, w + 2]), INK);
    rows(c, [[8, -1, 10]], INK);
    rows(c, rs, col);
  };
  if (style === 0) {
    R(c, 7, 4, 12, 3, hair); R(c, 3, 9, 2, 3, hair); R(c, 21, 9, 2, 3, hair); R(c, 12, 4, 2, 1, '#ffffff44');
  } else if (style === 1) {
    dome(T.m); rows(c, [[2, 5, 22], [2, 6, 22], [2, 7, 22], [2, 8, 22]], INK); rows(c, [[3, 6, 20], [3, 7, 20]], T.t); R(c, 12, 0, 2, 1, T.t);
  } else if (style === 2) {
    disc(c, 13, 2, 3.2, INK); disc(c, 13, 2, 2.2, hair); R(c, 7, 4, 12, 2, hair); R(c, 3, 9, 2, 3, hair); R(c, 21, 9, 2, 3, hair);
  } else if (style === 3) {
    dome(T.t); rows(c, [[2, 5, 22], [2, 6, 22], [2, 7, 22], [2, 8, 22]], INK); rows(c, [[3, 6, 20], [3, 7, 20]], T.m); R(c, 3, 3, 20, 1, T.m);
    disc(c, 13, 1, 2.3, INK); disc(c, 13, 1, 1.5, '#f4f4f4');
  } else if (style === 4) {
    R(c, 7, 4, 12, 2, hair); R(c, 3, 7, 20, 4, INK); R(c, 3, 8, 20, 2, '#e63946'); R(c, 22, 7, 3, 5, INK); R(c, 22, 8, 2, 3, '#e63946');
  } else {
    R(c, 2, 8, 2, 7, hair); R(c, 22, 8, 2, 7, hair); R(c, 11, 0, 4, 3, INK); R(c, 12, 1, 2, 2, hair); R(c, 7, 4, 12, 2, hair);
  }
  return { back, front };
}

/** Vẽ đầu: lớp sau (pixel) -> mặt (avatar nét / mặt giả pixel) -> lớp trước (pixel). */
function drawHead(c, parts, fx, ht) {
  const x = fx - 13;
  c.drawImage(parts.back, x, ht);
  const fy = ht + (parts.look ? 3 : 5);
  const fh = parts.look ? 16 : FACE;
  c.imageSmoothingEnabled = !!parts.smooth;
  c.drawImage(parts.face, x + 3, fy, FACE, fh);
  c.imageSmoothingEnabled = false;
  c.drawImage(parts.front, x, ht);
}

// ---------------------------------------------------------------- nhân vật
/**
 * Vẽ một nhân vật. (fx, fy) = tâm chân. Trả về { headTop, tt }.
 * state: idle | walk | sit | jump | look.   o: { head (canvas 26x26), jump (px), alpha, noShadow }
 */
export function drawChar(c, look, fx, fy, state, t, o = {}) {
  fx = Math.round(fx);
  fy = Math.round(fy);
  const alpha = o.alpha == null ? 1 : o.alpha;
  c.globalAlpha = alpha;
  const J = JERSEY[look.team];
  let dn = 0, lL = 0, lR = 0, aL = 0, aR = 0;
  const jump = o.jump || 0;
  const up = state === 'jump';
  if (state === 'idle' || state === 'sit' || state === 'look') dn = Math.floor(t * 2.5 + look.ph) % 2;
  if (state === 'walk') {
    const f = Math.floor(t * 8 + look.ph) % 4;
    dn = f % 2;
    lL = f === 1 ? -1 : 0;
    lR = f === 3 ? -1 : 0;
    aL = f === 1 ? 1 : f === 3 ? -1 : 0;
    aR = -aL;
  }
  const y0 = fy - jump;
  if (!o.noShadow) {
    c.globalAlpha = alpha * (jump ? 0.5 : 0.9);
    R(c, fx - 6, fy - 1, 12, 2, 'rgba(0,0,0,.38)');
    R(c, fx - 4, fy + 1, 8, 1, 'rgba(0,0,0,.38)');
    c.globalAlpha = alpha;
  }
  const tt = y0 - 14 + dn;
  if (state !== 'sit') {
    for (const [x, l] of [[fx - 5, lL], [fx + 1, lR]]) {
      const ly = y0 - 4 + l;
      R(c, x - 1, ly - 1, 6, 6, INK);
      R(c, x, ly, 4, 2, PANTS[look.pants]);
      R(c, x, ly + 2, 4, 2, '#f4f4f4');
    }
  }
  for (const s of [-1, 1]) {
    const ax = s < 0 ? fx - 8 : fx + 5;
    const ua = up || (state === 'look' && s > 0);
    const ay = (ua ? tt - 3 : tt + 3) + (s < 0 ? aL : aR);
    R(c, ax, ay - 1, 3, ua ? 8 : 7, INK);
    R(c, ax + (s < 0 ? 1 : 0), ay, 2, 2, J.m);
    R(c, ax + (s < 0 ? 1 : 0), ay + 2, 2, ua ? 4 : 3, look.skin);
  }
  R(c, fx - 6, tt + 1, 12, 11, INK);
  R(c, fx - 5, tt + 2, 10, 9, J.m);
  R(c, fx - 5, tt + 5, 10, 2, J.t);
  R(c, fx - 2, tt + 2, 4, 1, J.t);
  const ht = tt - 23;
  if (o.head) drawHead(c, o.head, fx, ht);
  c.globalAlpha = 1;
  return { headTop: ht, tt };
}

// ---------------------------------------------------------------- ghế VIP
export function chairBack(c, s, cx, fy) {
  const x = Math.round(cx - s.w / 2);
  const y = fy - s.h;
  R(c, x - 1, y - 1, s.w + 2, s.h - 3, INK);
  R(c, x, y, s.w, s.h - 5, s.main);
  R(c, x + 2, y + 2, s.w - 4, 2, s.light);
  R(c, x + 3, y + 5, s.w - 6, s.h - 13, s.dark);
}
export function chairFront(c, s, cx, fy) {
  const x = Math.round(cx - s.w / 2);
  R(c, x + 1, fy - 7, s.w - 2, 8, INK);
  R(c, x + 2, fy - 6, s.w - 4, 6, s.cush);
  R(c, x + 2, fy - 6, s.w - 4, 1, '#ffffff55');
  for (const ax of [x - 3, x + s.w - 2]) {
    R(c, ax, fy - 14, 5, 14, INK);
    R(c, ax + 1, fy - 13, 3, 11, s.main);
    R(c, ax + 1, fy - 13, 3, 2, s.light);
  }
  R(c, x + 1, fy + 1, 3, 3, INK);
  R(c, x + s.w - 4, fy + 1, 3, 3, INK);
}
export function drawCrown(c, fx, ht, t) {
  const cols = { g: '#ffd23f', d: '#b9770e', r: '#e63946' };
  const dy = Math.floor(t * 2) % 2;
  CROWN.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) if (row[i] !== '.') R(c, fx - 5 + i, ht - 5 + j + dy, 1, 1, cols[row[i]]);
  });
}
export function badge(c, cx, cy, col) {
  for (let y = -5; y <= 5; y++)
    for (let x = -5; x <= 5; x++) {
      const d = Math.hypot(x, y);
      if (d <= 5.2) R(c, cx + x, cy + y, 1, 1, d > 4.1 ? INK : col);
    }
}
export function drawAura(c, cx, cy, t) {
  for (let i = 0; i < 5; i++) {
    c.globalAlpha = 0.09;
    c.fillStyle = '#ffd23f';
    c.beginPath();
    // bán kính nhỏ hơn và không vượt mép trên canvas (tránh bị cắt cụt "xém" ở đỉnh)
    c.arc(Math.round(cx), cy, Math.min(Math.max(4, cy - 1), 14 + i * 3 + Math.sin(t * 3) * 1.5), 0, 7);
    c.fill();
  }
  c.globalAlpha = 1;
}

// ---------------------------------------------------------------- hiệu ứng
export function spark(c, x, y, col, a) {
  c.globalAlpha = a;
  R(c, x, y - 2, 1, 5, col);
  R(c, x - 2, y, 5, 1, col);
  R(c, x, y, 1, 1, '#fff');
  c.globalAlpha = 1;
}

/** Vẽ một hiệu ứng ngắn. p = tiến độ 0..1. */
export function drawEffect(c, f, p) {
  const a = 1 - p;
  if (f.type === 'poof') {
    c.globalAlpha = a;
    for (let i = 0; i < 8; i++) {
      const ang = (i * Math.PI) / 4;
      const r = 3 + p * 12;
      R(c, f.x + Math.cos(ang) * r - 1, f.y + Math.sin(ang) * r * 0.7 - 2, 3, 3, i % 2 ? '#f4f4f4' : '#ffc2d4');
    }
    c.globalAlpha = 1;
  } else if (f.type === 'flash') {
    const r = 4 + p * 18;
    c.globalAlpha = a;
    for (let i = 0; i < 24; i++) {
      const ang = (i * Math.PI) / 12;
      R(c, f.x + Math.cos(ang) * r, f.y + Math.sin(ang) * r, 1, 1, i % 2 ? '#fff' : '#ffd23f');
    }
    c.globalAlpha = 1;
    for (let i = 0; i < 4; i++) {
      const ang = Math.PI / 4 + (i * Math.PI) / 2;
      const rr = 6 + p * 16;
      spark(c, Math.round(f.x + Math.cos(ang) * rr), Math.round(f.y + Math.sin(ang) * rr), '#ffe27a', a);
    }
  } else if (f.type === 'sparkle') {
    for (let i = 0; i < 6; i++) {
      const ang = (i * Math.PI) / 3 + p * 2;
      spark(c, Math.round(f.x + Math.cos(ang) * (8 + p * 10)), Math.round(f.y - p * 8 + Math.sin(ang) * 6), '#ffe27a', a);
    }
  }
}

// ---------------------------------------------------------------- phông nền tĩnh
/** Dựng lớp nền (sân cỏ ban đêm, thảm VIP, cột đèn, đồ vật). Nửa trên hoàn toàn trong suốt. */
export function buildBackground(L) {
  const cv = document.createElement('canvas');
  cv.width = L.Lw;
  cv.height = L.Lh;
  const c = cv.getContext('2d');
  const r = rng(11);
  const { Lw, Lh, stageTop, vipY, playBottom } = L;
  // Sân cỏ đặc, viền cứng ở cả mép trên (stageTop) lẫn mép dưới (ngay dưới vùng nhân vật đi lại); ngoài sân là trong suốt
  const bottom = Math.min(Lh, playBottom + 4);
  for (let y = stageTop; y < bottom; y++) {
    const band = Math.floor((y - stageTop) / 10) % 2;
    R(c, 0, y, Lw, 1, band ? '#10312f' : '#0d2b2b');
  }
  c.globalAlpha = 1;
  for (let i = 0; i < (Lw * (bottom - stageTop)) / 150; i++) {
    const x = Math.floor(r() * Lw);
    const y = stageTop + 14 + Math.floor(r() * Math.max(1, bottom - stageTop - 28));
    c.globalAlpha = 0.7;
    R(c, x, y, 1, 2, '#1d5a45');
    R(c, x + 1, y + 1, 1, 1, '#2b7a5a');
  }
  for (let i = 0; i < 36; i++) {
    c.globalAlpha = 0.18 * (1 - i / 36);
    R(c, 0, stageTop + i, Lw, 1, '#cfeaff');
  }
  c.globalAlpha = 1;
  R(c, 0, stageTop - 2, Lw, 1, '#5ee7ff');
  R(c, 0, stageTop - 1, Lw, 2, '#0e1a2e');
  const cx0 = Math.round(Lw * 0.04);
  const cw = Math.round(Lw * 0.92);
  R(c, cx0 - 1, vipY - 5, cw + 2, 19, INK);
  R(c, cx0, vipY - 4, cw, 17, '#7d1d3a');
  for (let x = cx0; x < cx0 + cw; x += 6) R(c, x, vipY - 4, 3, 17, '#8d2646');
  R(c, cx0, vipY - 4, cw, 1, '#e8b43a');
  R(c, cx0, vipY + 12, cw, 1, '#e8b43a');
  for (const x of [3, Lw - 5]) {
    R(c, x, stageTop + 6, 2, 46, '#3b2a22');
    R(c, x - 2, stageTop + 3, 6, 3, '#ffd57a');
  }
  const py = playBottom - 9;
  R(c, 6, py - 1, 17, 11, INK);
  R(c, 7, py, 15, 9, '#d63a4a');
  R(c, 7, py, 15, 3, '#f4f4f4');
  R(c, 12, py - 3, 5, 2, INK);
  const bx = Lw - 26;
  for (let y = -4; y <= 4; y++)
    for (let x = -4; x <= 4; x++) {
      const d = Math.hypot(x, y);
      if (d <= 4.4) R(c, bx + x + 4, py + 4 + y, 1, 1, d > 3.4 ? INK : '#f4f4f4');
    }
  R(c, bx + 3, py + 3, 3, 3, INK);
  return cv;
}

/** Dây đèn nhấp nháy (động). */
export function drawLights(c, L, t) {
  const { Lw, stageTop } = L;
  const seg = 54;
  const sag = (x) => stageTop + 8 + Math.round(5 * Math.sin((Math.PI * ((x - 6) % seg)) / seg));
  for (let x = 6; x < Lw - 6; x++) R(c, x, sag(x), 1, 1, '#2a2234');
  const cols = ['#ffd57a', '#ff8fab', '#7ae0ff', '#b8ff8a'];
  for (let x = 6, i = 0; x < Lw - 6; x += 13, i++) {
    const yy = sag(x) + 1;
    const tw = 0.55 + 0.45 * Math.sin(t * 3 + i * 1.7);
    c.globalAlpha = 0.18 * tw;
    R(c, x - 2, yy - 1, 5, 6, cols[i % 4]);
    c.globalAlpha = 1;
    R(c, x, yy, 2, 3, cols[i % 4]);
    R(c, x, yy, 1, 1, '#fff');
  }
}
