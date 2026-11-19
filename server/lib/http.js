// Mini roteador HTTP, leitura de JSON, SSE e arquivos estáticos
import fs from 'node:fs';
import path from 'node:path';

const routes = [];
export function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }).replace(/\*$/, '(.*)') + '$');
  routes.push({ method, re, keys, handler, opts });
}
export function match(method, pathname) {
  for (const r of routes) {
    if (r.method !== method && r.method !== 'ANY') continue;
    const m = pathname.match(r.re); if (!m) continue;
    const params = {}; r.keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1]));
    if (m.length > r.keys.length + 1) params.rest = m[m.length - 1];
    return { ...r, params };
  }
  return null;
}

export async function readBody(req, limit = 25e6) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw Object.assign(new Error('Corpo grande demais'), { status: 413 }); chunks.push(c); }
  return Buffer.concat(chunks);
}
export async function readJson(req) {
  const b = await readBody(req, 5e6); if (!b.length) return {};
  try { return JSON.parse(b.toString('utf8')); } catch { throw Object.assign(new Error('JSON inválido'), { status: 400 }); }
}
export function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  res.writeHead(status, { 'content-type': typeof data === 'object' && !Buffer.isBuffer(data) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
}
export function sse(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write(': ok\n\n');
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { } }, 20000);
  res.on('close', () => clearInterval(ping));
  return (event, data) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { } };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json', '.apk': 'application/vnd.android.package-archive',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.mp4': 'video/mp4' };
export const mime = f => MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';

// Serve um arquivo de dentro de "base", sem deixar escapar da pasta
export function serveStatic(req, res, base, rel, { fallback = null, cache = 'no-cache', headers = {} } = {}) {
  let file = path.resolve(base, '.' + path.posix.normalize('/' + decodeURIComponent(rel || '')));
  if (!file.startsWith(path.resolve(base))) return send(res, 403, 'proibido');
  try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html'); } catch { }
  if (!fs.existsSync(file)) { if (fallback && fs.existsSync(fallback)) file = fallback; else return send(res, 404, 'não encontrado'); }
  const st = fs.statSync(file);
  res.writeHead(200, { 'content-type': mime(file), 'content-length': st.size, 'cache-control': cache, ...headers });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}
