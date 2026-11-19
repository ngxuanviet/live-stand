// Đo tải phía server: event/giây đi qua Router + StageEngine + gộp patch + phát Socket.IO tới nhiều overlay.
// Chạy: node --disable-warning=ExperimentalWarning bench/serverLoad.mjs [rate=1000] [users=500] [seconds=10] [clients=3]
import { createServer } from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { io } from 'socket.io-client';
import { Db } from '../server/db.js';
import { Hub } from '../server/core/hub.js';
import { attachSockets } from '../server/http/sockets.js';
import { makeEvent, EventType } from '../shared/events.js';

const [rate = 1000, users = 500, seconds = 10, clients = 3] = process.argv.slice(2).map(Number);
const config = { publicBaseUrl: '', signApiKey: '', tiktokDebugLog: false, sessionSecret: 'x', dbPath: ':memory:' };

const db = new Db(':memory:');
const hub = new Hub(db, config);
const stage = hub.addStage({ name: 'bench', settings: { maxSlots: 30, simulatedTtlSec: 3600 } });
const src = hub.addSource({ platform: 'youtube', handle: 'bench', enabled: false });
hub.setRoutes(src.id, [stage.id]);
hub.start();

const server = createServer();
attachSockets(server, hub, config);
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

// ---- các overlay giả ----
const lat = [];
let patches = 0;
let bytes = 0;
const sockets = [];
for (let i = 0; i < clients; i++) {
  const s = io(`http://127.0.0.1:${port}/overlay`, { auth: { stage_id: stage.id, token: stage.token }, transports: ['websocket'] });
  s.on('patch', (p) => {
    patches += 1;
    bytes += JSON.stringify(p).length;
    if (i === 0) lat.push(Date.now() - p.serverNow);
  });
  sockets.push(s);
}
await new Promise((r) => setTimeout(r, 500));

// ---- phát event theo nhịp 10ms ----
const eventLoop = monitorEventLoopDelay({ resolution: 1 });
eventLoop.enable();
let sent = 0;
let giftsSent = 0;
const t0 = process.hrtime.bigint();
const cpu0 = process.cpuUsage();
const mem0 = process.memoryUsage().rss;
let routeNs = 0n;
const timer = setInterval(() => {
  // theo thời gian thực đã trôi qua (setInterval trên Windows chỉ chính xác ~15ms)
  const elapsed = Number(process.hrtime.bigint() - t0) / 1e9;
  const n = Math.max(0, Math.floor(rate * elapsed) - sent);
  for (let i = 0; i < n; i++) {
    const u = Math.floor(Math.random() * users);
    const gift = Math.random() < 0.002; // ~0,2% là quà
    const evt = makeEvent({
      sourceId: src.id,
      platform: 'tiktok',
      userId: `u${u}`,
      username: `User ${u}`,
      eventType: gift ? EventType.GIFT : EventType.LIKE,
      value: gift ? 0 : 1 + Math.floor(Math.random() * 5),
      gift: gift ? { giftId: 'g1', diamondValue: 1 + Math.floor(Math.random() * 100), repeatCount: 1, streakEnded: true, combo: false } : null,
    });
    const a = process.hrtime.bigint();
    hub.route(evt);
    routeNs += process.hrtime.bigint() - a;
    sent += 1;
    if (gift) giftsSent += 1;
  }
}, 10);

await new Promise((r) => setTimeout(r, seconds * 1000));
clearInterval(timer);
await new Promise((r) => setTimeout(r, 400));
const wall = Number(process.hrtime.bigint() - t0) / 1e9;
const cpu = process.cpuUsage(cpu0);
eventLoop.disable();

lat.sort((a, b) => a - b);
const pct = (p) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))] ?? 0;
const eng = hub.engine(stage.id);
console.log(JSON.stringify({
  cấuHình: { eventMỗiGiây: rate, ngườiXem: users, giây: seconds, overlay: clients },
  eventĐãGửi: sent,
  quà: giftsSent,
  eventThựcTế_mỗiGiây: Math.round(sent / seconds),
  routeEvent_µs_trungBình: Number((Number(routeNs) / sent / 1000).toFixed(2)),
  cpu_phầnTrămMộtCore: Number((((cpu.user + cpu.system) / 1000 / (wall * 1000)) * 100).toFixed(1)),
  eventLoopTrễ_ms: { trungBình: Number((eventLoop.mean / 1e6).toFixed(2)), p99: Number((eventLoop.percentile(99) / 1e6).toFixed(2)), max: Number((eventLoop.max / 1e6).toFixed(2)) },
  patchMỗiGiây: Number((patches / clients / wall).toFixed(1)),
  băngThôngMỗiOverlay_KBs: Number((bytes / clients / wall / 1024).toFixed(1)),
  độTrễEventĐếnOverlay_ms: { p50: pct(0.5), p95: pct(0.95), max: lat[lat.length - 1] ?? 0 },
  trạngThái: { ngườiDướiSân: eng.adminState().fieldCount, tổngUser: eng.users.size, vip: eng.vipKeys.length },
  rssTăng_MB: Number(((process.memoryUsage().rss - mem0) / 1048576).toFixed(1)),
}, null, 2));

for (const s of sockets) s.close();
clearInterval(hub._timer);
server.close();
process.exit(0);
