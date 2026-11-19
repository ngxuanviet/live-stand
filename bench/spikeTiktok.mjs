// Spike: kết nối một phòng TikTok thật, thống kê event và in mẫu để xác nhận các trường.
// Chạy: node --disable-warning=ExperimentalWarning bench/spikeTiktok.mjs <username> [giây=60]
import { rmSync } from 'node:fs';
import { TikTokConnector } from '../server/connectors/tiktokConnector.js';

const [handle, secs = 60] = [process.argv[2], Number(process.argv[3]) || 60];
if (!handle) {
  console.error('Thiếu username');
  process.exit(1);
}
rmSync('data/raw-events.jsonl', { force: true });

const c = new TikTokConnector({ id: 'spike', handle: handle.replace(/^@/, '') }, { signApiKey: process.env.SIGN_API_KEY || '', debugLog: true });
const counts = {};
const samples = {};
const users = new Set();
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

c.on('status', (s) => console.log(`[${at()}] trạng thái: ${s.state}${s.detail ? ' — ' + s.detail : ''}`));
c.on('event', (e) => {
  counts[e.eventType] = (counts[e.eventType] || 0) + 1;
  users.add(e.userKey);
  (samples[e.eventType] ||= []).length < 3 && samples[e.eventType].push({ userKey: e.userKey, username: e.username, avatar: e.avatar.slice(0, 90), value: e.value, gift: e.gift });
});

await c.start();
await new Promise((r) => setTimeout(r, secs * 1000));
await c.stop();

console.log('\n=== TỔNG KẾT ===');
console.log('số event theo loại:', counts);
console.log('số người khác nhau:', users.size);
console.log('mẫu đã chuẩn hoá:');
console.log(JSON.stringify(samples, null, 1));
process.exit(0);
