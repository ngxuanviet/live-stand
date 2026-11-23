// Hoạt hoạ một lần cho người thả nhiều tim. Toàn bộ là HÀM THUẦN của tiến độ p (0..1): không đụng canvas,
// không dùng Math.random (số ngẫu nhiên suy ra từ seed), nên kiểm thử được bằng node:test.
// Id và thời lượng phải khớp server/core/heartEffects.js (có test đối chiếu).

export const ANIM_MS = Object.freeze({
  hop3: 1400, // nhảy cẫng
  sway: 2000, // nhún nhảy
  spin: 1200, // xoay vòng
  confetti: 1800, // pháo giấy
  flip: 1100, // lộn nhào
  rocket: 2200, // phóng lên trời
  fireworks: 2600, // pháo hoa
});
export const ANIM_IDS = Object.keys(ANIM_MS);
export const MAX_FLIGHT = 58; // độ cao tối đa của "phóng lên trời" (đơn vị logic)

const q = (v, step) => Math.round(v / step) * step;

/** Số ngẫu nhiên ổn định 0..1 theo (seed, i, salt). */
export function rnd(seed, i, salt = 0) {
  let n = Math.imul((seed | 0) * 7919 + i * 104729 + salt * 1299709, 0x85ebca6b) ^ 0x9e3779b9;
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
}

/**
 * Độ cao bay tối đa cho phép: không đâm vào hàng VIP / ra khỏi mép trên canvas.
 * feetY = y chân nhân vật, topLimit = y thấp nhất mà đỉnh đầu được phép chạm tới (đơn vị logic).
 */
export function flightAmp(feetY, topLimit, head = 38) {
  return Math.max(6, Math.min(MAX_FLIGHT, feetY - head - topLimit));
}

/**
 * Tư thế của nhân vật tại tiến độ p. Trả về:
 *   jump  độ cao so với chân (>= 0),  dx  lệch ngang (px logic),  sx  co dãn ngang (xoay giả 3D),
 *   rot   góc xoay (rad, đã lượng tử hoá 30 độ),  state  trạng thái của drawChar,  arms  kiểu tay ('swing'|undefined)
 */
export function pose(id, p, ctx = {}) {
  const amp = ctx.amp ?? MAX_FLIGHT;
  p = Math.min(1, Math.max(0, p));
  switch (id) {
    case 'hop3':
      return { jump: Math.abs(Math.sin(p * Math.PI * 3)) * 14, dx: 0, sx: 1, rot: 0, state: 'jump' };
    case 'sway':
      return { jump: 0, dx: Math.round(Math.sin(p * Math.PI * 8) * 2), sx: 1, rot: 0, state: 'idle', arms: 'swing' };
    case 'spin': {
      let sx = Math.cos(p * Math.PI * 4); // 2 vòng
      if (Math.abs(sx) < 0.18) sx = 0.18 * (sx < 0 ? -1 : 1);
      return { jump: Math.sin(p * Math.PI) * 6, dx: 0, sx: q(sx, 1 / 8), rot: 0, state: 'jump' };
    }
    case 'confetti':
      return { jump: Math.abs(Math.sin(p * Math.PI * 2)) * 6, dx: 0, sx: 1, rot: 0, state: 'jump' };
    case 'flip': {
      const k = Math.min(1, p * 1.05);
      return { jump: Math.sin(k * Math.PI) * 14, dx: 0, sx: 1, rot: q(k * Math.PI * 2, Math.PI / 6), state: 'jump' };
    }
    case 'rocket':
      return { jump: Math.sin(p * Math.PI) * amp, dx: 0, sx: 1, rot: 0, state: 'jump' };
    case 'fireworks':
      return { jump: Math.abs(Math.sin(p * Math.PI * 2)) * 4, dx: 0, sx: 1, rot: 0, state: 'jump' };
    default:
      return { jump: 0, dx: 0, sx: 1, rot: 0, state: 'idle' };
  }
}

const CONFETTI = ['#ff4d6d', '#ffd23f', '#4dd8ff', '#7cf29a', '#c77dff', '#ffffff'];
export const MAX_PARTICLES = 60;

/**
 * Các hạt của hiệu ứng tại tiến độ p, toạ độ tuyệt đối (đơn vị logic).
 * ctx: { x, y (chân nhân vật, gốc), jump (độ cao đang bay), seed, lod (true = giảm một nửa số hạt), amp }
 * Mỗi phần tử: { x, y, w, h, c, a } (hình chữ nhật) hoặc { spark: true, x, y, c, a } (tia lấp lánh).
 */
export function particles(id, p, ctx) {
  const { x, y, seed = 1, lod = false } = ctx;
  const jump = ctx.jump || 0;
  const amp = ctx.amp ?? MAX_FLIGHT;
  const topY = y - jump - 38;
  const out = [];
  p = Math.min(1, Math.max(0, p));
  if (id === 'confetti') {
    const n = lod ? 12 : 24;
    for (let i = 0; i < n; i++) {
      const r = rnd(seed, i, 1);
      const r2 = rnd(seed, i, 2);
      out.push({
        x: x + (r - 0.5) * 22 + Math.sin(p * 7 + i) * 3,
        y: topY - 10 + p * (46 + r2 * 14),
        w: r2 > 0.5 ? 2 : 1,
        h: 2,
        c: CONFETTI[i % CONFETTI.length],
        a: Math.min(1, (1 - p) * 2.2),
      });
    }
  } else if (id === 'sway') {
    for (let i = 0; i < 3; i++) {
      const pp = (p * 1.6 + i / 3) % 1;
      const nx = x + (i - 1) * 9 + Math.sin(pp * 6 + i) * 3;
      const ny = topY - 2 - pp * 18;
      out.push({ x: nx, y: ny + 4, w: 3, h: 2, c: '#ffe27a', a: 1 - pp }, { x: nx + 2, y: ny, w: 1, h: 5, c: '#ffe27a', a: 1 - pp });
    }
  } else if (id === 'rocket') {
    const dyAt = (pp) => Math.sin(pp * Math.PI) * amp;
    const n = lod ? 4 : 8;
    for (let j = 0; j < n; j++) {
      const fy = y - dyAt(Math.max(0, p - j * 0.035));
      out.push({ x: x - 3 + (j % 2) * 2, y: fy + 2, w: j > 4 ? 4 : 5, h: 4, c: j < 2 ? '#ffffff' : '#cfd6e6', a: Math.max(0, 0.6 - j * 0.08) });
    }
    const fy = y - dyAt(p);
    const fl = Math.floor(p * 40) % 2;
    out.push({ x: x - 2, y: fy + 1, w: 5, h: 3 + fl, c: '#ff7a1a', a: 1 }, { x: x - 1, y: fy + 2, w: 3, h: 3 + fl * 2, c: '#ffd23f', a: 1 }, { x, y: fy + 3, w: 1, h: 4 + fl, c: '#ffffff', a: 1 });
  } else if (id === 'fireworks') {
    const bursts = [[0.12, -9, -4, '#ff4d6d'], [0.36, 10, 0, '#4dd8ff'], [0.6, -2, -9, '#ffd23f']];
    for (const [b, ox, oy, col] of bursts) {
      if (p < b) continue;
      const k = Math.min(1, (p - b) / 0.34);
      const n = lod ? 8 : 14;
      const rad = 3 + k * 10;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        out.push({ x: x + ox + Math.cos(a) * rad, y: topY - 6 + oy + Math.sin(a) * rad, w: 1, h: 1, c: i % 2 ? col : '#ffffff', a: 1 - k * k });
      }
      if (k < 0.2) out.push({ spark: true, x: Math.round(x + ox), y: Math.round(topY - 6 + oy), c: '#ffffff', a: 1 });
    }
  } else if (id === 'spin' || id === 'flip' || id === 'hop3') {
    if (p > 0.05 && p < 0.95) {
      const n = lod ? 2 : 4;
      for (let i = 0; i < n; i++) {
        const a = p * 9 + (i / n) * Math.PI * 2;
        out.push({ spark: true, x: Math.round(x + Math.cos(a) * 11), y: Math.round(y - jump - 20 + Math.sin(a) * 15), c: '#ffe27a', a: 0.8 });
      }
    }
  }
  return out.length > MAX_PARTICLES ? out.slice(0, MAX_PARTICLES) : out;
}
