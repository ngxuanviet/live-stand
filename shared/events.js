import { randomUUID } from 'node:crypto';

/** Các loại sự kiện chuẩn hoá. `leave` không được nền tảng đảm bảo (xem PRD v2 mục 4C). */
export const EventType = Object.freeze({
  JOIN: 'join',
  LIKE: 'like',
  GIFT: 'gift',
  LEAVE: 'leave',
  CHAT: 'chat',
  FOLLOW: 'follow',
  SHARE: 'share',
});

export const Platform = Object.freeze({
  TIKTOK: 'tiktok',
  YOUTUBE: 'youtube',
});

/** Khoá người dùng duy nhất: platform:userId (không dùng username vì có thể đổi). */
export function makeUserKey(platform, userId) {
  return `${platform}:${userId}`;
}

/**
 * Tạo Normalized Event.
 *
 * gift (chỉ với eventType = gift):
 *   giftId        id quà của nền tảng
 *   giftName      tên quà (hiển thị)
 *   diamondValue  giá trị 1 quà quy đổi diamond (0 nếu chưa biết)
 *   repeatCount   số lần tặng tích luỹ trong chuỗi combo tới thời điểm này
 *   streakEnded   chuỗi combo đã kết thúc
 *   combo         quà thuộc loại combo (nhiều event cho 1 chuỗi)
 *   groupId       id của chuỗi combo (mỗi lần bắt đầu một chuỗi là một id mới); có thể rỗng
 */
export function makeEvent({
  sourceId,
  platform,
  userId,
  username = '',
  avatar = '',
  eventType,
  value = 0,
  gift = null,
  text = '',
  simulated = false,
  timestamp = Date.now(),
}) {
  if (!sourceId || !platform || userId == null || !eventType) {
    throw new Error('makeEvent: thiếu sourceId / platform / userId / eventType');
  }
  return {
    eventId: randomUUID(),
    sourceId,
    platform,
    userKey: makeUserKey(platform, userId),
    userId: String(userId),
    username: String(username || userId),
    avatar: avatar || '',
    eventType,
    value: Number(value) || 0,
    gift,
    text: String(text ?? '').slice(0, 100), // nội dung bình luận (chỉ eventType = chat)
    simulated: !!simulated,
    timestamp,
  };
}
