// GitHub: enviar projeto, disparar o workflow de build e baixar o APK (API REST, sem gh CLI)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ROOT } from '../config.js';
import { secretGet, settings } from '../db.js';
import { run, hideSecret } from './shell.js';

export const WORKFLOW = 'nexus-build-apk.yml';

export function parseRepo(u) {
  const m = String(u || '').trim().match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i) || String(u || '').trim().match(/^([\w.-]+)\/([\w.-]+)$/);
  return m ? { owner: m[1], repo: m[2], full: m[1] + '/' + m[2] } : null;
}
export function creds() {
  const r = parseRepo(settings().repo), token = secretGet('github');
  if (token) hideSecret(token);
  return { repo: r, token };
}

async function gh(token, method, url, body) {
  const res = await fetch(url.startsWith('http') ? url : 'https://api.github.com' + url, {
    method, headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + token, 'x-github-api-version': '2022-11-28', 'user-agent': 'nexus-ia', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const txt = await res.text(); let j = null; try { j = JSON.parse(txt); } catch { }
  if (!res.ok) throw Object.assign(new Error(`GitHub ${res.status}: ${(j && j.message) || txt.slice(0, 200)}`), { status: res.status });
  return j;
}

/** Testa o link + token: precisa conseguir ler o repositório e ter permissão de escrita. */
export async function test(repoUrl, token) {
  const r = parseRepo(repoUrl); if (!r) throw new Error('Link inválido. Use https://github.com/usuario/repositorio');
  const info = await gh(token, 'GET', `/repos/${r.full}`);
  if (!info.permissions?.push) throw new Error('O token não tem permissão de escrita nesse repositório (Contents: Read and write).');
  await gh(token, 'GET', `/repos/${r.full}/actions/workflows`); // confirma acesso a Actions
  return { full: r.full, branch: info.default_branch, private: info.private };
}

async function ensureWorkflow(token, r, branch) {
  const yml = fs.readFileSync(path.join(ROOT, 'scripts', 'workflow-build-apk.yml'), 'utf8');
  const p = `.github/workflows/${WORKFLOW}`;
  let sha; try { const cur = await gh(token, 'GET', `/repos/${r.full}/contents/${p}?ref=${branch}`); sha = cur.sha; if (Buffer.from(cur.content, 'base64').toString() === yml) return false; } catch (e) { if (e.status !== 404) throw e; }
  await gh(token, 'PUT', `/repos/${r.full}/contents/${p}`, { message: 'Nexus: workflow de build do APK', content: Buffer.from(yml).toString('base64'), branch, ...(sha ? { sha } : {}) });
  return true;
}

/** Envia o código do projeto para o branch nexus/<slug> (sem node_modules, android, builds). */
async function pushSource({ token, r, slug, dir, job, signal }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-push-'));
  const ex = ['node_modules', '.git', 'android', 'ios', '.expo', 'dist', '.nexus-preview', '.nexus-build', '.nexus.json'].map(e => `--exclude=./${e}`).join(' ');
  const auth = Buffer.from('x-access-token:' + token).toString('base64'); hideSecret(auth);
  const cmd = `tar -C ${JSON.stringify(dir)} ${ex} -cf - . | tar -C ${JSON.stringify(tmp)} -xf - && cd ${JSON.stringify(tmp)} && git init -q -b main && git add -A && ` +
    `git -c user.name=Nexus -c user.email=nexus@localhost commit -qm "Nexus: ${slug}" && ` +
    `git -c http.extraHeader="Authorization: Basic ${auth}" push -f -q https://github.com/${r.full}.git HEAD:refs/heads/nexus/${slug}`;
  job?.line(`$ git push → github.com/${r.full} (branch nexus/${slug})`, 'cmd');
  const res = await run(cmd, { signal, echo: false, onLine: l => job?.line(l) });
  fs.rmSync(tmp, { recursive: true, force: true });
  if (res.code !== 0) throw new Error('Falha ao enviar para o GitHub:\n' + res.out.slice(-800));
}

const sleep = (ms, signal) => new Promise((ok, no) => { const t = setTimeout(ok, ms); signal?.addEventListener('abort', () => { clearTimeout(t); no(new Error('cancelado')); }, { once: true }); });

/** Build completo no GitHub Actions. Devolve o caminho do APK baixado. */
export async function buildOnGithub({ slug, dir, kind, job, signal, outDir }) {
  const { repo: r, token } = creds();
  if (!r || !token) throw new Error('Configure o link do repositório e o token do GitHub em Configurações → Build do APK.');
  const info = await gh(token, 'GET', `/repos/${r.full}`);
  job.step('Enviando para o GitHub', 'Git', `github.com/${r.full} · branch nexus/${slug}`); job.progress(10);
  if (await ensureWorkflow(token, r, info.default_branch)) job.line('✔ workflow criado em .github/workflows/' + WORKFLOW, 'ok');
  await pushSource({ token, r, slug, dir, job, signal }); job.line('✔ código enviado', 'ok');
  job.step('Iniciando o workflow', 'GitHub Actions'); job.progress(20);
  const t0 = Date.now() - 5000;
  await gh(token, 'POST', `/repos/${r.full}/actions/workflows/${WORKFLOW}/dispatches`, { ref: info.default_branch, inputs: { branch: `nexus/${slug}`, kind } });
  let runInfo = null;
  for (let i = 0; i < 30 && !runInfo; i++) {
    await sleep(4000, signal);
    const lst = await gh(token, 'GET', `/repos/${r.full}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=10`);
    runInfo = (lst.workflow_runs || []).find(x => new Date(x.created_at).getTime() >= t0);
  }
  if (!runInfo) throw new Error('O GitHub não iniciou o workflow. Confira se o Actions está ativado no repositório.');
  job.line('Acompanhe: ' + runInfo.html_url);
  job.step('Compilando no GitHub', 'GitHub Actions', runInfo.html_url);
  let last = '';
  while (true) {
    await sleep(12000, signal);
    const cur = await gh(token, 'GET', `/repos/${r.full}/actions/runs/${runInfo.id}`);
    const st = cur.status + (cur.conclusion ? ' · ' + cur.conclusion : '');
    if (st !== last) { job.line('status: ' + st); last = st; }
    job.progress(Math.min(85, 25 + (Date.now() - t0) / 6000));
    if (cur.status === 'completed') { if (cur.conclusion !== 'success') throw new Error('O build no GitHub falhou (' + cur.conclusion + '). Veja: ' + cur.html_url); break; }
  }
  job.step('Baixando o APK', 'GitHub Actions'); job.progress(90);
  const arts = await gh(token, 'GET', `/repos/${r.full}/actions/runs/${runInfo.id}/artifacts`);
  const art = (arts.artifacts || []).find(a => a.name === 'apk') || (arts.artifacts || [])[0];
  if (!art) throw new Error('O workflow terminou, mas não deixou o APK.');
  const res = await fetch(art.archive_download_url, { headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': 'nexus-ia' }, signal });
  if (!res.ok) throw new Error('Falha ao baixar o APK do GitHub: HTTP ' + res.status);
  const zip = path.join(outDir, `gh-${runInfo.id}.zip`);
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  const ex = path.join(outDir, `gh-${runInfo.id}`);
  const u = await run(`mkdir -p ${JSON.stringify(ex)} && unzip -o -q ${JSON.stringify(zip)} -d ${JSON.stringify(ex)} && find ${JSON.stringify(ex)} -name '*.apk' | head -1`, { echo: false });
  fs.rmSync(zip, { force: true });
  const apk = u.out.trim().split('\n').pop();
  if (!apk || !apk.endsWith('.apk')) throw new Error('O pacote baixado não tem APK.');
  return { apk, cleanup: ex, url: runInfo.html_url };
}

/** Publica um site/jogo web no GitHub Pages (branch gh-pages, pasta /<slug>/). */
export async function publishPages({ slug, srcDir, job, signal }) {
  const { repo: r, token } = creds();
  if (!r || !token) throw new Error('Configure o repositório e o token do GitHub em Configurações.');
  const auth = Buffer.from('x-access-token:' + token).toString('base64'); hideSecret(auth);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-pages-'));
  const H = `-c http.extraHeader="Authorization: Basic ${auth}"`;
  const cmd = `cd ${JSON.stringify(tmp)} && (git ${H} clone -q --depth 1 --branch gh-pages https://github.com/${r.full}.git site 2>/dev/null || (mkdir site && cd site && git init -q -b gh-pages)) && cd site && ` +
    `rm -rf ${slug} && mkdir -p ${slug} && cp -r ${JSON.stringify(srcDir)}/. ${slug}/ && touch .nojekyll && git add -A && ` +
    `(git -c user.name=Nexus -c user.email=nexus@localhost commit -qm "Nexus: publica ${slug}" || true) && git ${H} push -q https://github.com/${r.full}.git HEAD:refs/heads/gh-pages`;
  const res = await run(cmd, { signal, echo: false, onLine: l => job?.line(l) });
  fs.rmSync(tmp, { recursive: true, force: true });
  if (res.code !== 0) throw new Error('Falha ao publicar:\n' + res.out.slice(-800));
  try { await gh(token, 'POST', `/repos/${r.full}/pages`, { source: { branch: 'gh-pages', path: '/' } }); } catch { /* já ativo */ }
  return `https://${r.owner.toLowerCase()}.github.io/${r.repo}/${slug}/`;
}
