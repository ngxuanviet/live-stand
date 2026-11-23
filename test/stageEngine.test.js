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

// ------------------------------------------------------------------ bình chọn 2 phe
const chat = (h, u, text) => h.engine.handle(h.ev(u, EventType.CHAT, { text }));
const startPoll = (h, cfg = {}) => h.engine.startPoll({ question: 'Q?', labels: ['Phở', 'Bún'], keywords: ['1', '2'], durationSec: 60, resultSec: 8, ...cfg });

test('poll: chỉ bình luận khớp từ khoá (bỏ hoa/thường, khoảng trắng) mới tính phiếu', () => {
  const h = setup();
  startPoll(h, { keywords: ['Phở', 'bún bò'] });
  chat(h, 'a', '  PHỞ ');
  chat(h, 'b', 'bún   bò');
  chat(h, 'c', 'xin chào');
  chat(h, 'd', '');
  assert.deepEqual(h.engine.snapshot().poll.counts, [1, 1]);
});

test('poll: đổi phe thì phiếu chuyển, tổng không đổi; phiếu không bị cooldown chặn', () => {
  const h = setup({ actionCooldownSec: 600 });
  startPoll(h);
  chat(h, 'a', '1');
  chat(h, 'a', '2'); // ngay lập tức, vẫn trong cooldown
  assert.deepEqual(h.engine.snapshot().poll.counts, [0, 1]);
  chat(h, 'a', '2'); // bầu lại cùng phe: không đếm hai lần
  assert.deepEqual(h.engine.snapshot().poll.counts, [0, 1]);
});

test('poll: nhân vật xuất hiện và di chuyển đúng nửa sân của phe mình', () => {
  const h = setup({ heartsPerMove: 1 });
  startPoll(h);
  for (let i = 0; i < 20; i++) {
    chat(h, `l${i}`, '1');
    chat(h, `r${i}`, '2');
  }
  for (let i = 0; i < 20; i++) {
    h.clock.t += 20_000; // qua cooldown để chat tiếp tục kích hoạt di chuyển
    chat(h, `l${i}`, 'ok');
    chat(h, `r${i}`, 'ok');
  }
  for (const u of h.engine.snapshot().users) {
    if (u.key.startsWith('tiktok:l')) assert.ok(u.pos.x <= 0.46 && u.side === 0, `${u.key} x=${u.pos.x}`);
    else assert.ok(u.pos.x >= 0.54 && u.side === 1, `${u.key} x=${u.pos.x}`);
  }
});

test('poll: người đang đứng bên kia đổi phe thì được đưa sang đúng nửa sân', () => {
  const h = setup();
  startPoll(h);
  chat(h, 'a', '1');
  const u = h.engine.users.get('tiktok:a');
  assert.ok(u.pos.x <= 0.46);
  const seq = u.moveSeq;
  chat(h, 'a', '2');
  assert.ok(u.pos.x >= 0.54);
  assert.ok(u.moveSeq > seq);
});

test('poll: hết giờ chốt kết quả, hoà là tie, hết thời gian hiện kết quả thì xoá poll và bỏ phe', () => {
  const h = setup();
  startPoll(h, { durationSec: 10, resultSec: 5 });
  chat(h, 'a', '1');
  chat(h, 'b', '2');
  h.engine.drainPatch();
  h.advance(10_000);
  let p = h.engine.snapshot().poll;
  assert.equal(p.status, 'result');
  assert.equal(p.result, 'tie');
  const patch = h.engine.drainPatch();
  assert.ok(patch.effects.some((e) => e.type === 'pollWin' && e.side === null));
  chat(h, 'c', '1'); // phiếu sau khi hết giờ bị bỏ qua
  assert.deepEqual(h.engine.snapshot().poll.counts, [1, 1]);
  h.advance(5_000);
  assert.equal(h.engine.snapshot().poll, null);
  const after = h.engine.drainPatch();
  assert.equal(after.poll, null);
  assert.ok(after.users.every((u) => u.side === null));
});

test('poll: phe nhiều phiếu hơn thắng', () => {
  const h = setup();
  startPoll(h, { durationSec: 10 });
  chat(h, 'a', '2');
  chat(h, 'b', '2');
  chat(h, 'c', '1');
  assert.equal(h.engine.endPoll(), true);
  assert.equal(h.engine.snapshot().poll.result, 1);
  assert.equal(h.engine.endPoll(), false); // đã chốt
});

test('poll: snapshot không lộ danh sách phiếu; huỷ poll xoá phe; resetAll xoá poll', () => {
  const h = setup();
  startPoll(h);
  chat(h, 'a', '1');
  const s = JSON.stringify(h.engine.snapshot().poll);
  assert.ok(!s.includes('tiktok:a'));
  h.engine.drainPatch();
  assert.equal(h.engine.cancelPoll(), true);
  assert.equal(h.engine.snapshot().poll, null);
  assert.equal(h.engine.snapshot().users[0].side, null);
  startPoll(h);
  h.engine.resetAll();
  assert.equal(h.engine.snapshot().poll, null);
});

test('poll: VIP đã bầu có side trong view VIP (xuống làm lead), chưa bầu thì null; huỷ poll trả về null', () => {
  const h = setup();
  h.gift('v1', { diamondValue: 500 });
  h.gift('v2', { diamondValue: 100 });
  startPoll(h);
  chat(h, 'v1', '2');
  const vip = () => Object.fromEntries(h.engine.snapshot().vip.map((v) => [v.key, v.side]));
  assert.deepEqual(vip(), { 'tiktok:v1': 1, 'tiktok:v2': null });
  assert.equal(h.engine.drainPatch().vip.find((v) => v.key === 'tiktok:v1').side, 1);
  assert.ok(!h.fieldKeys().includes('tiktok:v1')); // vẫn không phải người dưới sân phía server
  h.engine.cancelPoll();
  assert.deepEqual(vip(), { 'tiktok:v1': null, 'tiktok:v2': null });
  assert.ok(h.engine.drainPatch().vip); // báo overlay cho VIP về ghế
});

// ---------------------------------------------------------------- hiệu ứng theo mốc tim
const TOTAL = [{ hearts: 30, effect: 'hop3' }, { hearts: 100, effect: 'spin' }, { hearts: 300, effect: 'rocket' }];
const BURST = [{ hearts: 10, windowSec: 5, effect: 'sway' }, { hearts: 30, windowSec: 10, effect: 'confetti' }];
const tiers = (engine) => (engine.drainPatch()?.effects || []).filter((e) => e.type === 'tier');

test('mốc tim: mặc định không có mốc nào thì không phát hiệu ứng', () => {
  const { engine, like } = setup();
  like('a', 500);
  assert.deepEqual(tiers(engine), []);
});

test('mốc tổng: bắn đúng một lần khi chạm ngưỡng, không bắn lại ở lần thả tim kế', () => {
  const { engine, like } = setup({ tierTotal: TOTAL });
  like('a', 29);
  assert.deepEqual(tiers(engine), []);
  like('a', 1);
  const [e] = tiers(engine);
  assert.equal(e.effect, 'hop3');
  assert.equal(e.kind, 'total');
  assert.equal(e.level, 1);
  assert.equal(e.hearts, 30);
  like('a', 1);
  assert.deepEqual(tiers(engine), []);
});

test('mốc tổng: một event vượt nhiều mốc chỉ phát mốc cao nhất', () => {
  const { engine, like } = setup({ tierTotal: TOTAL });
  like('a', 150);
  const list = tiers(engine);
  assert.equal(list.length, 1);
  assert.equal(list[0].effect, 'spin');
  assert.equal(list[0].level, 2);
});

test('mốc tổng: độ mạnh tăng theo vị trí mốc (1 đến 3)', () => {
  const { engine, like } = setup({ tierTotal: TOTAL });
  like('a', 30);
  assert.equal(tiers(engine)[0].intensity, 1);
  like('a', 300);
  assert.equal(tiers(engine)[0].intensity, 3);
});

test('mốc tim: follow / share / bình luận cũng là tim và có thể chạm mốc', () => {
  for (const type of [EventType.FOLLOW, EventType.SHARE, EventType.CHAT]) {
    const { engine, ev } = setup({ heartsPerMove: 10, tierTotal: [{ hearts: 10, effect: 'hop3' }] });
    engine.handle(ev('a', type));
    assert.equal(tiers(engine)[0]?.effect, 'hop3', type);
  }
});

test('mốc dồn dập: đủ X tim trong Y giây thì bắn, quá cửa sổ thì không', () => {
  const a = setup({ tierBurst: [BURST[0]] });
  a.like('a', 4);
  a.clock.t += 1000;
  a.like('a', 6);
  const [e] = tiers(a.engine);
  assert.equal(e.effect, 'sway');
  assert.equal(e.kind, 'burst');

  const b = setup({ tierBurst: [BURST[0]] });
  b.like('a', 6);
  b.clock.t += 6000; // quá cửa sổ 5 giây
  b.like('a', 6);
  assert.deepEqual(tiers(b.engine), []);
});

test('mốc dồn dập: có khoảng nghỉ, không bắn lại mỗi lần thả tim', () => {
  const { engine, clock, like } = setup({ tierBurst: [BURST[0]] });
  like('a', 10);
  assert.equal(tiers(engine).length, 1);
  clock.t += 1000;
  like('a', 10); // còn trong khoảng nghỉ
  assert.deepEqual(tiers(engine), []);
  clock.t += 5000;
  like('a', 10); // hết khoảng nghỉ
  assert.equal(tiers(engine).length, 1);
});

test('mốc tim: mốc tổng thắng mốc dồn dập khi cùng một event', () => {
  const { engine, like } = setup({ tierTotal: [{ hearts: 10, effect: 'hop3' }], tierBurst: [{ hearts: 5, windowSec: 5, effect: 'sway' }] });
  like('a', 10);
  const list = tiers(engine);
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'total');
});

test('mốc tim: hai hiệu ứng của cùng một người trong một patch chỉ còn hiệu ứng cao nhất', () => {
  const { engine, like } = setup({ tierTotal: TOTAL });
  like('a', 30);
  like('a', 70); // 100
  const list = tiers(engine);
  assert.equal(list.length, 1);
  assert.equal(list[0].effect, 'spin');
});

test('mốc tim: lưu rồi nạp lại không bắn lại; bw/bwCool không được lưu', () => {
  const a = setup({ tierTotal: TOTAL, tierBurst: BURST });
  a.like('x', 30);
  const rows = JSON.parse(JSON.stringify(a.engine.exportUsers()));
  assert.equal('bw' in rows[0], false);
  assert.equal('bwCool' in rows[0], false);
  const b = setup({ tierTotal: TOTAL });
  b.engine.importUsers(rows);
  b.like('x', 1);
  assert.deepEqual(tiers(b.engine), []);
  b.like('x', 70); // chạm 100 thì vẫn bắn bình thường
  assert.equal(tiers(b.engine)[0]?.effect, 'spin');
});

test('mốc tim: reset sân khấu kèm tim thì tính lại từ đầu', () => {
  const { engine, like } = setup({ tierTotal: TOTAL });
  like('a', 30);
  tiers(engine);
  engine.resetStage({ hearts: true });
  engine.drainPatch();
  like('a', 30);
  assert.equal(tiers(engine)[0]?.effect, 'hop3');
});

test('mốc tim: thêm mốc thấp hơn số tim đang có không bắn hồi tố', () => {
  const { engine, like } = setup({ tierTotal: [{ hearts: 100, effect: 'spin' }] });
  like('a', 50);
  tiers(engine);
  engine.setSettings({ tierTotal: [{ hearts: 20, effect: 'hop3' }, { hearts: 100, effect: 'spin' }] });
  like('a', 1);
  assert.deepEqual(tiers(engine), []);
});

test('mốc tim: người diễn được nổi lên trên cùng và hiện tên suốt thời gian diễn', () => {
  const { engine, clock, like } = setup({ zBoostSec: 1, tierTotal: [{ hearts: 30, effect: 'fireworks' }] }); // zBoostSec nhỏ để thấy rõ phần kéo dài của hiệu ứng
  like('a', 30);
  const p = engine.drainPatch();
  const u = engine.users.get('tiktok:a');
  assert.equal(u.zUntil, clock.t + 2600 + 800);
  assert.equal(u.greetUntil, clock.t + 2600 + 800);
  const view = p.users.find((v) => v.key === 'tiktok:a');
  assert.equal(view.zUntil, u.zUntil, 'view gửi cho overlay có zUntil mới');
  assert.equal(view.greetUntil, u.greetUntil);
});

test('mốc tim: quá nhiều hiệu ứng trong một patch thì giữ tối đa 12 và vẫn không bị capEffects cắt', () => {
  const { engine, like } = setup({ maxSlots: 200, minStaySec: 0, tierTotal: [{ hearts: 1, effect: 'hop3' }] });
  for (let i = 0; i < 100; i++) like('u' + i);
  const p = engine.drainPatch();
  assert.equal(p.effects.filter((e) => e.type === 'tier').length, 12);
  assert.ok(p.effects.length <= 60);
});

test('mốc tim: VIP đang ngồi ghế cũng diễn, nhưng không bị di chuyển hay chớp', () => {
  const { engine, gift, like } = setup({ tierTotal: [{ hearts: 30, effect: 'spin' }] });
  gift('v', { diamondValue: 100 });
  engine.drainPatch();
  like('v', 30);
  const p = engine.drainPatch();
  const t = p.effects.find((e) => e.type === 'tier');
  assert.equal(t.userKey, 'tiktok:v');
  assert.equal(t.vip, true);
  assert.ok(!p.effects.some((e) => e.type === 'flash'));
  assert.equal(p.users.length, 0, 'VIP không nằm trong danh sách người dưới sân');
  assert.ok(p.vip, 'bảng VIP vẫn được cập nhật');
});

test('mốc tim: VIP mất ghế rồi lên lại không bắn lại mốc đã qua', () => {
  const { engine, gift, like } = setup({ tierTotal: [{ hearts: 30, effect: 'spin' }] });
  gift('v', { diamondValue: 100 });
  like('v', 30);
  tiers(engine);
  engine.kick('tiktok:v');
  gift('v', { diamondValue: 1 });
  engine.drainPatch();
  like('v', 1);
  assert.deepEqual(tiers(engine), []);
});

test('xem thử hiệu ứng: trên VIP và người dưới sân, không đổi số tim', () => {
  const { engine, gift, like } = setup();
  gift('v', { diamondValue: 100 });
  like('a', 5);
  engine.drainPatch();
  assert.equal(engine.previewTier('tiktok:v', 'rocket', 2), true);
  let list = tiers(engine);
  assert.equal(list[0].kind, 'preview');
  assert.equal(list[0].vip, true);
  assert.equal(list[0].intensity, 2);
  assert.equal(engine.previewTier('tiktok:a', 'confetti'), true);
  list = tiers(engine);
  assert.equal(list[0].effect, 'confetti');
  assert.equal(engine.users.get('tiktok:a').hearts, 5);
  assert.equal(engine.previewTier('tiktok:nobody', 'confetti'), false);
  assert.equal(engine.previewTier('tiktok:a', 'khong-co'), false);
});

test('người xem test được giữ sống khi còn hoạt động, hết hạn sau lần hoạt động cuối', () => {
  const { engine, ev, clock } = setup({ simulatedTtlSec: 30 });
  engine.handle(ev('t', EventType.LIKE, { value: 1, simulated: true }));
  clock.t += 20_000;
  engine.handle(ev('t', EventType.LIKE, { value: 1, simulated: true }));
  clock.t += 20_000; // đã 40 giây từ lúc tạo nhưng mới 20 giây từ lần hoạt động cuối
  engine.tick();
  assert.equal(engine.users.size, 1);
  clock.t += 11_000;
  engine.tick();
  assert.equal(engine.users.size, 0);
});
