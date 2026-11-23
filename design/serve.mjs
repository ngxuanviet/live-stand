// Máy chủ tĩnh nhỏ để xem các mockup trong thư mục design/ (cần HTTP vì mockup nạp module ES từ overlay/js).
// Chạy: npm run mockup   rồi mở http://localhost:3070/design/effects-mockup.html
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const port = Number(process.argv[2]) || 3070;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = normalize(join(root, url));
    if (!file.startsWith(root)) throw new Error('ngoài thư mục');
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`Mockup: http://localhost:${port}/design/effects-mockup.html`));
