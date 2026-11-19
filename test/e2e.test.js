import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io } from 'socket.io-client';

const PORT = 3190 + Math.floor(Math.random() * 50);
const BASE = `http://127.0.0.1:${PORT}`;
let proc;
let dir;
let cookie = '';

const once = (socket, ev, ms = 3000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout chờ "${ev}"`)), ms);
    socket.once(ev, (d) => (clearTimeout(t), resolve(d)));
  });

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(auth && cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'kdl-'));
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: join(dir, 'e2e.db'), ADMIN_PASSWORD: 'pw-test', SESSION_SECRET: 'secret-test' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(BASE + '/healthz')).ok) return;
    } catch {
      /* chưa sẵn sàng */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server không khởi động');
});

after(() => {
  proc?.kill();
  setTimeout(() => rmSync(dir, { recursive: true, force: true }), 300);
});

test('API yêu cầu đăng nhập; sai mật khẩu bị từ chối', async () => {
  assert.equal((await api('/api/stages', { auth: false })).status, 401);
  assert.equal((await api('/api/login', { method: 'POST', body: { password: 'sai' }, auth: false })).status, 401);
  const ok = await api('/api/login', { method: 'POST', body: { password: 'pw-test' }, auth: false });
  assert.equal(ok.status, 200);
  cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.equal((await api('/api/stages')).status, 200);
});

test('Test Panel cũng yêu cầu đăng nhập', async () => {
  const r = await api('/api/stages/xxx/simulate', { method: 'POST', body: { type: 'like' }, auth: false });
  assert.equal(r.status, 401);
});

test('luồng đầy đủ: tạo Stage, overlay nhận snapshot + patch, VIP, kick, reset', async () => {
  const stage = (await api('/api/stages', { method: 'POST', body: { name: 'Main', width: 1080, height: 1920 } })).json;
  assert.ok(stage.token && stage.overlayUrl.includes(stage.id));

  // sai token bị từ chối
  const bad = io(BASE + '/overlay', { auth: { stage_id: stage.id, token: 'sai' }, reconnection: false });
  await once(bad, 'connect_error');
  bad.close();

  const sock = io(BASE + '/overlay', { auth: { stage_id: stage.id, token: stage.token }, reconnection: false });
  const init = await once(sock, 'init');
  assert.equal(init.stage.id, stage.id);
  assert.deepEqual(init.snapshot.users, []);

  // thả tim -> nhân vật xuất hiện, qua mốc 10 -> flash
  const patch1 = once(sock, 'patch');
  await api(`/api/stages/${stage.id}/simulate`, { method: 'POST', body: { type: 'like', username: 'Fan', value: 12 } });
  const p1 = await patch1;
  assert.equal(p1.users.length, 1);
  assert.equal(p1.users[0].name, 'Fan');
  assert.ok(p1.effects.some((e) => e.type === 'spawn'));
  assert.ok(p1.effects.some((e) => e.type === 'flash'));

  // tặng quà -> lên VIP
  const patch2 = once(sock, 'patch');
  await api(`/api/stages/${stage.id}/simulate`, { method: 'POST', body: { type: 'gift', username: 'Rich', diamondValue: 500 } });
  const p2 = await patch2;
  assert.equal(p2.vip.length, 1);
  assert.equal(p2.vip[0].rank, 1);
  assert.equal(p2.vip[0].giftTotal, 500);

  // kick -> mất ghế
  const state = (await api(`/api/stages/${stage.id}/state`)).json;
  const patch3 = once(sock, 'patch');
  await api(`/api/stages/${stage.id}/kick`, { method: 'POST', body: { userKey: state.vip[0].key } });
  assert.equal((await patch3).vip.length, 0);

  // reset stage -> snapshot đầy đủ rỗng người dưới sân
  const snap = once(sock, 'snapshot');
  await api(`/api/stages/${stage.id}/reset`, { method: 'POST', body: {} });
  assert.deepEqual((await snap).users, []);

  // đổi token -> overlay cũ bị ngắt
  const closed = once(sock, 'disconnect');
  await api(`/api/stages/${stage.id}/token`, { method: 'POST' });
  await closed;
  sock.close();
});

test('Source: thêm TikTok (tắt), ghép Stage, xem trạng thái; nền tảng sai bị từ chối', async () => {
  const stage = (await api('/api/stages', { method: 'POST', body: { name: 'S2' } })).json;
  const bad = await api('/api/sources', { method: 'POST', body: { platform: 'facebook', handle: 'x' } });
  assert.equal(bad.status, 400);
  const src = (await api('/api/sources', { method: 'POST', body: { platform: 'tiktok', handle: '@someone', enabled: false } })).json;
  assert.equal(src.handle, 'someone');
  assert.equal((await api(`/api/sources/${src.id}/routes`, { method: 'PUT', body: { stageIds: [stage.id] } })).status, 200);
  const list = (await api('/api/sources')).json;
  assert.deepEqual(list.find((s) => s.id === src.id).stageIds, [stage.id]);
  const yt = (await api('/api/sources', { method: 'POST', body: { platform: 'youtube', handle: 'abc', enabled: true } })).json;
  await new Promise((r) => setTimeout(r, 200));
  const st = (await api('/api/status')).json.find((s) => s.sourceId === yt.id);
  assert.equal(st.state, 'error'); // placeholder báo rõ chưa cài đặt
  assert.equal((await api(`/api/sources/${src.id}`, { method: 'DELETE' })).status, 200);
});

test('Dashboard: phục vụ trang tĩnh (không cần đăng nhập) nhưng mọi API vẫn cần đăng nhập', async () => {
  for (const p of ['/admin/', '/admin/app.js', '/admin/style.css', '/overlay/js/main.js']) {
    const r = await fetch(BASE + p);
    assert.equal(r.status, 200, p);
  }
  assert.equal((await api('/api/sources', { auth: false })).status, 401);
  assert.equal((await api('/api/stages/x/reset', { method: 'POST', auth: false })).status, 401);
});

test('Test Panel: tên có dấu tiếng Việt không bị trùng userId', async () => {
  const stage = (await api('/api/stages', { method: 'POST', body: { name: 'VN' } })).json;
  const sim = (username) => api(`/api/stages/${stage.id}/simulate`, { method: 'POST', body: { type: 'like', username } });
  const a = (await sim('Nhà giàu')).json.userKey;
  const b = (await sim('Nhu giau')).json.userKey;
  const c = (await sim('Nhà giàu')).json.userKey;
  assert.notEqual(a, b);
  assert.equal(a, c);
});
