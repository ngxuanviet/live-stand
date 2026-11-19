import { EventEmitter } from 'node:events';
import { randomBytes, createHash } from 'node:crypto';
import { StageEngine, DEFAULT_SETTINGS } from './stageEngine.js';
import { createConnector, SUPPORTED_PLATFORMS } from '../connectors/index.js';
import { makeEvent, EventType } from '../../shared/events.js';

const TICK_MS = 100; // gộp & phát patch ~10 lần/giây
const ENGINE_TICK_EVERY = 10; // tick logic (timeout, vắng...) mỗi ~1 giây
const SAVE_EVERY_MS = 2000;

const newId = (prefix) => `${prefix}_${randomBytes(4).toString('hex')}`;
const newToken = () => randomBytes(16).toString('hex');

export class HubError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Trung tâm: giữ Sources (connectors), Stages (engines) và Event Router (Source -> Stage).
 *
 * Events: 'patch' (stageId, patch) | 'status' (status) | 'stageRemoved' (stageId) | 'stageTokenChanged' (stageId)
 */
export class Hub extends EventEmitter {
  constructor(db, config) {
    super();
    this.db = db;
    this.config = config;
    /** @type {Map<string, StageEngine>} */
    this.engines = new Map();
    this.connectors = new Map();
    this.routes = new Map(); // sourceId -> Set<stageId>
    this._tickCount = 0;
    this._timer = null;
    this._lastSave = 0;
  }

  // ------------------------------------------------------------------ vòng đời
  start() {
    for (const s of this.db.listStages()) this.#loadEngine(s);
    for (const r of this.db.listRoutes()) this.#addRoute(r.sourceId, r.stageId);
    for (const src of this.db.listSources()) {
      this.#makeConnector(src);
      if (src.enabled) this.connectors.get(src.id).start();
    }
    this._timer = setInterval(() => this.#loop(), TICK_MS);
    this._timer.unref?.();
  }

  async stop() {
    clearInterval(this._timer);
    await Promise.allSettled([...this.connectors.values()].map((c) => c.stop()));
    this.saveAll(true);
  }

  #loop() {
    this._tickCount += 1;
    const doTick = this._tickCount % ENGINE_TICK_EVERY === 0;
    for (const [stageId, engine] of this.engines) {
      try {
        if (doTick) engine.tick();
        const patch = engine.drainPatch();
        if (patch) this.emit('patch', stageId, patch);
      } catch (e) {
        console.error(`[hub] lỗi xử lý stage ${stageId}:`, e);
      }
    }
    if (Date.now() - this._lastSave > SAVE_EVERY_MS) this.saveAll();
  }

  saveAll(force = false) {
    this._lastSave = Date.now();
    for (const [stageId, engine] of this.engines) {
      if (!force && !engine.dirty) continue;
      try {
        this.db.saveStageUsers(stageId, engine.exportUsers());
        engine.dirty = false;
      } catch (e) {
        console.error(`[hub] không lưu được stage ${stageId}:`, e);
      }
    }
  }

  // ------------------------------------------------------------------ stages
  #loadEngine(stage) {
    const engine = new StageEngine(stage.id, stage.settings);
    engine.importUsers(this.db.loadStageUsers(stage.id));
    this.engines.set(stage.id, engine);
  }

  listStages() {
    return this.db.listStages().map((s) => this.#stageDto(s));
  }

  #stageDto(s) {
    const base = this.config.publicBaseUrl || '';
    const q = new URLSearchParams({ stage_id: s.id, token: s.token });
    return {
      id: s.id,
      name: s.name,
      width: s.width,
      height: s.height,
      token: s.token,
      settings: { ...DEFAULT_SETTINGS, ...s.settings },
      overlayUrl: `${base}/overlay?${q}`,
    };
  }

  getStage(id) {
    const s = this.db.getStage(id);
    if (!s) throw new HubError('Không tìm thấy Stage', 404);
    return this.#stageDto(s);
  }

  addStage({ name, width = 1080, height = 1920, settings = {} }) {
    const stage = { id: newId('stage'), name: this.#str(name, 'Tên Stage'), width: this.#dim(width), height: this.#dim(height), token: newToken(), settings };
    this.db.insertStage(stage);
    this.#loadEngine(stage);
    return this.#stageDto(stage);
  }

  updateStage(id, { name, width, height, settings }) {
    const cur = this.db.getStage(id);
    if (!cur) throw new HubError('Không tìm thấy Stage', 404);
    const patch = {};
    if (name !== undefined) patch.name = this.#str(name, 'Tên Stage');
    if (width !== undefined) patch.width = this.#dim(width);
    if (height !== undefined) patch.height = this.#dim(height);
    if (settings) patch.settings = this.#cleanSettings(settings);
    this.db.updateStage(id, patch);
    if (patch.settings) this.engines.get(id)?.setSettings(patch.settings);
    return this.getStage(id);
  }

  regenerateToken(id) {
    if (!this.db.getStage(id)) throw new HubError('Không tìm thấy Stage', 404);
    this.db.updateStage(id, { token: newToken() });
    this.emit('stageTokenChanged', id);
    return this.getStage(id);
  }

  removeStage(id) {
    if (!this.db.getStage(id)) throw new HubError('Không tìm thấy Stage', 404);
    this.db.deleteStage(id);
    this.engines.delete(id);
    for (const set of this.routes.values()) set.delete(id);
    this.emit('stageRemoved', id);
  }

  verifyOverlay(stageId, token) {
    const s = stageId && this.db.getStage(stageId);
    if (!s || !token || s.token !== token) return null;
    return { id: s.id, name: s.name, width: s.width, height: s.height };
  }

  engine(id) {
    const e = this.engines.get(id);
    if (!e) throw new HubError('Không tìm thấy Stage', 404);
    return e;
  }

  #cleanSettings(input) {
    const out = {};
    const num = (k, min, max) => {
      if (input[k] === undefined) return;
      const v = Number(input[k]);
      if (!Number.isFinite(v) || v < min || v > max) throw new HubError(`Giá trị ${k} không hợp lệ (${min}..${max})`);
      out[k] = v;
    };
    num('heartsPerMove', 1, 100000);
    num('idleTimeoutSec', 5, 86400);
    num('maxSlots', 1, 200);
    num('minStaySec', 0, 300);
    num('vipMinGift', 0, 1e9);
    num('vipAbsentSec', 10, 86400);
    num('vipReleaseSec', 10, 604800);
    num('zBoostSec', 1, 120);
    num('greetSec', 1, 30);
    num('actionGreetSec', 1, 60);
    num('actionCooldownSec', 0, 3600);
    num('simulatedTtlSec', 5, 3600);
    num('safeBottomPct', 0, 50);
    num('fieldHeightPx', 0, 8000);
    if (input.vipAbsentPolicy !== undefined) {
      if (!['keep', 'release'].includes(input.vipAbsentPolicy)) throw new HubError('vipAbsentPolicy phải là keep hoặc release');
      out.vipAbsentPolicy = input.vipAbsentPolicy;
    }
    if (input.giftValueOverrides !== undefined) {
      const o = {};
      for (const [k, v] of Object.entries(input.giftValueOverrides || {})) {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) throw new HubError(`Giá quà ${k} không hợp lệ`);
        o[String(k)] = n;
      }
      out.giftValueOverrides = o;
    }
    return out;
  }

  #str(v, label) {
    const s = String(v ?? '').trim();
    if (!s || s.length > 80) throw new HubError(`${label} không hợp lệ`);
    return s;
  }
  #dim(v) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 100 || n > 8000) throw new HubError('Kích thước phải từ 100 đến 8000');
    return n;
  }

  // ------------------------------------------------------------------ sources
  listSources() {
    return this.db.listSources().map((s) => ({
      ...s,
      stageIds: [...(this.routes.get(s.id) || [])],
      status: this.#liveStatus(this.connectors.get(s.id)),
    }));
  }

  sourceStatuses() {
    return [...this.connectors.values()].map((c) => this.#liveStatus(c));
  }

  /** Trạng thái kèm thời điểm event gần nhất (status object chỉ đổi khi chuyển trạng thái). */
  #liveStatus(c) {
    return c ? { ...c.status, lastEventAt: c.lastEventAt } : null;
  }

  #makeConnector(src) {
    const c = createConnector(src, this.config);
    c.on('event', (evt) => this.route(evt));
    c.on('status', (st) => this.emit('status', st));
    this.connectors.set(src.id, c);
    return c;
  }

  addSource({ platform, handle, enabled = true }) {
    if (!SUPPORTED_PLATFORMS.includes(platform)) throw new HubError('Nền tảng không hỗ trợ');
    const h = this.#str(handle, 'Username / ID').replace(/^@/, '');
    const src = { id: newId('src'), platform, handle: h, enabled: !!enabled };
    this.db.insertSource(src);
    const c = this.#makeConnector(src);
    if (src.enabled) c.start();
    return this.listSources().find((s) => s.id === src.id);
  }

  async updateSource(id, { handle, enabled }) {
    const cur = this.db.getSource(id);
    if (!cur) throw new HubError('Không tìm thấy Source', 404);
    const next = { handle: handle !== undefined ? this.#str(handle, 'Username / ID').replace(/^@/, '') : cur.handle, enabled: enabled ?? cur.enabled };
    this.db.updateSource(id, next);
    const old = this.connectors.get(id);
    if (old && (next.handle !== cur.handle || next.enabled !== cur.enabled)) {
      await old.stop();
      old.removeAllListeners();
      const c = this.#makeConnector({ ...cur, ...next });
      if (next.enabled) c.start();
    }
    return this.listSources().find((s) => s.id === id);
  }

  async removeSource(id) {
    if (!this.db.getSource(id)) throw new HubError('Không tìm thấy Source', 404);
    const c = this.connectors.get(id);
    if (c) {
      await c.stop();
      c.removeAllListeners();
    }
    this.connectors.delete(id);
    this.routes.delete(id);
    this.db.deleteSource(id);
  }

  // ------------------------------------------------------------------ router
  #addRoute(sourceId, stageId) {
    if (!this.routes.has(sourceId)) this.routes.set(sourceId, new Set());
    this.routes.get(sourceId).add(stageId);
  }

  setRoutes(sourceId, stageIds) {
    if (!this.db.getSource(sourceId)) throw new HubError('Không tìm thấy Source', 404);
    const ids = [...new Set(stageIds || [])];
    for (const s of ids) if (!this.db.getStage(s)) throw new HubError(`Stage không tồn tại: ${s}`);
    this.db.setRoutesForSource(sourceId, ids);
    this.routes.set(sourceId, new Set(ids));
  }

  /** Mỗi event tới mỗi Stage đúng một lần -> Merge N-1 không cộng điểm hai lần. */
  route(evt) {
    const stages = this.routes.get(evt.sourceId);
    if (!stages) return;
    for (const stageId of stages) this.engines.get(stageId)?.handle(evt);
  }

  // ------------------------------------------------------------------ Bình chọn
  startPoll(stageId, input = {}) {
    const engine = this.engine(stageId);
    const text = (v, def, max, label) => {
      const s = String(v ?? def).trim();
      if (!s || s.length > max) throw new HubError(`${label} không hợp lệ (tối đa ${max} ký tự)`);
      return s;
    };
    const question = String(input.question ?? '').trim().slice(0, 80);
    const labels = [text(input.labelA, 'A', 16, 'Tên đáp án A'), text(input.labelB, 'B', 16, 'Tên đáp án B')];
    const keywords = [text(input.keywordA, '1', 20, 'Từ khoá A'), text(input.keywordB, '2', 20, 'Từ khoá B')];
    if (keywords[0].toLowerCase().replace(/\s+/g, ' ') === keywords[1].toLowerCase().replace(/\s+/g, ' ')) throw new HubError('Hai từ khoá không được trùng nhau');
    const range = (v, def, min, max, label) => {
      const n = v === undefined || v === '' ? def : Number(v);
      if (!Number.isFinite(n) || n < min || n > max) throw new HubError(`${label} phải từ ${min} đến ${max}`);
      return n;
    };
    const durationSec = range(input.durationSec, 60, 10, 600, 'Thời lượng (giây)');
    const resultSec = range(input.resultSec, 8, 3, 60, 'Thời gian hiện kết quả (giây)');
    return engine.startPoll({ question, labels, keywords, durationSec, resultSec });
  }

  endPoll(stageId) {
    if (!this.engine(stageId).endPoll()) throw new HubError('Không có bình chọn đang diễn ra', 409);
    return { ok: true };
  }

  cancelPoll(stageId) {
    this.engine(stageId).cancelPoll();
    return { ok: true };
  }

  // ------------------------------------------------------------------ Test Panel
  /** Gửi event giả thẳng vào MỘT Stage được chọn (không đi qua Source thật). */
  simulate(stageId, input) {
    const engine = this.engine(stageId);
    const type = input.type;
    if (![EventType.JOIN, EventType.LIKE, EventType.GIFT, EventType.LEAVE, EventType.CHAT, EventType.FOLLOW, EventType.SHARE].includes(type)) throw new HubError('Loại event giả lập không hợp lệ');
    const username = this.#str(input.username || 'Test', 'Tên người xem test');
    const userId = String(input.userId || `sim-${createHash('sha1').update(username.toLowerCase()).digest('hex').slice(0, 10)}`);
    const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
    let gift = null;
    if (type === EventType.GIFT) {
      gift = {
        giftId: String(input.giftId || 'sim-gift'),
        giftName: String(input.giftName || 'Quà test'),
        diamondValue: num(input.diamondValue ?? input.value, 1),
        repeatCount: Math.max(1, Math.floor(num(input.repeatCount, 1))),
        streakEnded: input.streakEnded !== false,
        combo: !!input.combo,
      };
    }
    const evt = makeEvent({
      sourceId: 'sim',
      platform: 'test',
      userId,
      username,
      avatar: String(input.avatar || ''),
      eventType: type,
      value: type === EventType.LIKE ? Math.max(1, Math.floor(num(input.value, 1))) : 0,
      gift,
      text: type === EventType.CHAT ? String(input.text ?? '') : '',
      simulated: true,
    });
    engine.handle(evt);
    return { userKey: evt.userKey };
  }
}
