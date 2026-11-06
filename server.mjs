// 极简静态服务器：node server.mjs [port] [host]
//   node server.mjs            → 只听本机 127.0.0.1:8123
//   node server.mjs 8123 0.0.0.0 → 局域网内其它设备也能访问（分享给朋友用）
// 只是为了躲开 python http.server 在 Windows 上把 .mjs/.task 当成 text/plain 的坑。
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || 8123);
const HOST = process.argv[3] || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.bin': 'application/octet-stream',
};

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    let file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 ' + urlPath);
        return;
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'content-length': st.size,
        'cache-control': 'no-store, must-revalidate',
      });
      fs.createReadStream(file).pipe(res);
    });
  })
  .listen(PORT, HOST, () => {
    console.log(`星河视界 → http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`);
    if (HOST === '0.0.0.0') {
      const ips = [];
      for (const list of Object.values(os.networkInterfaces())) {
        for (const ni of list || []) {
          if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
        }
      }
      for (const ip of ips) console.log(`  局域网 → http://${ip}:${PORT}`);
      if (!ips.length) console.log('  （没找到局域网地址，检查一下网络连接）');
    }
  });
