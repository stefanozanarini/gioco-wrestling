// Server del gioco: file statici della build (compressi al volo) + stanze multiplayer via WebSocket su /ws.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { attachRooms } from './rooms.js';

const PORT = Number(process.env.PORT || 8080);
const STATIC_DIR = process.env.STATIC_DIR
  ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};
const COMPRESS = new Set(['.html', '.js', '.css', '.json', '.svg', '.gltf', '.bin', '.md', '.txt']);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') { res.writeHead(200).end('ok\n'); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }

  let file;
  try { file = path.normalize(path.join(STATIC_DIR, decodeURIComponent(url.pathname))); } catch { res.writeHead(400).end(); return; }
  if (file !== STATIC_DIR && !file.startsWith(STATIC_DIR + path.sep)) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) file = path.join(file, 'index.html');
    else if (err) file = path.join(STATIC_DIR, 'index.html'); // fallback SPA (link d'invito compresi)
    fs.stat(file, (err2, st2) => {
      if (err2) { res.writeHead(404).end(); return; }
      const ext = path.extname(file).toLowerCase();
      const gzip = COMPRESS.has(ext) && st2.size > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      const headers = {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        // file con hash nel nome: in cache a lungo; modelli per un giorno; il resto si ricontrolla
        'Cache-Control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable'
          : file.includes(`${path.sep}models${path.sep}`) ? 'public, max-age=86400' : 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        Vary: 'Accept-Encoding',
      };
      if (gzip) headers['Content-Encoding'] = 'gzip';
      else headers['Content-Length'] = st2.size;
      res.writeHead(200, headers);
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = fs.createReadStream(file);
      (gzip ? stream.pipe(zlib.createGzip({ level: 6 })) : stream).pipe(res);
    });
  });
});

attachRooms(server, { exclusive: true });
server.listen(PORT, () => console.log(`BWT in ascolto sulla porta ${PORT} (statici: ${STATIC_DIR})`));
