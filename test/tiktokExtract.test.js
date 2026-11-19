import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractUser, extractGift, extractLikeCount } from '../server/connectors/tiktokConnector.js';

// Dạng dữ liệu lấy từ phòng live thật (rút gọn, đã ẩn thông tin cá nhân).
const user = {
  id: '6571676082302484482',
  nickname: 'Người xem A',
  displayId: 'nguoixema',
  avatarThumb: { urlList: ['https://p16-common-sign.tiktokcdn.com/tos-alisg-avt-0068/abc~tplv.webp?x-expires=1', 'https://p19-common-sign.tiktokcdn.com/x'] },
};

test('user: lấy id số, nickname và avatar đầu tiên', () => {
  const u = extractUser({ user });
  assert.equal(u.userId, '6571676082302484482');
  assert.equal(u.username, 'Người xem A');
  assert.match(u.avatar, /^https:\/\/p16-common-sign\.tiktokcdn\.com\//);
});

test('user: thiếu thông tin thì userId = null (bị bỏ qua)', () => {
  assert.equal(extractUser({}).userId, null);
});

test('quà không combo: đọc id, tên, giá diamond từ data.gift', () => {
  const g = extractGift({ giftId: '7934', repeatCount: 1, repeatEnd: 0, comboCount: 1, gift: { id: '7934', name: 'Heart Me', diamondCount: 1, combo: false, type: 4 } });
  assert.deepEqual(g, { giftId: '7934', groupId: '', giftName: 'Heart Me', diamondValue: 1, repeatCount: 1, streakEnded: false, combo: false });
});

test('quà combo: nhận biết combo và kết thúc chuỗi', () => {
  const g = extractGift({ giftId: '5655', repeatCount: 7, repeatEnd: 1, gift: { id: '5655', name: 'Rose', diamondCount: 1, combo: true, type: 1 } });
  assert.equal(g.combo, true);
  assert.equal(g.streakEnded, true);
  assert.equal(g.repeatCount, 7);
});

test('quà: dạng cũ (giftDetails) vẫn đọc được', () => {
  const g = extractGift({ giftId: '1', repeatCount: 2, repeatEnd: false, giftDetails: { giftType: 1, diamondCount: 5, giftName: 'Old' } });
  assert.equal(g.diamondValue, 5);
  assert.equal(g.combo, true);
  assert.equal(g.giftName, 'Old');
});

test('like: dùng count của event, không dùng total của cả phòng', () => {
  assert.equal(extractLikeCount({ count: 5, total: '4017' }), 5);
  assert.equal(extractLikeCount({ total: '4017' }), 1);
  assert.equal(extractLikeCount({ count: 0 }), 1);
});
