import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StageEngine } from '../server/core/stageEngine.js';
import { makeEvent, EventType } from '../shared/events.js';

function setup(settings = {}) {
  const clock = { t: 1_000_000 };
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const engine = new StageEngine('s1', settings, { now: () => clock.t, random });
  const ev = (userId, eventType, extra = {}) =>
    makeEvent({ sourceId: 'src', platform: 'tiktok', userId, username: `U${userId}`, eventType, timestamp: clock.t, ...extra });
  const like = (u, n = 1) => engine.handle(ev(u, EventType.LIKE, { value: n }));
  const gift = (u, g = {}) =>
    engine.handle(ev(u, EventType.GIFT, { gift: { giftId: 'g1', diamondValue: 10, repeatCount: 1, streakEnded: true, combo: false, ...g } }));
  const advance = (ms) => {
    clock.t += ms;
    engine.tick();
  };
  const fieldKeys = () => engine.snapshot().users.map((u) => u.key);
  return { engine, clock, ev, like, gift, advance, fieldKeys };
}

test('join không sinh nhân vật; chỉ thả tim mới spawn', () => {
  const { engine, ev, like, fieldKeys } = setup();
  engine.handle(ev('a', EventType.JOIN));
  assert.deepEqual(fieldKeys(), []);
  like('a');
  assert.deepEqual(fieldKeys(), ['tiktok:a']);
});

test('tên chỉ chào 1 lần, kể cả khi ra rồi quay lại', () => {
  const { engine, like, advance } = setup({ greetSec: 3, idleTimeoutSec: 45 });
  like('a');
  const u = engine.users.get('tiktok:a');
  assert.ok(u.greetUntil > 0);
  const firstGreet = u.greetUntil;
  advance(46_000); // timeout -> rời sân
  assert.equal(u.visible, false);
  like('a'); // quay lại
  assert.equal(u.visible, true);
  assert.equal(u.greetUntil, firstGreet, 'không chào lại');
  assert.equal(u.hearts, 2, 'giữ nguyên dữ liệu cũ');
});

test('mốc tim: vượt ngưỡng kể cả khi event gộp nhiều tim', () => {
  const { engine, like } = setup({ heartsPerMove: 10 });
  like('a', 8); // 8
  const u = engine.users.get('tiktok:a');
  assert.equal(u.moveSeq, 0);
  like('a', 5); // 13 -> vượt 10 (không dừng đúng ở 10)
  assert.equal(u.moveSeq, 1);
  assert.ok(u.zUntil > 0);
  like('a', 30); // 43 -> vượt 20, 30, 40 nhưng chỉ kích hoạt 1 lần
  assert.equal(u.moveSeq, 2);
});

test('ngưỡng tim cấu hình theo Stage', () => {
  const { engine, like } = setup({ heartsPerMove: 3 });
  like('a', 3);
  assert.equal(engine.users.get('tiktok:a').moveSeq, 1);
});

test('quà không combo: mỗi event tính đúng giá trị', () => {
  const { engine, gift } = setup();
  gift('a', { diamondValue: 5, combo: false });
  gift('a', { diamondValue: 5, combo: false });
  assert.equal(engine.users.get('tiktok:a').giftTotal, 10);
});

test('quà combo: chỉ cộng phần chênh lệch, không tính trùng', () => {
  const { engine, gift } = setup();
  const g = (repeatCount, streakEnded) => gift('a', { diamondValue: 1, combo: true, repeatCount, streakEnded });
  g(1, false);
  g(2, false);
  g(5, false);
  assert.equal(engine.users.get('tiktok:a').giftTotal, 5);
  g(7, true); // kết thúc chuỗi
  assert.equal(engine.users.get('tiktok:a').giftTotal, 7);
  g(1, true); // chuỗi mới bắt đầu lại từ đầu
  assert.equal(engine.users.get('tiktok:a').giftTotal, 8);
});

test('Top VIP xếp theo tổng quà, hoà thì ai đạt trước thắng', () => {
  const { engine, clock, gift } = setup();
  gift('a', { diamondValue: 100 });
  clock.t += 1000;
  gift('b', { diamondValue: 100 }); // bằng a nhưng đến sau
  clock.t += 1000;
  gift('c', { diamondValue: 500 });
  assert.deepEqual(
    engine.snapshot().vip.map((v) => v.key),
    ['tiktok:c', 'tiktok:a', 'tiktok:b'],
  );
});

test('chỉ 5 ghế; người thứ 6 vào hạng được thì đẩy người cuối ra và người đó quay lại sân', () => {
  const { engine, gift, fieldKeys } = setup();
  for (const [u, v] of [['a', 60], ['b', 50], ['c', 40], ['d', 30], ['e', 20]]) gift(u, { diamondValue: v });
  assert.equal(engine.snapshot().vip.length, 5);
  assert.deepEqual(fieldKeys(), [], 'VIP không đứng dưới sân');
  gift('f', { diamondValue: 70 });
  const vip = engine.snapshot().vip.map((v) => v.key);
  assert.equal(vip[0], 'tiktok:f');
  assert.ok(!vip.includes('tiktok:e'));
  assert.ok(fieldKeys().includes('tiktok:e'), 'người bị đẩy khỏi top 5 trở lại sân');
});

test('ngưỡng quà tối thiểu để vào VIP', () => {
  const { engine, gift } = setup({ vipMinGift: 100 });
  gift('a', { diamondValue: 50 });
  assert.equal(engine.snapshot().vip.length, 0);
  gift('a', { diamondValue: 60 });
  assert.equal(engine.snapshot().vip.length, 1);
});

test('VIP không hoạt động -> "vắng" nhưng chưa mất ghế; hoạt động lại thì hết vắng', () => {
  const { engine, gift, like, advance } = setup({ vipAbsentSec: 60 });
  gift('a', { diamondValue: 100 });
  advance(61_000);
  assert.equal(engine.snapshot().vip[0].absent, true);
  assert.equal(engine.snapshot().vip.length, 1);
  like('a');
  assert.equal(engine.snapshot().vip[0].absent, false);
});

test('chính sách release: nhả ghế sau thời gian vắng dài, nhường người kế tiếp', () => {
  const { engine, gift, advance } = setup({ vipAbsentSec: 10, vipAbsentPolicy: 'release', vipReleaseSec: 100 });
  gift('a', { diamondValue: 100 });
  advance(50_000);
  gift('b', { diamondValue: 10 });
  advance(60_000); // a vắng tổng 110s > 100s
  assert.deepEqual(engine.snapshot().vip.map((v) => v.key), ['tiktok:b']);
});

test('Kick đá khỏi ghế cho tới khi tặng quà mới', () => {
  const { engine, gift } = setup();
  gift('a', { diamondValue: 100 });
  engine.kick('tiktok:a');
  assert.equal(engine.snapshot().vip.length, 0);
  gift('a', { diamondValue: 1 });
  assert.equal(engine.snapshot().vip.length, 1);
});

test('Max Slots: ẩn người tương tác gần nhất cũ nhất (LRU), dữ liệu vẫn giữ', () => {
  const { engine, clock, like, fieldKeys } = setup({ maxSlots: 3, minStaySec: 0 });
  for (const u of ['a', 'b', 'c']) {
    like(u);
    clock.t += 1000;
  }
  like('a'); // a mới tương tác lại -> b là cũ nhất
  clock.t += 1000;
  like('d');
  assert.equal(fieldKeys().length, 3);
  assert.ok(!fieldKeys().includes('tiktok:b'));
  assert.equal(engine.users.get('tiktok:b').hearts, 1, 'dữ liệu được giữ');
});

test('timeout tự rời sân nhưng không rời VIP', () => {
  const { engine, gift, like, advance, fieldKeys } = setup({ idleTimeoutSec: 45 });
  like('a');
  gift('v', { diamondValue: 100 });
  advance(46_000);
  assert.deepEqual(fieldKeys(), []);
  assert.equal(engine.snapshot().vip.length, 1);
});

test('người xem test tự xoá sau TTL', () => {
  const { engine, ev, advance } = setup({ simulatedTtlSec: 30 });
  engine.handle(ev('t1', EventType.LIKE, { value: 1, simulated: true }));
  assert.equal(engine.users.size, 1);
  advance(31_000);
  assert.equal(engine.users.size, 0);
});

test('reset VIP xoá điểm quà nhưng giữ nhân vật dưới sân', () => {
  const { engine, gift, like, fieldKeys } = setup();
  like('a');
  gift('v', { diamondValue: 100 });
  engine.resetVip();
  assert.equal(engine.snapshot().vip.length, 0);
  assert.equal(engine.users.get('tiktok:v').giftTotal, 0);
  assert.ok(fieldKeys().includes('tiktok:a'));
});

test('reset Stage xoá người dưới sân nhưng giữ VIP', () => {
  const { engine, gift, like, fieldKeys } = setup();
  like('a');
  gift('v', { diamondValue: 100 });
  engine.resetStage();
  assert.deepEqual(fieldKeys(), []);
  assert.equal(engine.snapshot().vip.length, 1);
});

test('patch gộp nhiều thay đổi và drain sạch', () => {
  const { engine, like } = setup();
  like('a');
  like('b');
  const p = engine.drainPatch();
  assert.equal(p.users.length, 2);
  assert.ok(p.effects.some((e) => e.type === 'spawn'));
  assert.equal(engine.drainPatch(), null);
});

test('xuất / nạp lại dữ liệu giữ nguyên bảng VIP (restart container)', () => {
  const a = setup();
  a.gift('x', { diamondValue: 100 });
  a.like('y', 5);
  const rows = JSON.parse(JSON.stringify(a.engine.exportUsers()));
  const b = setup();
  b.engine.importUsers(rows);
  assert.deepEqual(b.engine.snapshot().vip.map((v) => v.key), ['tiktok:x']);
  assert.equal(b.engine.users.get('tiktok:y').hearts, 5);
});

test('sân đầy: người mới không đẩy được người vừa xuất hiện (minStay) nhưng dữ liệu vẫn được giữ', () => {
  const { engine, clock, like, fieldKeys } = setup({ maxSlots: 2, minStaySec: 5 });
  like('a');
  like('b');
  like('c'); // sân đầy, a b mới xuất hiện < 5s
  assert.deepEqual(fieldKeys().sort(), ['tiktok:a', 'tiktok:b']);
  assert.equal(engine.users.get('tiktok:c').hearts, 1, 'tim vẫn được ghi nhận');
  clock.t += 6000;
  like('c'); // giờ a b đã ở đủ lâu -> đẩy người cũ nhất
  assert.ok(fieldKeys().includes('tiktok:c'));
  assert.equal(fieldKeys().length, 2);
});

test('patch gọn: người đã có trên overlay không gửi lại tên/avatar, trừ khi đổi', () => {
  const { engine, ev } = setup();
  engine.handle(ev('a', EventType.LIKE, { value: 1, avatar: 'https://i.pravatar.cc/1' }));
  const first = engine.drainPatch();
  assert.equal(first.users[0].avatar, 'https://i.pravatar.cc/1');
  engine.handle(ev('a', EventType.LIKE, { value: 1, avatar: 'https://i.pravatar.cc/1' }));
  const second = engine.drainPatch();
  assert.equal(second.users[0].avatar, undefined);
  engine.handle(ev('a', EventType.LIKE, { value: 1, avatar: 'https://i.pravatar.cc/2' }));
  assert.equal(engine.drainPatch().users[0].avatar, 'https://i.pravatar.cc/2');
});

test('giới hạn số hiệu ứng mỗi patch nhưng luôn giữ hiệu ứng VIP/quà', () => {
  const { engine, gift, like } = setup({ maxSlots: 200, minStaySec: 0 });
  for (let i = 0; i < 150; i++) like('u' + i);
  gift('rich', { diamondValue: 100 });
  const p = engine.drainPatch();
  assert.ok(p.effects.length <= 61 + 1);
  assert.ok(p.effects.some((e) => e.type === 'vipSeat'));
  assert.ok(p.effects.some((e) => e.type === 'gift'));
});

test('quà combo: hai chuỗi cùng loại quà (groupId khác nhau) đều được tính, không bị coi là một', () => {
  const { engine, gift } = setup();
  // dữ liệu thật: Whale diving 2150◆ tặng hai lần cách nhau, mỗi lần repeatCount=1 và không có repeatEnd
  gift('a', { giftId: 'w', groupId: 'g1', diamondValue: 2150, combo: true, repeatCount: 1, streakEnded: false });
  gift('a', { giftId: 'w', groupId: 'g2', diamondValue: 2150, combo: true, repeatCount: 1, streakEnded: false });
  assert.equal(engine.users.get('tiktok:a').giftTotal, 4300);
});

test('quà combo thật: event repeatEnd=0 rồi repeatEnd=1 cùng repeatCount chỉ tính một lần', () => {
  const { engine, gift } = setup();
  gift('a', { giftId: 'r', groupId: 'g1', diamondValue: 30, combo: true, repeatCount: 1, streakEnded: false });
  gift('a', { giftId: 'r', groupId: 'g1', diamondValue: 30, combo: true, repeatCount: 1, streakEnded: true });
  assert.equal(engine.users.get('tiktok:a').giftTotal, 30);
});

test('follow/share/bình luận: đủ tim cho mốc kế tiếp, di chuyển, nổi lên và hiện tên lâu hơn', () => {
  for (const type of [EventType.FOLLOW, EventType.SHARE, EventType.CHAT]) {
    const { engine, ev, clock } = setup({ heartsPerMove: 10, greetSec: 3, actionGreetSec: 5 });
    engine.handle(ev('a', type));
    const u = engine.users.get('tiktok:a');
    assert.equal(u.visible, true, `${type}: người mới xuất hiện`);
    assert.equal(u.hearts, 10, `${type}: bằng đúng lượng tim của một mốc`);
    assert.equal(u.moveSeq, 1, `${type}: có di chuyển`);
    assert.equal(u.greetUntil, clock.t + 5000, `${type}: tên hiện 5 giây thay vì 3`);
  }
});

test('hành động lên mốc kế tiếp từ số tim đang có (không cộng dư)', () => {
  const { engine, ev, like } = setup({ heartsPerMove: 10 });
  like('a', 3);
  engine.handle(ev('a', EventType.SHARE));
  assert.equal(engine.users.get('tiktok:a').hearts, 10);
  assert.equal(engine.users.get('tiktok:a').moveSeq, 1);
});

test('người đã được chào rồi vẫn hiện tên lại khi follow/share/bình luận', () => {
  const { engine, ev, like, clock } = setup({ greetSec: 3, actionGreetSec: 5 });
  like('a');
  clock.t += 20_000;
  engine.handle(ev('a', EventType.CHAT));
  assert.equal(engine.users.get('tiktok:a').greetUntil, clock.t + 5000);
});

test('khoảng nghỉ chống spam: bình luận dồn dập chỉ được thưởng một lần', () => {
  const { engine, ev, clock } = setup({ heartsPerMove: 10, actionCooldownSec: 10 });
  engine.handle(ev('a', EventType.CHAT));
  engine.handle(ev('a', EventType.CHAT));
  engine.handle(ev('a', EventType.FOLLOW));
  const u = engine.users.get('tiktok:a');
  assert.equal(u.hearts, 10);
  assert.equal(u.moveSeq, 1);
  clock.t += 11_000;
  engine.handle(ev('a', EventType.CHAT));
  assert.equal(u.hearts, 20, 'hết khoảng nghỉ thì được thưởng tiếp');
  assert.equal(u.moveSeq, 2);
});

test('người đang ngồi ghế VIP: hành động không làm họ rời ghế và không đổi bảng hạng', () => {
  const { engine, ev, gift } = setup();
  gift('v', { diamondValue: 100 });
  engine.handle(ev('v', EventType.SHARE));
  assert.deepEqual(engine.snapshot().vip.map((v) => v.key), ['tiktok:v']);
  assert.equal(engine.snapshot().users.length, 0);
});
