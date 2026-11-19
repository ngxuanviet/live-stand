import { EventEmitter } from 'node:events';
import { makeEvent } from '../../shared/events.js';

/**
 * Trạng thái kết nối hiển thị trên Dashboard.
 *   idle          chưa chạy / đã tắt
 *   connecting    đang kết nối
 *   connected     đang nhận event
 *   offline       streamer chưa live, đang chờ
 *   reconnecting  mất kết nối, đang thử lại
 *   error         lỗi (kèm nội dung)
 */
export const ConnState = Object.freeze({
  IDLE: 'idle',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  OFFLINE: 'offline',
  RECONNECTING: 'reconnecting',
  ERROR: 'error',
});

/**
 * Lớp cơ sở cho mọi Source (Adapter pattern).
 * Lớp con cài `_run()` (vòng đời kết nối) và gọi `this.push({...})` cho mỗi sự kiện chuẩn hoá.
 *
 * Events: 'event' (Normalized Event), 'status' (status object).
 */
export class Connector extends EventEmitter {
  constructor({ id, platform, handle }) {
    super();
    this.id = id;
    this.platform = platform;
    this.handle = handle;
    this.stopped = true;
    this.status = this.#makeStatus(ConnState.IDLE, '');
    this.lastEventAt = 0;
    this._silenceTimer = null;
    this._sleepAbort = null;
  }

  #makeStatus(state, detail, extra = {}) {
    return { sourceId: this.id, state, detail, since: Date.now(), lastEventAt: this.lastEventAt, silent: false, ...extra };
  }

  setStatus(state, detail = '', extra = {}) {
    this.status = this.#makeStatus(state, detail, extra);
    this.emit('status', this.status);
  }

  /** Chuẩn hoá và phát một event. `partial` không cần sourceId/platform. */
  push(partial) {
    this.lastEventAt = Date.now();
    if (this.status.silent) {
      this.status = { ...this.status, silent: false };
      this.emit('status', this.status);
    }
    this.emit('event', makeEvent({ ...partial, sourceId: this.id, platform: this.platform }));
  }

  async start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.lastEventAt = 0;
    this._silenceTimer = setInterval(() => this.#checkSilence(), 30_000);
    this._silenceTimer.unref?.();
    this._run().catch((e) => {
      if (!this.stopped) this.setStatus(ConnState.ERROR, String(e?.message || e));
    });
  }

  async stop() {
    this.stopped = true;
    clearInterval(this._silenceTimer);
    this._sleepAbort?.();
    try {
      await this._teardown();
    } catch {
      /* bỏ qua lỗi khi đóng */
    }
    this.setStatus(ConnState.IDLE, '');
  }

  /** Cảnh báo "đã kết nối nhưng X phút không có event" để phát hiện kết nối chết ngầm. */
  #checkSilence() {
    const SILENT_MS = 5 * 60_000;
    if (this.status.state !== ConnState.CONNECTED || this.status.silent) return;
    const ref = this.lastEventAt || this.status.since;
    if (Date.now() - ref > SILENT_MS) {
      this.status = { ...this.status, silent: true, detail: 'Đã kết nối nhưng 5 phút không có event nào' };
      this.emit('status', this.status);
    }
  }

  /** Ngủ có thể bị huỷ khi stop(). */
  sleep(ms) {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      this._sleepAbort = () => {
        clearTimeout(t);
        resolve();
      };
    });
  }

  // ---- lớp con cài đặt ----
  async _run() {
    throw new Error('Connector._run chưa được cài đặt');
  }
  async _teardown() {}
}
