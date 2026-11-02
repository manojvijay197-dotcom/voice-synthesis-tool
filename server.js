import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = process.cwd();
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.mp3':'audio/mpeg' };
const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Method not allowed'); }
  const pathname = new URL(req.url, 'http://localhost').pathname;
  let relative;
  try { relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname); }
  catch { res.writeHead(400); return res.end('Bad request'); }
  const file = resolve(root, `.${normalize(relative)}`);
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); return res.end('Forbidden'); }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404); res.end('Not found'); }
});
function listen(port) {
  server.once('error', error => {
    if (error.code === 'EADDRINUSE' && port < 3010) return listen(port + 1);
    throw error;
  });
  server.listen(port, '127.0.0.1', () => console.log(`Voice Synthesis is ready at http://localhost:${port}`));
}
listen(Number(process.env.PORT || 3000));
