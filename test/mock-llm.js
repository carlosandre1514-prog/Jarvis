// IA de mentira (compatível com OpenAI) para testar o Nexus sem o llama-server
import http from 'node:http';
const port = +process.argv[2] || 18080;
const words = s => s.split(/(\s+)/).filter(Boolean);
function vec(t) { const v = new Array(64).fill(0); for (const w of t.toLowerCase().split(/\W+/)) { if (!w) continue; let h = 0; for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0; v[h % 64] += 1; } return v; }
http.createServer(async (req, res) => {
  let b = ''; for await (const c of req) b += c;
  if (req.url.endsWith('/health')) { res.end('{"status":"ok"}'); return; }
  if (req.url.endsWith('/embeddings')) { const j = JSON.parse(b); const inp = [].concat(j.input); res.end(JSON.stringify({ data: inp.map((t, i) => ({ index: i, embedding: vec(t) })) })); return; }
  const j = JSON.parse(b); const msgs = j.messages; const lastUser = [...msgs].reverse().find(m => m.role === 'user')?.content || '';
  const afterUser = msgs.slice(msgs.map(m => m.role).lastIndexOf('user') + 1); const tools = afterUser.filter(m => m.role === 'tool').length;
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = d => res.write('data: ' + JSON.stringify({ choices: [d] }) + '\n\n');
  const call = (name, args) => { send({ delta: { tool_calls: [{ index: 0, id: 'c' + Date.now(), type: 'function', function: { name, arguments: '' } }] } }); const a = JSON.stringify(args); for (let i = 0; i < a.length; i += 20) send({ delta: { tool_calls: [{ index: 0, function: { arguments: a.slice(i, i + 20) } }] } }); send({ delta: {}, finish_reason: 'tool_calls' }); };
  const say = async t => { send({ delta: { content: '<think>pensando…</think>' } }); for (const w of words(t)) { send({ delta: { content: w } }); await new Promise(r => setTimeout(r, 15)); } send({ delta: {}, finish_reason: 'stop' }); };
  if (/FATOS DURADOUROS/.test(lastUser)) { await say('{"fatos":' + (/\bmeu nome|eu sou|eu moro|gosto/i.test(lastUser) ? '["O usuário mora em São Paulo"]' : '[]') + '}'); }
  else if (/cria.*site/i.test(lastUser) && j.tools) {
    const steps = [() => call('criar_projeto', { nome: 'Site Teste', tipo: 'site' }),
      () => call('escrever_arquivo', { caminho: 'site-teste/www/index.html', conteudo: '<!DOCTYPE html><html><body style="background:#111;color:#fff;font-family:sans-serif"><h1>Olá do Nexus</h1></body></html>' }),
      () => call('gerar_previa', { projeto: 'site-teste' })];
    if (tools < steps.length) steps[tools](); else await say('Pronto! Criei o site **Site Teste** e abri a prévia.');
  } else if (/rode? ls/i.test(lastUser) && j.tools && tools === 0) call('rodar_comando', { comando: 'ls -la', motivo: 'Listando a pasta' });
  else if (/apaga tudo/i.test(lastUser) && j.tools && tools === 0) call('rodar_comando', { comando: 'touch criado-pela-ia.txt', motivo: 'Teste de aprovação' });
  else await say('Olá! Sou a IA de teste. Você disse: ' + lastUser.replace(' /no_think', '').slice(0, 80));
  res.end('data: [DONE]\n\n');
}).listen(port, () => console.log('mock llm em', port));
