// Làm nổi bật người đang diễn hiệu ứng: thứ tự vẽ, tiêu điểm, bong bóng tên. Toàn bộ là hàm thuần (test được).

export const MAX_FULL = 2; // số người được tiêu điểm đầy đủ cùng lúc
export const MAX_BIG_ANIMS = 6; // số hoạt hoạ lớn đồng thời
export const DIM_ALPHA = 0.28; // độ tối của lớp làm tối đám đông

/**
 * Cộng thêm vào trục Y khi xếp thứ tự vẽ: lead poll, người vừa qua mốc (theo giờ server) và người đang diễn
 * (theo giờ client, không phụ thuộc độ trễ patch) luôn nổi lên trên cùng.
 */
export function zBoost(c, sNow) {
  return c.lead || sNow < (c.zUntil || 0) || c.anim || c.pendingAnim ? 1000 : 0;
}

/** Sắp xếp nhân vật từ xa tới gần (vẽ sau cùng = nổi nhất). Không sửa mảng gốc. */
export function sortField(list, sNow) {
  return [...list].sort((a, b) => a.y + zBoost(a, sNow) - (b.y + zBoost(b, sNow)));
}

const KIND_RANK = { total: 2, burst: 1, preview: 0 };

/**
 * Chọn ai giữ tiêu điểm. performers: [{ key, kind, intensity, t0 }].
 * - owner: một người duy nhất (mốc tổng > dồn dập > xem thử, rồi độ mạnh cao hơn, rồi bắt đầu muộn hơn).
 * - full: tối đa maxFull người đầy đủ (owner luôn nằm trong đó); những người còn lại chỉ nhận bản nhẹ.
 * - dim: chỉ bật lớp làm tối khi có owner, mode khác 'off' và dim = true (một lớp duy nhất, không cộng dồn).
 */
export function planFocus(performers, { mode = 'light', dim = false, maxFull = MAX_FULL } = {}) {
  const sorted = [...performers].sort(
    (a, b) => (KIND_RANK[b.kind] ?? 0) - (KIND_RANK[a.kind] ?? 0) || (b.intensity || 0) - (a.intensity || 0) || (b.t0 || 0) - (a.t0 || 0),
  );
  const owner = mode === 'off' || !sorted.length ? null : sorted[0].key;
  const full = new Set(mode === 'off' ? [] : sorted.slice(0, maxFull).map((p) => p.key));
  return { owner, full, dim: !!(dim && owner) };
}

/**
 * Hoạt hoạ lớn quá nhiều thì hạ cấp: trả về { id, lod }. Vượt trần: chỉ nhảy cẫng và giảm hạt.
 * Có nhiều nhân vật trên sân thì giảm một nửa số hạt (lod) cho nhẹ.
 */
export function degrade(id, activeBig, crowd, maxBig = MAX_BIG_ANIMS) {
  if (activeBig >= maxBig) return { id: 'hop3', lod: true };
  return { id, lod: crowd > 12 };
}

/**
 * Chọn bong bóng tên để hiển thị: người đang diễn (priority 2) KHÔNG bao giờ bị cắt; bong bóng chào thường
 * (priority 1) chỉ lấy tối đa `max` cái mới nhất. Kết quả: người diễn trước, rồi các bong bóng thường.
 */
export function pickBubbles(cands, max) {
  const byRecent = (a, b) => (b.greetUntil || 0) - (a.greetUntil || 0);
  const perf = cands.filter((c) => c.priority >= 2).sort(byRecent);
  const normal = cands.filter((c) => c.priority < 2).sort(byRecent).slice(0, Math.max(0, max));
  return [...perf, ...normal];
}

/** Dòng tiêu đề thứ hai trong bong bóng của người diễn. */
export function tierLabel(kind, hearts) {
  if (kind === 'total') return `x${hearts} tim!`;
  if (kind === 'burst') return 'thả tim liên tục!';
  return 'xem thử';
}
