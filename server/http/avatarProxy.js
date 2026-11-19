import { createHash } from 'node:crypto';
import { mkdirSync, existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const MAX_BYTES = 1.5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const FAIL_TTL_MS = 60_000;

/** Máy chủ ảnh được phép tải (chống SSRF). Thêm qua AVATAR_HOSTS (phân tách dấu phẩy). */
export const DEFAULT_AVATAR_HOSTS = [
  'tiktokcdn.com',
  'tiktokcdn-us.com',
  'tiktokcdn-eu.com',
  'byteimg.com',
  'ibyteimg.com',
  'ttwstatic.com',
  'i.pravatar.cc',
  'randomuser.me',
  'api.dicebear.com',
];

export function isAllowedAvatarUrl(raw, hosts = DEFAULT_AVATAR_HOSTS) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const h = u.hostname.toLowerCase();
  return hosts.some((a) => h === a || h.endsWith(`.${a}`));
}

/**
 * Proxy + cache avatar: tránh URL CDN hết hạn / lỗi CORS và cho phép overlay đọc điểm ảnh (cùng origin).
 * GET /avatar?url=<https url>&stage_id=..&token=..   (cần token overlay hợp lệ để không thành open proxy)
 */
export function createAvatarHandler({ hub, config }) {
  const hosts = [...DEFAULT_AVATAR_HOSTS, ...(config.avatarHosts || [])];
  const dir = join(dirname(config.dbPath), 'avatars');
  mkdirSync(dir, { recursive: true });
  const failed = new Map(); // url -> thời điểm lỗi
  const inflight = new Map(); // url -> Promise<{buf, type}>

  async function download(url) {
    let cur = url;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      if (!isAllowedAvatarUrl(cur, hosts)) throw new Error('host không được phép');
      const res = await fetch(cur, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Mozilla/5.0' } });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        cur = new URL(res.headers.get('location'), cur).toString();
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!/^image\/(png|jpe?g|webp|gif|avif)$/.test(type)) throw new Error(`loại ảnh không hỗ trợ: ${type}`);
      const len = Number(res.headers.get('content-length') || 0);
      if (len > MAX_BYTES) throw new Error('ảnh quá lớn');
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) throw new Error('ảnh quá lớn');
      return { buf, type };
    }
    throw new Error('quá nhiều chuyển hướng');
  }

  async function load(url) {
    const id = createHash('sha1').update(url).digest('hex');
    const dataPath = join(dir, `${id}.bin`);
    const typePath = join(dir, `${id}.type`);
    if (existsSync(dataPath) && existsSync(typePath)) {
      return { buf: await readFile(dataPath), type: (await readFile(typePath, 'utf8')).trim() };
    }
    if (!inflight.has(url)) {
      const p = download(url)
        .then(async (r) => {
          await writeFile(dataPath, r.buf);
          await writeFile(typePath, r.type);
          return r;
        })
        .finally(() => inflight.delete(url));
      inflight.set(url, p);
    }
    return inflight.get(url);
  }

  return async (req, res) => {
    const { url, stage_id: stageId, token } = req.query;
    if (!hub.verifyOverlay(String(stageId || ''), String(token || ''))) return res.status(401).end();
    if (typeof url !== 'string' || !isAllowedAvatarUrl(url, hosts)) return res.status(400).end();
    const failedAt = failed.get(url);
    if (failedAt && Date.now() - failedAt < FAIL_TTL_MS) return res.status(502).end();
    try {
      const { buf, type } = await load(url);
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.end(buf);
    } catch (e) {
      failed.set(url, Date.now());
      res.status(502).end();
    }
  };
}
