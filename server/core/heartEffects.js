/**
 * Thư viện hiệu ứng cho người thả nhiều tim + kiểm tra cấu hình mốc.
 * Id và thời lượng phải khớp với overlay/js/anims.js (có test đối chiếu).
 */
export const HEART_EFFECTS = Object.freeze([
  { id: 'hop3', label: 'Nhảy cẫng', ms: 1400 },
  { id: 'sway', label: 'Nhún nhảy', ms: 2000 },
  { id: 'spin', label: 'Xoay vòng', ms: 1200 },
  { id: 'confetti', label: 'Pháo giấy', ms: 1800 },
  { id: 'flip', label: 'Lộn nhào', ms: 1100 },
  { id: 'rocket', label: 'Phóng lên trời', ms: 2200 },
  { id: 'fireworks', label: 'Pháo hoa', ms: 2600 },
]);

export const EFFECT_IDS = HEART_EFFECTS.map((e) => e.id);
export const MAX_TIERS = 8;
export const SPOTLIGHT_MODES = ['off', 'light', 'strong'];
/** Sau khi một mốc bắn, khoảng nghỉ trước khi cửa sổ dồn dập tính lại (ms). */
export const BURST_COOLDOWN_MS = 5000;

export function effectMs(id) {
  return HEART_EFFECTS.find((e) => e.id === id)?.ms ?? 1500;
}

/** Độ mạnh 1..3 theo vị trí của mốc trong danh sách (mốc đầu = 1, mốc cuối = 3). */
export function tierIntensity(index, count) {
  if (count <= 1) return 1;
  return 1 + Math.round((index * 2) / (count - 1));
}

export class TierError extends Error {}

/**
 * Kiểm tra và chuẩn hoá danh sách mốc.
 *   kind 'total': [{hearts, effect}]              hearts 1..1.000.000, tăng ngặt
 *   kind 'burst': [{hearts, windowSec, effect}]   hearts 2..1000 tăng ngặt, windowSec 2..120
 */
export function cleanTiers(kind, raw) {
  const label = kind === 'total' ? 'Mốc tổng' : 'Mốc dồn dập';
  if (!Array.isArray(raw)) throw new TierError(`${label}: phải là một danh sách`);
  if (raw.length > MAX_TIERS) throw new TierError(`${label}: tối đa ${MAX_TIERS} mốc`);
  const [lo, hi] = kind === 'total' ? [1, 1_000_000] : [2, 1000];
  const out = [];
  let prev = 0;
  raw.forEach((t, i) => {
    const n = i + 1;
    if (!t || typeof t !== 'object') throw new TierError(`${label} #${n}: dữ liệu không hợp lệ`);
    const hearts = Number(t.hearts);
    if (!Number.isInteger(hearts) || hearts < lo || hearts > hi) throw new TierError(`${label} #${n}: số tim phải là số nguyên từ ${lo} đến ${hi}`);
    if (hearts <= prev) throw new TierError(`${label} #${n}: số tim phải lớn hơn mốc trước`);
    prev = hearts;
    if (!EFFECT_IDS.includes(t.effect)) throw new TierError(`${label} #${n}: hiệu ứng không hợp lệ`);
    const item = { hearts, effect: t.effect };
    if (kind === 'burst') {
      const w = Number(t.windowSec);
      if (!Number.isInteger(w) || w < 2 || w > 120) throw new TierError(`${label} #${n}: khoảng thời gian phải là số nguyên từ 2 đến 120 giây`);
      item.windowSec = w;
    }
    out.push(item);
  });
  return out;
}
