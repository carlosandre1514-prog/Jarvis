// N.E.X.U.S. — servidor principal (API + app web). Sem dependências externas: só Node 22+.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { CFG, ROOT } from './lib/config.js';
import { route, match, readJson, readBody, send, sse, serveStatic } from './lib/http.js';
import * as Auth from './lib/auth.js';
import { Conv, settings, saveSettings, secretSet, secretHas, DEFAULT_SETTINGS } from './lib/db.js';
import { subscribe } from './lib/bus.js';
import { converse, stopConversation } from './lib/agent.js';
import { Memory } from './lib/memory.js';
import { Jobs } from './lib/jobs.js';
import { stats } from './lib/system.js';
import { PROVIDERS, health } from './lib/llm.js';
import * as Files from './lib/tools/files.js';
import * as Projects from './lib/tools/projects.js';
import { userRun, userStop, userCwdGet, answerApproval, pendingApprovals } from './lib/tools/shell.js';
import { startBuild, listApks, serverReady } from './lib/tools/apk.js';
import { test as ghTest, parseRepo } from './lib/tools/github.js';
import { tts, stt, voiceStatus } from './lib/voice.js';
import { Job } from './lib/jobs.js';

const WEB = path.join(ROOT, 'web');
const ip = req => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const https = req => req.headers['x-forwarded-proto'] === 'https';

// ---------- acesso ----------
route('GET', '/api/state', (req, res) => send(res, 200, { setup: !Auth.hasPassword(), authed: Auth.authed(req) }), { open: true });
route('POST', '/api/setup', async (req, res) => {
  if (Auth.hasPassword()) return send(res, 409, { erro: 'Senha já definida' });
  const { senha, nome, usuario } = await readJson(req);
  if (!senha || senha.length < 6) return send(res, 400, { erro: 'Use uma senha com pelo menos 6 caracteres' });
  Auth.setPassword(senha); saveSettings({ nome: nome || DEFAULT_SETTINGS.nome, usuario: usuario || DEFAULT_SETTINGS.usuario });
  send(res, 200, { ok: true }, { 'set-cookie': Auth.sessionCookie(Auth.newSession(), https(req)) });
}, { open: true });
route('POST', '/api/login', async (req, res) => {
  if (Auth.throttled(ip(req))) return send(res, 429, { erro: 'Muitas tentativas. Espere 10 minutos.' });
  const { senha } = await readJson(req);
  if (!Auth.checkPassword(senha || '')) { Auth.failed(ip(req)); return send(res, 401, { erro: 'Senha incorreta' }); }
  Auth.cleared(ip(req));
  send(res, 200, { ok: true }, { 'set-cookie': Auth.sessionCookie(Auth.newSession(), https(req)) });
}, { open: true });
route('POST', '/api/logout', (req, res) => { Auth.endSession(Auth.cookieToken(req)); send(res, 200, { ok: true }, { 'set-cookie': 'nexus=; Path=/; Max-Age=0' }); });

// ---------- eventos em tempo real ----------
route('GET', '/api/events', (req, res) => {
  const push = sse(res);
  push('hello', { jobs: Jobs.recent(), approvals: pendingApprovals(), cwd: userCwdGet() });
  const off = subscribe(push); req.on('close', off);
});

// ---------- conversas ----------
route('GET', '/api/convs', (req, res) => send(res, 200, Conv.list()));
route('POST', '/api/convs', (req, res) => send(res, 200, Conv.create()));
route('GET', '/api/convs/:id', (req, res, p) => { const c = Conv.get(p.id); if (!c) return send(res, 404, { erro: 'não existe' }); send(res, 200, { ...c, messages: Conv.messages(p.id) }); });
route('PATCH', '/api/convs/:id', async (req, res, p) => { const { title } = await readJson(req); Conv.rename(p.id, String(title || 'Conversa')); send(res, 200, { ok: true }); });
route('DELETE', '/api/convs/:id', (req, res, p) => { Conv.remove(p.id); send(res, 200, { ok: true }); });
route('GET', '/api/search', (req, res, p, url) => send(res, 200, Conv.search(url.searchParams.get('q') || '')));

route('POST', '/api/chat', async (req, res) => {
  const { convId, text, via } = await readJson(req);
  if (!text || !String(text).trim()) return send(res, 400, { erro: 'Mensagem vazia' });
  const id = convId && Conv.get(convId) ? convId : Conv.create().id;
  const push = sse(res);
  push('conv', { convId: id });
  // a conversa continua no servidor mesmo se o app fechar a conexão
  const r = await converse({ convId: id, text: String(text).slice(0, 20000), via, onDelta: d => push('delta', { t: d }), onInfo: i => push('info', i) });
  push('done', { convId: id, ...r }); res.end();
});
route('POST', '/api/chat/stop', async (req, res) => { const { convId } = await readJson(req); send(res, 200, { ok: stopConversation(convId) }); });
route('POST', '/api/stop', (req, res) => send(res, 200, { tarefas: Jobs.stopAll(), terminal: userStop() }));

// ---------- memória ----------
route('GET', '/api/memories', (req, res) => send(res, 200, Memory.list()));
route('POST', '/api/memories', async (req, res) => { const { text } = await readJson(req); send(res, 200, { id: await Memory.add(text, 'manual') }); });
route('PATCH', '/api/memories/:id', async (req, res, p) => { const { text } = await readJson(req); await Memory.edit(+p.id, String(text)); send(res, 200, { ok: true }); });
route('DELETE', '/api/memories/:id', (req, res, p) => { Memory.remove(+p.id); send(res, 200, { ok: true }); });

// ---------- configurações ----------
function publicSettings() {
  const s = settings();
  return { ...s, chaves: Object.fromEntries(Object.keys(PROVIDERS).map(k => [k, secretHas('key:' + k)])), github: secretHas('github'), provedoresInfo: PROVIDERS, buildServidor: serverReady(), vozServidor: voiceStatus(), versao: '1.0.0' };
}
route('GET', '/api/settings', (req, res) => send(res, 200, publicSettings()));
route('PUT', '/api/settings', async (req, res) => {
  const b = await readJson(req), keep = ['nome', 'usuario', 'personalidade', 'voz', 'aprovacao', 'reforco', 'pensar', 'temperatura', 'build', 'repo', 'provedores'];
  const patch = Object.fromEntries(Object.entries(b).filter(([k]) => keep.includes(k)));
  if (patch.repo && !parseRepo(patch.repo)) return send(res, 400, { erro: 'Link do repositório inválido' });
  saveSettings(patch);
  for (const [k, v] of Object.entries(b.chaves || {})) if (PROVIDERS[k] && typeof v === 'string') secretSet('key:' + k, v.trim());
  if (typeof b.githubToken === 'string') secretSet('github', b.githubToken.trim());
  if (b.novaSenha) { if (!Auth.checkPassword(b.senhaAtual || '')) return send(res, 403, { erro: 'Senha atual incorreta' }); if (b.novaSenha.length < 6) return send(res, 400, { erro: 'Senha nova muito curta' }); Auth.setPassword(b.novaSenha); return send(res, 200, { ...publicSettings(), relogin: true }, { 'set-cookie': Auth.sessionCookie(Auth.newSession(), https(req)) }); }
  send(res, 200, publicSettings());
});
route('POST', '/api/github/test', async (req, res) => {
  const { repo, token } = await readJson(req);
  const tk = token || (await import('./lib/db.js')).secretGet('github');
  try { const r = await ghTest(repo || settings().repo, tk); if (token) secretSet('github', token.trim()); if (repo) saveSettings({ repo }); send(res, 200, { ok: true, ...r }); }
  catch (e) { send(res, 200, { ok: false, erro: e.message }); }
});

// ---------- sistema ----------
route('GET', '/api/system', async (req, res) => send(res, 200, await stats()));
route('GET', '/api/health', async (req, res) => send(res, 200, { ok: true, ...(await health()) }), { open: true });

// ---------- projetos e arquivos ----------
route('GET', '/api/projects', (req, res) => send(res, 200, { kinds: Projects.KINDS, list: Projects.list() }));
route('POST', '/api/projects', async (req, res) => {
  const { name, kind } = await readJson(req);
  const job = new Job('agent', 'Criando ' + name, {});
  try { job.step('Criando o projeto ' + name, Projects.KINDS[kind]); const r = await Projects.create({ name, kind, job, signal: job.signal }); job.finish('done'); send(res, 200, r); }
  catch (e) { job.finish('error', { error: e.message }); send(res, 400, { erro: e.message }); }
});
route('GET', '/api/files/tree', (req, res, p, url) => send(res, 200, Files.tree(url.searchParams.get('path') || '', 6)));
route('GET', '/api/files/read', (req, res, p, url) => send(res, 200, { path: url.searchParams.get('path'), content: Files.read(url.searchParams.get('path')) }));
route('PUT', '/api/files/write', async (req, res) => { const { path: f, content } = await readJson(req); send(res, 200, Files.write(f, content)); });
route('POST', '/api/files/mkdir', async (req, res) => { const { path: f } = await readJson(req); Files.mkdir(f); send(res, 200, { ok: true }); });
route('POST', '/api/files/rename', async (req, res) => { const { from, to } = await readJson(req); Files.rename(from, to); send(res, 200, { ok: true }); });
route('DELETE', '/api/files', (req, res, p, url) => { Files.remove(url.searchParams.get('path')); send(res, 200, { ok: true }); });
route('GET', '/api/files/raw', (req, res, p, url) => serveStatic(req, res, CFG.projectsDir, url.searchParams.get('path')));

// ---------- terminal e aprovações ----------
route('POST', '/api/term', async (req, res) => { const { cmd } = await readJson(req); if (!cmd) return send(res, 400, { erro: 'vazio' }); send(res, 200, await userRun(String(cmd))); });
route('POST', '/api/term/stop', (req, res) => send(res, 200, { ok: userStop() }));
route('POST', '/api/approvals/:id', async (req, res, p) => { const { action, cmd } = await readJson(req); send(res, 200, { ok: answerApproval(p.id, action, cmd) }); });

// ---------- prévia, build e downloads ----------
route('POST', '/api/preview/:slug', async (req, res, p) => {
  const job = new Job('agent', 'Prévia de ' + p.slug, {});
  try { job.step('Gerando a prévia', 'Prévia'); const r = await Projects.preview({ slug: p.slug, job, signal: job.signal }); job.finish('done'); send(res, 200, r); }
  catch (e) { job.finish('error', { error: e.message }); send(res, 400, { erro: e.message }); }
});
route('GET', '/p/:slug/*', (req, res, p) => {
  let dir = Projects.previewDir(p.slug);
  if (!dir) { const base = Files.safe(p.slug); dir = fs.existsSync(path.join(base, 'www')) ? path.join(base, 'www') : base; }
  serveStatic(req, res, dir, p.rest, { fallback: path.join(dir, 'index.html') });
});
route('GET', '/p/:slug', (req, res, p) => send(res, 302, '', { location: `/p/${p.slug}/` }));
route('POST', '/api/build', async (req, res) => { const { slug, method } = await readJson(req); try { send(res, 200, startBuild({ slug, method }).snapshot()); } catch (e) { send(res, 400, { erro: e.message }); } });
route('GET', '/api/apks', (req, res) => send(res, 200, listApks()));
route('GET', '/api/apks/:name', (req, res, p) => serveStatic(req, res, path.join(CFG.dataDir, 'apks'), path.basename(p.name), { headers: { 'content-disposition': `attachment; filename="${path.basename(p.name)}"` } }));
route('GET', '/api/jobs', (req, res) => send(res, 200, Jobs.recent()));
route('POST', '/api/jobs/:id/stop', (req, res, p) => { const j = Jobs.get(p.id); if (j) j.cancel(); send(res, 200, { ok: !!j }); });

// ---------- voz ----------
route('GET', '/api/voice', (req, res) => send(res, 200, voiceStatus()));
route('POST', '/api/tts', async (req, res) => { const { text } = await readJson(req); const wav = await tts(text || ''); send(res, 200, wav, { 'content-type': 'audio/wav' }); });
route('POST', '/api/stt', async (req, res) => { const audio = await readBody(req, 15e6); send(res, 200, { text: await stt(audio) }); });

// ---------- servidor ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'same-origin');
  try {
    const m = match(req.method, url.pathname);
    if (m) {
      if (!m.opts.open && !Auth.authed(req)) {
        if (url.pathname.startsWith('/p/')) return send(res, 401, 'Entre no Nexus para ver a prévia.');
        return send(res, 401, { erro: 'Faça login' });
      }
      return await m.handler(req, res, m.params, url);
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { erro: 'Rota não existe' });
    // app web
    const rel = url.pathname === '/' ? 'index.html' : url.pathname;
    return serveStatic(req, res, WEB, rel, { fallback: path.join(WEB, 'index.html'), cache: /\.(png|svg|woff2?)$/.test(rel) ? 'max-age=604800' : 'no-cache' });
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { erro: e.message || 'Erro interno' });
    else try { res.end(); } catch { }
    if (!e.status) console.error(e);
  }
});
server.requestTimeout = 0; server.headersTimeout = 60e3;
server.listen(CFG.port, CFG.host, () => console.log(`N.E.X.U.S. ouvindo em http://${CFG.host}:${CFG.port}  ·  projetos em ${CFG.projectsDir}`));
