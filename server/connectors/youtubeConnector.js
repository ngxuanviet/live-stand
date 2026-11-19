import { Connector, ConnState } from './Connector.js';
import { Platform } from '../../shared/events.js';

/**
 * PLACEHOLDER cho YouTube Live (chưa cài đặt).
 *
 * Để hoàn thiện sau này, chỉ cần cài `_run()`:
 *   1. Kết nối YouTube Live Chat (ví dụ qua Data API v3 liveChat/messages hoặc thư viện tương đương)
 *      dùng `this.handle` (video ID / channel).
 *   2. Với mỗi tin nhắn / Super Chat / thành viên, gọi `this.push({ userId, username, avatar, eventType, value, gift })`
 *      đúng theo Normalized Event (xem shared/events.js).
 *      - Super Chat nên quy đổi ra "diamondValue" tương đương (hoặc cấu hình bảng quy đổi riêng).
 *   3. Cập nhật trạng thái bằng `this.setStatus(ConnState.CONNECTED | RECONNECTING | ERROR, 'chi tiết')`.
 *   4. Giải phóng tài nguyên trong `_teardown()`.
 */
export class YouTubeConnector extends Connector {
  constructor(opts) {
    super({ ...opts, platform: Platform.YOUTUBE });
  }

  async _run() {
    this.setStatus(ConnState.ERROR, 'Connector YouTube chưa được cài đặt (placeholder)');
  }
}
