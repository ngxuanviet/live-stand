import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../server/db.js';
import { Hub, HubError } from '../server/core/hub.js';
import { makeEvent, EventType } from '../shared/events.js';

const config = { publicBaseUrl: 'https://x.test', signApiKey: '', tiktokDebugLog: false };

function makeHub() {
  const db = new Db(':memory:');
  return { db, hub: new Hub(db, config) };
}

const giftEvt = (sourceId, platform, userId, value) =>
  makeEvent({
    sourceId,
    platform,
    userId,
    eventType: EventType.GIFT,
    gift: { giftId: 'g', diamondValue: value, repeatCount: 1, streakEnded: true, combo: false },
  });

test('Stage: tạo có token và link overlay, token xác thực đúng', () => {
  const { hub } = makeHub();
  const st = hub.addStage({ name: 'Main', width: 1080, height: 1920 });
  assert.match(st.overlayUrl, /^https:\/\/x\.test\/overlay\?stage_id=stage_/);
  assert.ok(hub.verifyOverlay(st.id, st.token));
  assert.equal(hub.verifyOverlay(st.id, 'sai-token'), null);
  const st2 = hub.regenerateToken(st.id);
  assert.notEqual(st2.token, st.token);
  assert.equal(hub.verifyOverlay(st.id, st.token), null);
});

test('Router 1-1: mỗi Stage chỉ nhận dữ liệu từ Source được ghép', () => {
  const { hub } = makeHub();
  const a = hub.addStage({ name: 'A' });
  const b = hub.addStage({ name: 'B' });
  const s1 = hub.addSource({ platform: 'youtube', handle: 'yt1', enabled: false });
  const s2 = hub.addSource({ platform: 'youtube', handle: 'yt2', enabled: false });
  hub.setRoutes(s1.id, [a.id]);
  hub.setRoutes(s2.id, [b.id]);
  hub.route(giftEvt(s1.id, 'tiktok', 'u1', 10));
  assert.equal(hub.engine(a.id).users.size, 1);
  assert.equal(hub.engine(b.id).users.size, 0);
});

test('Router N-1: hai Source đổ vào một Stage, điểm không bị cộng hai lần', () => {
  const { hub } = makeHub();
  const main = hub.addStage({ name: 'Main' });
  const s1 = hub.addSource({ platform: 'youtube', handle: 'yt1', enabled: false });
  const s2 = hub.addSource({ platform: 'youtube', handle: 'yt2', enabled: false });
  hub.setRoutes(s1.id, [main.id]);
  hub.setRoutes(s2.id, [main.id]);
  hub.route(giftEvt(s1.id, 'tiktok', 'u1', 10));
  hub.route(giftEvt(s2.id, 'youtube', 'u1', 20)); // khác nền tảng -> người khác
  const eng = hub.engine(main.id);
  assert.equal(eng.users.get('tiktok:u1').giftTotal, 10);
  assert.equal(eng.users.get('youtube:u1').giftTotal, 20);
});

test('Một Source gắn 2 Stage: điểm độc lập, reset Stage này không ảnh hưởng Stage kia', () => {
  const { hub } = makeHub();
  const a = hub.addStage({ name: 'A' });
  const b = hub.addStage({ name: 'B' });
  const s = hub.addSource({ platform: 'youtube', handle: 'yt', enabled: false });
  hub.setRoutes(s.id, [a.id, b.id]);
  hub.route(giftEvt(s.id, 'tiktok', 'u1', 10));
  hub.engine(a.id).resetVip();
  assert.equal(hub.engine(a.id).users.get('tiktok:u1').giftTotal, 0);
  assert.equal(hub.engine(b.id).users.get('tiktok:u1').giftTotal, 10);
});

test('Test Panel: người xem test chỉ vào Stage được chọn và có nhãn simulated', () => {
  const { hub } = makeHub();
  const a = hub.addStage({ name: 'A' });
  const b = hub.addStage({ name: 'B' });
  hub.simulate(a.id, { type: 'like', username: 'Tester', value: 10 });
  assert.equal(hub.engine(a.id).users.size, 1);
  assert.equal(hub.engine(b.id).users.size, 0);
  assert.equal([...hub.engine(a.id).users.values()][0].simulated, true);
  assert.throws(() => hub.simulate(a.id, { type: 'xyz', username: 't' }), HubError);
});

test('Lưu và nạp lại trạng thái từ SQLite (restart)', () => {
  const db = new Db(':memory:');
  const hub1 = new Hub(db, config);
  const st = hub1.addStage({ name: 'A' });
  hub1.simulate(st.id, { type: 'gift', username: 'Rich', diamondValue: 100 });
  hub1.saveAll(true);
  const hub2 = new Hub(db, config);
  hub2.start();
  try {
    assert.equal(hub2.engine(st.id).snapshot().vip.length, 1);
  } finally {
    clearInterval(hub2._timer);
  }
});

test('Validation: kích thước, cấu hình sai bị từ chối', () => {
  const { hub } = makeHub();
  assert.throws(() => hub.addStage({ name: 'x', width: 5 }), HubError);
  const st = hub.addStage({ name: 'ok' });
  assert.throws(() => hub.updateStage(st.id, { settings: { maxSlots: 9999 } }), HubError);
  const upd = hub.updateStage(st.id, { settings: { heartsPerMove: 7 } });
  assert.equal(upd.settings.heartsPerMove, 7);
  assert.equal(hub.engine(st.id).settings.heartsPerMove, 7);
});

test('Test Panel: giả lập follow / share / bình luận', () => {
  const { hub } = makeHub();
  const st = hub.addStage({ name: 'A' });
  for (const type of ['follow', 'share', 'chat']) hub.simulate(st.id, { type, username: `U-${type}` });
  assert.equal(hub.engine(st.id).snapshot().users.length, 3);
});

test('Giới hạn chiều cao vùng sân: cấu hình hợp lệ được lưu, giá trị sai bị từ chối', () => {
  const { hub } = makeHub();
  const st = hub.addStage({ name: 'F' });
  assert.equal(st.settings.fieldHeightPx, 0, 'mặc định 0 = tự động');
  assert.equal(hub.updateStage(st.id, { settings: { fieldHeightPx: 450 } }).settings.fieldHeightPx, 450);
  assert.equal(hub.engine(st.id).settings.fieldHeightPx, 450);
  assert.throws(() => hub.updateStage(st.id, { settings: { fieldHeightPx: -5 } }), HubError);
  assert.throws(() => hub.updateStage(st.id, { settings: { fieldHeightPx: 99999 } }), HubError);
});
