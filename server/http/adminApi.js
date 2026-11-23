import { Router } from 'express';
import { HubError } from '../core/hub.js';
import { createSession, verifySession, safeEqual, tokenFromRequest, sessionCookie, clearCookie } from './auth.js';

/** Bọc handler async để lỗi được chuyển cho error middleware. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((r) => r !== undefined && res.json(r), next);

export function createAdminApi(hub, config) {
  const api = Router();

  // ---- đăng nhập (không cần phiên) ----
  api.post(
    '/login',
    wrap((req, res) => {
      if (!safeEqual(req.body?.password ?? '', config.adminPassword)) throw new HubError('Sai mật khẩu', 401);
      const token = createSession(config.sessionSecret, config.sessionTtlMs);
      res.setHeader('Set-Cookie', sessionCookie(token, config.sessionTtlMs));
      return { ok: true, token };
    }),
  );
  api.post('/logout', (req, res) => {
    res.setHeader('Set-Cookie', clearCookie());
    res.json({ ok: true });
  });

  // ---- mọi API bên dưới yêu cầu quyền admin (bao gồm Test Panel) ----
  api.use((req, res, next) => {
    if (verifySession(config.sessionSecret, tokenFromRequest(req))) return next();
    res.status(401).json({ error: 'Chưa đăng nhập' });
  });

  api.get('/me', (req, res) => res.json({ ok: true }));

  // Sources
  api.get('/sources', wrap(() => hub.listSources()));
  api.post('/sources', wrap((req) => hub.addSource(req.body || {})));
  api.put('/sources/:id', wrap((req) => hub.updateSource(req.params.id, req.body || {})));
  api.delete('/sources/:id', wrap(async (req) => (await hub.removeSource(req.params.id), { ok: true })));

  // Stages
  api.get('/stages', wrap(() => hub.listStages()));
  api.post('/stages', wrap((req) => hub.addStage(req.body || {})));
  api.get('/stages/:id', wrap((req) => hub.getStage(req.params.id)));
  api.put('/stages/:id', wrap((req) => hub.updateStage(req.params.id, req.body || {})));
  api.delete('/stages/:id', wrap((req) => (hub.removeStage(req.params.id), { ok: true })));
  api.post('/stages/:id/token', wrap((req) => hub.regenerateToken(req.params.id)));

  // Ghép nối Source -> Stage
  api.put('/sources/:id/routes', wrap((req) => (hub.setRoutes(req.params.id, req.body?.stageIds), { ok: true })));

  // Điều khiển trực tiếp
  api.get('/stages/:id/state', wrap((req) => ({ ...hub.engine(req.params.id).adminState(), snapshot: hub.engine(req.params.id).snapshot() })));
  api.post('/stages/:id/reset', wrap((req) => (hub.engine(req.params.id).resetStage({ hearts: !!req.body?.hearts }), { ok: true })));
  api.post('/stages/:id/reset-vip', wrap((req) => (hub.engine(req.params.id).resetVip(), { ok: true })));
  api.post('/stages/:id/reset-all', wrap((req) => (hub.engine(req.params.id).resetAll(), { ok: true })));
  api.post(
    '/stages/:id/kick',
    wrap((req) => {
      if (!hub.engine(req.params.id).kick(String(req.body?.userKey || ''))) throw new HubError('Không tìm thấy người dùng', 404);
      return { ok: true };
    }),
  );

  // Bình chọn 2 phe
  api.post('/stages/:id/poll', wrap((req) => hub.startPoll(req.params.id, req.body || {})));
  api.post('/stages/:id/poll/end', wrap((req) => hub.endPoll(req.params.id)));
  api.delete('/stages/:id/poll', wrap((req) => hub.cancelPoll(req.params.id)));

  // Xem thử hiệu ứng thả tim
  api.post('/stages/:id/preview-effect', wrap((req) => hub.previewEffect(req.params.id, req.body || {})));

  // Test Panel
  api.post('/stages/:id/simulate', wrap((req) => hub.simulate(req.params.id, req.body || {})));

  // Trạng thái kết nối các Source
  api.get('/status', wrap(() => hub.sourceStatuses()));

  return api;
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof HubError) return res.status(err.status).json({ error: err.message });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON không hợp lệ' });
  if (String(err?.message).includes('UNIQUE constraint')) return res.status(409).json({ error: 'Dữ liệu bị trùng' });
  console.error('[http] lỗi:', err);
  res.status(500).json({ error: 'Lỗi máy chủ' });
}
