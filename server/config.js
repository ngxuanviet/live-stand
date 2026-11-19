import { randomBytes } from 'node:crypto';

const env = process.env;

function secret(name, label) {
  if (env[name]) return env[name];
  const v = randomBytes(18).toString('base64url');
  console.warn(`[config] Chưa đặt ${name}; dùng giá trị ngẫu nhiên cho lần chạy này (${label}).`);
  return v;
}

// Giá trị mẫu trong .env.example: không cho chạy thật với các giá trị này
const PLACEHOLDERS = ['doi-mat-khau-nay', 'doi-chuoi-ngau-nhien-dai'];
if (env.NODE_ENV === 'production') {
  for (const k of ['ADMIN_PASSWORD', 'SESSION_SECRET']) {
    if (!env[k] || PLACEHOLDERS.includes(env[k])) throw new Error(`Hãy đặt ${k} (không dùng giá trị mẫu) trước khi chạy ở chế độ production`);
  }
}

const adminPassword = secret('ADMIN_PASSWORD', 'mật khẩu admin');
if (!env.ADMIN_PASSWORD) console.warn(`[config] Mật khẩu admin tạm thời: ${adminPassword}`);

export const config = {
  port: Number(env.PORT) || 3000,
  adminPassword,
  sessionSecret: secret('SESSION_SECRET', 'khoá ký phiên'),
  dbPath: env.DB_PATH || './data/app.db',
  signApiKey: env.SIGN_API_KEY || '',
  publicBaseUrl: (env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  avatarHosts: (env.AVATAR_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  tiktokDebugLog: env.TIKTOK_DEBUG_LOG === '1',
  tiktokExtendedGiftInfo: env.TIKTOK_EXTENDED_GIFT_INFO === '1',
  sessionTtlMs: 12 * 60 * 60 * 1000,
};
