// Teste de ponta a ponta com a IA de mentira: sobe o servidor, conversa, usa ferramentas e confere as rotas.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-teste-'));
const env = { ...process.env, NEXUS_PORT: '13999', NEXUS_DATA: path.join(tmp, 'dados'), NEXUS_PROJECTS: path.join(tmp, 'projetos'), NEXUS_SECRET: 'teste', LLM_URL: 'http://127.0.0.1:18999/v1', EMBED_URL: 'http://127.0.0.1:18999/v1' };
const mock = spawn(process.execPath, ['test/mock-llm.js', '18999'], { stdio: 'ignore' });
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
const B = 'http://127.0.0.1:13999';
let cookie = '', fails = 0, n = 0;
const ok = (c, msg) => { n++; if (c) console.log('  ✔ ' + msg); else { fails++; console.log('  ✖ ' + msg); } };
const req = async (p, o = {}) => { const r = await fetch(B + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { cookie, 'content-type': 'application/json' }, body: o.body ? JSON.stringify(o.body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; const t = await r.text(); try { return { s: r.status, j: JSON.parse(t), t }; } catch { return { s: r.status, t }; } };
async function chat(text) {
  const r = await fetch(B + '/api/chat', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
  const t = await r.text(); const done = t.split('\n\n').find(c => c.startsWith('event: done')); return done ? JSON.parse(done.split('data: ')[1]) : null;
}
const wait = ms => new Promise(r => setTimeout(r, ms));

try {
  await wait(1200);
  console.log('Acesso');
  ok((await req('/api/convs')).s === 401, 'sem login é bloqueado');
  ok((await req('/api/setup', { body: { senha: '123' } })).s === 400, 'senha curta recusada');
  ok((await req('/api/setup', { body: { senha: 'segredo123', usuario: 'Carlos' } })).s === 200, 'primeira senha criada');
  ok((await req('/api/setup', { body: { senha: 'outra1234' } })).s === 409, 'não deixa criar de novo');
  cookie = ''; ok((await req('/api/login', { body: { senha: 'errada' } })).s === 401, 'senha errada recusada');
  ok((await req('/api/login', { body: { senha: 'segredo123' } })).s === 200, 'login certo');

  console.log('Conversa e memória');
  const c1 = await chat('oi nexus, eu moro em São Paulo');
  ok(c1 && /IA de teste/.test(c1.text), 'resposta em streaming sem o <think>');
  ok(!/<think>/.test(c1.text), 'pensamento escondido');
  await wait(600);
  ok((await req('/api/memories')).j.some(m => /São Paulo/.test(m.text)), 'fato guardado na memória automaticamente');
  const mid = (await req('/api/memories', { body: { text: 'Gosto de café sem açúcar' } })).j.id;
  ok((await req('/api/memories/' + mid, { method: 'PATCH', body: { text: 'Gosto de café com pouco açúcar' } })).s === 200, 'memória editada');
  ok((await req('/api/memories/' + mid, { method: 'DELETE' })).s === 200, 'memória apagada');
  ok((await req('/api/convs')).j.length === 1, 'conversa listada');
  ok((await req('/api/search?q=Paulo')).j.length === 1, 'busca nas conversas');

  console.log('Ferramentas');
  const c2 = await chat('Nexus, cria um site de teste');
  ok(c2 && c2.project === 'site-teste' && c2.preview === 'prev', 'IA criou o projeto e gerou a prévia');
  ok(/Olá do Nexus/.test((await req('/p/site-teste/')).t), 'prévia servida em /p/site-teste/');
  ok((await req('/api/files/tree?path=site-teste')).j[0].name === 'www', 'árvore de arquivos');
  ok((await req('/api/files/write', { method: 'PUT', body: { path: 'site-teste/www/novo.txt', content: 'oi' } })).s === 200, 'arquivo salvo pelo editor');
  ok((await req('/api/files/read?path=../../etc/passwd')).s === 400, 'não sai da pasta de projetos');
  const t = await req('/api/term', { body: { cmd: 'cd site-teste && ls www' } });
  ok(t.j.code === 0 && /site-teste$/.test(t.j.cwd), 'terminal roda e lembra a pasta');
  ok((await req('/api/stop', { body: {} })).s === 200, 'parar tudo');
  const c3 = await chat('Nexus, para');
  ok(/Não há nenhuma tarefa|Parei/.test(c3.text), 'comando "para" sem IA');

  console.log('Build e configurações');
  const b = await req('/api/build', { body: { slug: 'site-teste', method: 'srv' } });
  ok(b.s === 200 && b.j.kind === 'build', 'build iniciado como tarefa');
  await wait(800);
  const job = (await req('/api/jobs')).j.find(j => j.id === b.j.id);
  ok(job.state === 'error' && /não está instalado|GitHub/.test(job.data.error), 'sem SDK, explica o que fazer');
  const g = await req('/api/build', { body: { slug: 'site-teste', method: 'gh' } }); await wait(500);
  ok(/Configure o link/.test((await req('/api/jobs')).j.find(j => j.id === g.j.id).data.error), 'GitHub sem token pede configuração');
  ok((await req('/api/settings', { method: 'PUT', body: { repo: 'isso não é link' } })).s === 400, 'link de repositório inválido recusado');
  const st = await req('/api/settings', { method: 'PUT', body: { repo: 'https://github.com/carlos/nexus-builds', githubToken: 'github_pat_teste', chaves: { groq: 'gsk_teste' }, build: 'gh' } });
  ok(st.j.github && st.j.chaves.groq && st.j.build === 'gh' && !JSON.stringify(st.j).includes('gsk_teste'), 'segredos salvos e nunca devolvidos');
  ok(!fs.readFileSync(path.join(tmp, 'dados', 'ia.db')).includes('gsk_teste'), 'chave criptografada no banco');
  const c4 = await chat('Nexus, cria um app de futebol');
  ok(c4 && c4.model === 'IA local', 'reforço indisponível → cai para a IA local');
  ok((await req('/api/system')).j.cores > 0, 'tela Sistema');
  ok((await req('/api/logout', { body: {} })).s === 200 && (cookie = '', (await req('/api/convs')).s === 401), 'sair encerra a sessão');
} catch (e) { fails++; console.error(e); }
srv.kill(); mock.kill(); fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n - fails}/${n} testes passaram`);
process.exit(fails ? 1 : 0);
