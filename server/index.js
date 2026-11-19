import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';
import { config } from './config.js';
import { Db } from './db.js';
import { Hub } from './core/hub.js';
import { createAdminApi, errorHandler } from './http/adminApi.js';
import { attachSockets } from './http/sockets.js';
import { createAvatarHandler } from './http/avatarProxy.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const db = new Db(config.dbPath);
const hub = new Hub(db, config);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

app.get('/healthz', (req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.get('/avatar', createAvatarHandler({ hub, config }));
app.use('/api', createAdminApi(hub, config));
app.use('/overlay', express.static(join(root, 'overlay')));
app.use('/admin', express.static(join(root, 'admin')));
app.use('/shared', express.static(join(root, 'shared')));
app.get('/', (req, res) => res.redirect('/admin'));
app.use(errorHandler);

const server = createServer(app);
attachSockets(server, hub, config);
hub.start();

server.listen(config.port, () => console.log(`[server] http://localhost:${config.port}  (admin: /admin)`));

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`[server] ${signal}: đang lưu và thoát...`);
  server.close();
  await hub.stop();
  db.close();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
