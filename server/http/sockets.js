import { Server } from 'socket.io';
import { parseCookies } from './auth.js';
import { verifySession } from './auth.js';

const room = (stageId) => `stage:${stageId}`;

export function attachSockets(httpServer, hub, config) {
  const io = new Server(httpServer, { serveClient: true });

  // ---- /overlay: mỗi Stage một "room"; cần stage_id + token hợp lệ ----
  const overlay = io.of('/overlay');
  overlay.use((socket, next) => {
    const a = socket.handshake.auth || {};
    const q = socket.handshake.query || {};
    const stageId = a.stage_id || q.stage_id;
    const token = a.token || q.token;
    const stage = hub.verifyOverlay(stageId, token);
    if (!stage) return next(new Error('unauthorized'));
    socket.data.stage = stage;
    next();
  });
  overlay.on('connection', (socket) => {
    const stage = socket.data.stage;
    socket.join(room(stage.id));
    // Server là nguồn chân lý: gửi snapshot đầy đủ mỗi khi (kết nối lại)
    socket.emit('init', { stage, snapshot: hub.engine(stage.id).snapshot() });
    socket.on('resync', () => socket.emit('snapshot', hub.engine(stage.id).snapshot()));
  });

  hub.on('patch', (stageId, patch) => {
    overlay.to(room(stageId)).emit(patch.full ? 'snapshot' : 'patch', patch.full ? stripFull(patch) : patch);
    if (patch.vip) admin.emit('vip', { stageId, vip: patch.vip });
  });
  hub.on('stageRemoved', (stageId) => overlay.in(room(stageId)).disconnectSockets(true));
  hub.on('stageTokenChanged', (stageId) => overlay.in(room(stageId)).disconnectSockets(true));

  // ---- /admin: cần phiên admin (cookie) ----
  const admin = io.of('/admin');
  admin.use((socket, next) => {
    const token = socket.handshake.auth?.token || parseCookies(socket.handshake.headers.cookie).adm;
    if (verifySession(config.sessionSecret, token)) return next();
    next(new Error('unauthorized'));
  });
  admin.on('connection', (socket) => socket.emit('statuses', hub.sourceStatuses()));
  hub.on('status', (st) => admin.emit('status', st));

  return io;
}

function stripFull(p) {
  const { full, ...rest } = p;
  return rest;
}
