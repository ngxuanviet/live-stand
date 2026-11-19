import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedAvatarUrl } from '../server/http/avatarProxy.js';

test('chỉ cho phép https tới host trong danh sách', () => {
  assert.equal(isAllowedAvatarUrl('https://p16-sign.tiktokcdn.com/a.jpeg'), true);
  assert.equal(isAllowedAvatarUrl('https://i.pravatar.cc/96?img=3'), true);
  assert.equal(isAllowedAvatarUrl('http://p16-sign.tiktokcdn.com/a.jpeg'), false, 'không https');
  assert.equal(isAllowedAvatarUrl('https://evil.com/a.jpg'), false);
  assert.equal(isAllowedAvatarUrl('https://tiktokcdn.com.evil.com/a.jpg'), false, 'đuôi host giả');
  assert.equal(isAllowedAvatarUrl('https://nottiktokcdn.com/a.jpg'), false);
  assert.equal(isAllowedAvatarUrl('https://127.0.0.1/a.jpg'), false);
  assert.equal(isAllowedAvatarUrl('https://user:pw@i.pravatar.cc/a'), false);
  assert.equal(isAllowedAvatarUrl('https://i.pravatar.cc:8443/a'), false);
  assert.equal(isAllowedAvatarUrl('not a url'), false);
});
