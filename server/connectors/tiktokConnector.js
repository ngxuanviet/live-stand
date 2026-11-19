import { appendFileSync, mkdirSync } from 'node:fs';
import { TikTokLiveConnection, WebcastEvent, ControlEvent, UserOfflineError } from 'tiktok-live-connector';
import { Connector, ConnState } from './Connector.js';
import { EventType, Platform } from '../../shared/events.js';

const MAX_BACKOFF_MS = 60_000;
const OFFLINE_POLL_MS = 30_000;

/** BigInt -> string để JSON.stringify không lỗi. */
const bigintSafe = (_k, v) => (typeof v === 'bigint' ? String(v) : v);

/**
 * Đọc thông tin người dùng. Dữ liệu thật (đã kiểm tra với phòng live): data.user = { id, nickname, displayId, avatarThumb.urlList[] }.
 * `id` là ID số ổn định nên dùng làm khoá; `nickname` để hiển thị. Có dự phòng cho các dạng khác.
 */
export function extractUser(data) {
  const u = data?.user ?? data ?? {};
  const userId = u.userId ?? u.id ?? u.uniqueId ?? data?.userId;
  const username = u.nickname || u.uniqueId || u.displayId || String(userId ?? '');
  const avatar =
    u.profilePicture?.url?.[0] ||
    u.avatarThumb?.urlList?.[0] ||
    u.avatarThumb?.url?.[0] ||
    u.profilePictureUrl ||
    '';
  return { userId: userId == null ? null : String(userId), username, avatar };
}

/**
 * Đọc thông tin quà theo dữ liệu thật của thư viện v2 (đã kiểm tra với phòng live):
 *   data.gift = { id, name, diamondCount, combo (bool), type }
 *   data.repeatCount = số lần tích luỹ trong chuỗi; data.repeatEnd = 0/1 chuỗi đã kết thúc; data.groupId = id chuỗi.
 * Quan sát thực tế: quà loại 1 (Rose, Doughnut...) gửi event repeatEnd=0 rồi event repeatEnd=1 với CÙNG repeatCount;
 * quà loại 2 (Whale diving, Hand Heart...) cũng combo=true nhưng mỗi lần tặng là một groupId mới và không có repeatEnd.
 * Có dự phòng cho dạng cũ (giftDetails).
 */
export function extractGift(data) {
  const d = data?.gift ?? data?.giftDetails ?? {};
  const diamond = d.diamondCount ?? data?.diamondCount ?? data?.extendedGiftInfo?.diamond_count ?? data?.extendedGiftInfo?.diamondCount ?? 0;
  return {
    giftId: String(data?.giftId ?? d.id ?? ''),
    groupId: String(data?.groupId ?? ''), // mỗi chuỗi combo có một groupId riêng
    giftName: d.name || d.giftName || d.describe || data?.giftName || data?.extendedGiftInfo?.name || '',
    diamondValue: Number(diamond) || 0,
    repeatCount: Number(data?.repeatCount) || 1,
    streakEnded: !!Number(data?.repeatEnd),
    combo: d.combo === true || d.type === 1 || d.giftType === 1,
  };
}

/** Số tim của một event like: dữ liệu thật dùng `count` (còn `total` là tổng tim của cả phòng). */
export function extractLikeCount(data) {
  return Math.max(1, Number(data?.count ?? data?.likeCount) || 1);
}

export class TikTokConnector extends Connector {
  constructor(opts, { signApiKey = '', debugLog = false, extendedGiftInfo = false } = {}) {
    super({ ...opts, platform: Platform.TIKTOK });
    this.extendedGiftInfo = extendedGiftInfo;
    this.signApiKey = signApiKey;
    this.debugLog = debugLog;
    this.conn = null;
    this._closed = null;
    this._debugCount = {};
  }

  async _run() {
    let attempt = 0;
    while (!this.stopped) {
      this.setStatus(attempt ? ConnState.RECONNECTING : ConnState.CONNECTING, attempt ? `Thử lại lần ${attempt}` : '');
      try {
        await this.#connectOnce();
        attempt = 0;
        // chờ tới khi kết nối đóng
        await new Promise((resolve) => (this._closed = resolve));
        if (this.stopped) break;
        attempt = 1;
        this.setStatus(ConnState.RECONNECTING, 'Mất kết nối, đang thử lại');
        await this.sleep(2000);
      } catch (err) {
        if (this.stopped) break;
        if (err instanceof UserOfflineError) {
          attempt = 0;
          this.setStatus(ConnState.OFFLINE, 'Streamer chưa live, đang chờ');
          await this.sleep(OFFLINE_POLL_MS);
          continue;
        }
        attempt += 1;
        const delay = Math.min(MAX_BACKOFF_MS, 2000 * 2 ** Math.min(attempt, 5));
        this.setStatus(ConnState.ERROR, `${err?.name || 'Error'}: ${err?.message || err} (thử lại sau ${Math.round(delay / 1000)}s)`);
        await this.sleep(delay);
      } finally {
        await this._teardown();
      }
    }
  }

  async #connectOnce() {
    const conn = new TikTokLiveConnection(this.handle, {
      signApiKey: this.signApiKey || undefined,
      processInitialData: false,
      fetchRoomInfoOnConnect: true,
      // Tải danh sách quà cần endpoint trả phí (Business plan) của sign server; mặc định tắt, giá lấy từ chính event quà.
      enableExtendedGiftInfo: this.extendedGiftInfo,
    });
    this.conn = conn;
    this.#bind(conn);
    await conn.connect();
    this.setStatus(ConnState.CONNECTED, '');
  }

  #bind(conn) {
    conn.on(ControlEvent.DISCONNECTED, () => this._closed?.());
    conn.on(ControlEvent.ERROR, (e) => {
      // lỗi giải mã lẻ tẻ không làm rớt kết nối; chỉ ghi nhận
      console.warn(`[tiktok:${this.handle}] lỗi:`, String(e?.exception?.message || e?.message || e?.info || e).replace(/s+/g, ' ').slice(0, 220));
    });

    conn.on(WebcastEvent.MEMBER, (d) => this.#emit(EventType.JOIN, d, 'member'));
    conn.on(WebcastEvent.LIKE, (d) => this.#emit(EventType.LIKE, d, 'like', { value: extractLikeCount(d) }));
    conn.on(WebcastEvent.GIFT, (d) => this.#emit(EventType.GIFT, d, 'gift', { gift: extractGift(d) }));
    conn.on(WebcastEvent.CHAT, (d) => this.#emit(EventType.CHAT, d, 'chat'));
    conn.on(WebcastEvent.FOLLOW, (d) => this.#emit(EventType.FOLLOW, d, 'follow'));
    conn.on(WebcastEvent.SHARE, (d) => this.#emit(EventType.SHARE, d, 'share'));
  }

  #emit(eventType, data, rawName, extra = {}) {
    this.#debug(rawName, data);
    const user = extractUser(data);
    if (!user.userId) return; // không xác định được người dùng thì bỏ qua
    this.push({ eventType, ...user, ...extra });
  }

  /** Ghi vài mẫu event thô để xác nhận các trường (bước spike). */
  #debug(name, data) {
    if (!this.debugLog) return;
    this._debugCount[name] = (this._debugCount[name] || 0) + 1;
    if (this._debugCount[name] > 30) return;
    try {
      mkdirSync('data', { recursive: true });
      appendFileSync('data/raw-events.jsonl', JSON.stringify({ t: Date.now(), source: this.id, name, data }, bigintSafe) + '\n');
    } catch {
      /* bỏ qua */
    }
  }

  async _teardown() {
    const conn = this.conn;
    this.conn = null;
    this._closed?.();
    if (conn) {
      try {
        await conn.disconnect();
      } catch {
        /* bỏ qua */
      }
    }
  }
}
