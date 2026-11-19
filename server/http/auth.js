import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'adm';

function sign(secret, payload) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Token phiên dạng `<hạn>.<chữ ký>`; không lưu server-side nên restart không làm mất phiên nếu SESSION_SECRET cố định. */
export function createSession(secret, ttlMs) {
  const exp = String(Date.now() + ttlMs);
  return `${exp}.${sign(secret, exp)}`;
}

export function verifySession(secret, token) {
  if (!token || typeof token !== 'string') return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || !safeEqual(sig, sign(secret, exp))) return false;
  return Number(exp) > Date.now();
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function tokenFromRequest(req) {
  const bearer = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
  return bearer || parseCookies(req.headers.cookie)[COOKIE];
}

export function sessionCookie(token, ttlMs) {
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(ttlMs / 1000)}`;
}

export function clearCookie() {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
