// Server đầy đủ + bộ phát tải trong tiến trình, để đo FPS overlay trong trình duyệt/OBS dưới tải lớn.
// Chạy: node --disable-warning=ExperimentalWarning bench/stressServer.mjs [likesPerSec=1000] [users=500] [port=3056]
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';
import { Db } from '../server/db.js';
import { Hub } from '../server/core/hub.js';
import { attachSockets } from '../server/http/sockets.js';
import { createAvatarHandler } from '../server/http/avatarProxy.js';
import { makeEvent, EventType } from '../shared/events.js';

const [rate = 1000, users = 500, port = 3056] = process.argv.slice(2).map(Number);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = { publicBaseUrl: '', signApiKey: '', tiktokDebugLog: false, sessionSecret: 'x', dbPath: join(root, 'data', 'bench.db'), avatarHosts: [] };

const db = new Db(':memory:');
const hub = new Hub(db, config);
const stage = hub.addStage({ name: 'stress', width: 1080, height: 1920, settings: { maxSlots: 30, simulatedTtlSec: 3600 } });
const src = hub.addSource({ platform: 'youtube', handle: 'stress', enabled: false });
hub.setRoutes(src.id, [stage.id]);
hub.start();

const app = express();
app.get('/avatar', createAvatarHandler({ hub, config }));
app.use('/overlay', express.static(join(root, 'overlay')));
const server = createServer(app);
attachSockets(server, hub, config);
server.listen(port);

const avatar = (i) => (i % 2 ? `https://i.pravatar.cc/96?img=${(i % 70) + 1}` : `https://api.dicebear.com/9.x/adventurer/png?size=96&seed=${i}`);
const mk = (u, type, extra = {}) =>
  makeEvent({ sourceId: src.id, platform: 'tiktok', userId: `u${u}`, username: `Người xem ${u}`, avatar: avatar(u), eventType: type, ...extra });

// 5 VIP có sẵn
[52000, 31800, 18500, 9900, 5200].forEach((v, i) =>
  hub.route(mk(i, EventType.GIFT, { gift: { giftId: 'g', diamondValue: v, repeatCount: 1, streakEnded: true, combo: false } })));

const t0 = Date.now();
let sent = 0;
setInterval(() => {
  const n = Math.max(0, Math.floor((rate * (Date.now() - t0)) / 1000) - sent);
  for (let i = 0; i < n; i++) {
    const u = 5 + Math.floor(Math.random() * users);
    const gift = Math.random() < 0.0005;
    hub.route(gift
      ? mk(u, EventType.GIFT, { gift: { giftId: 'g', diamondValue: 1 + Math.floor(Math.random() * 200), repeatCount: 1, streakEnded: true, combo: false } })
      : mk(u, EventType.LIKE, { value: 1 + Math.floor(Math.random() * 4) }));
    sent += 1;
  }
}, 5).unref?.();

console.log(`http://localhost:${port}/overlay?stage_id=${stage.id}&token=${stage.token}&bg=checker&fit=1&debug=1`);
console.log(`đang phát ~${rate} like/giây từ ${users} người xem`);
