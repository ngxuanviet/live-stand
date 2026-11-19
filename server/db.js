import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sources (
  id         TEXT PRIMARY KEY,
  platform   TEXT NOT NULL,
  handle     TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS stages (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  width      INTEGER NOT NULL DEFAULT 1080,
  height     INTEGER NOT NULL DEFAULT 1920,
  token      TEXT NOT NULL,
  settings   TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS routes (
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  stage_id  TEXT NOT NULL REFERENCES stages(id)  ON DELETE CASCADE,
  PRIMARY KEY (source_id, stage_id)
);
CREATE TABLE IF NOT EXISTS stage_users (
  stage_id   TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  user_key   TEXT NOT NULL,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (stage_id, user_key)
);
`;

/** Lớp mỏng bọc node:sqlite (không cần module native). */
export class Db {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;');
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  #tx(fn) {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ---- sources ----
  listSources() {
    return this.db.prepare('SELECT * FROM sources ORDER BY created_at').all().map((r) => ({ ...r, enabled: !!r.enabled }));
  }
  getSource(id) {
    const r = this.db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
    return r ? { ...r, enabled: !!r.enabled } : null;
  }
  insertSource({ id, platform, handle, enabled = true }) {
    this.db
      .prepare('INSERT INTO sources (id, platform, handle, enabled, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, platform, handle, enabled ? 1 : 0, Date.now());
  }
  updateSource(id, { handle, enabled }) {
    const cur = this.getSource(id);
    if (!cur) return false;
    this.db
      .prepare('UPDATE sources SET handle = ?, enabled = ? WHERE id = ?')
      .run(handle ?? cur.handle, (enabled ?? cur.enabled) ? 1 : 0, id);
    return true;
  }
  deleteSource(id) {
    this.db.prepare('DELETE FROM sources WHERE id = ?').run(id);
  }

  // ---- stages ----
  #stageRow(r) {
    return r ? { ...r, settings: JSON.parse(r.settings || '{}') } : null;
  }
  listStages() {
    return this.db.prepare('SELECT * FROM stages ORDER BY created_at').all().map((r) => this.#stageRow(r));
  }
  getStage(id) {
    return this.#stageRow(this.db.prepare('SELECT * FROM stages WHERE id = ?').get(id));
  }
  insertStage({ id, name, width, height, token, settings = {} }) {
    this.db
      .prepare('INSERT INTO stages (id, name, width, height, token, settings, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, name, width, height, token, JSON.stringify(settings), Date.now());
  }
  updateStage(id, patch) {
    const cur = this.getStage(id);
    if (!cur) return false;
    const next = { ...cur, ...patch, settings: { ...cur.settings, ...(patch.settings || {}) } };
    this.db
      .prepare('UPDATE stages SET name = ?, width = ?, height = ?, token = ?, settings = ? WHERE id = ?')
      .run(next.name, next.width, next.height, next.token, JSON.stringify(next.settings), id);
    return true;
  }
  deleteStage(id) {
    this.db.prepare('DELETE FROM stages WHERE id = ?').run(id);
  }

  // ---- routes ----
  listRoutes() {
    return this.db.prepare('SELECT source_id AS sourceId, stage_id AS stageId FROM routes').all();
  }
  setRoutesForSource(sourceId, stageIds) {
    this.#tx(() => {
      this.db.prepare('DELETE FROM routes WHERE source_id = ?').run(sourceId);
      const ins = this.db.prepare('INSERT OR IGNORE INTO routes (source_id, stage_id) VALUES (?, ?)');
      for (const s of stageIds) ins.run(sourceId, s);
    });
  }

  // ---- stage users (trạng thái game, lưu định kỳ) ----
  loadStageUsers(stageId) {
    return this.db
      .prepare('SELECT data FROM stage_users WHERE stage_id = ?')
      .all(stageId)
      .map((r) => JSON.parse(r.data));
  }
  saveStageUsers(stageId, users) {
    this.#tx(() => {
      this.db.prepare('DELETE FROM stage_users WHERE stage_id = ?').run(stageId);
      const ins = this.db.prepare('INSERT INTO stage_users (stage_id, user_key, data, updated_at) VALUES (?, ?, ?, ?)');
      const now = Date.now();
      for (const u of users) ins.run(stageId, u.userKey, JSON.stringify(u), now);
    });
  }
  clearStageUsers(stageId) {
    this.db.prepare('DELETE FROM stage_users WHERE stage_id = ?').run(stageId);
  }
}
