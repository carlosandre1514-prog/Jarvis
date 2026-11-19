// O cérebro: conversa, escolhe qual IA responde, usa ferramentas e guarda memória
import fs from 'node:fs';
import path from 'node:path';
import { Conv, settings } from './db.js';
import { chat, localTarget, remoteTargets, coolingDown, coolDown, withNoThink, stripThink } from './llm.js';
import { Memory } from './memory.js';
import { Job, Jobs } from './jobs.js';
import { emit } from './bus.js';
import { stats } from './system.js';
import * as Files from './tools/files.js';
import * as Projects from './tools/projects.js';
import { run, askApproval } from './tools/shell.js';
import { startBuild } from './tools/apk.js';
import { publishPages } from './tools/github.js';
import { CFG } from './config.js';

// ---------- ferramentas que a IA pode usar ----------
const fn = (name, description, properties = {}, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
const S = d => ({ type: 'string', description: d });
export const TOOLS = [
  fn('listar_projetos', 'Lista os projetos existentes em ~/projetos.'),
  fn('criar_projeto', 'Cria um projeto novo a partir de um modelo pronto.', { nome: S('Nome do app, jogo ou site'), tipo: { type: 'string', enum: Object.keys(Projects.KINDS), description: 'expo = app Android; site = HTML/CSS/JS; vite-react = app web React; phaser = jogo 2D; three = jogo 3D' } }, ['nome', 'tipo']),
  fn('listar_arquivos', 'Mostra a árvore de arquivos de um projeto.', { projeto: S('slug do projeto') }, ['projeto']),
  fn('ler_arquivo', 'Lê um arquivo de texto.', { caminho: S('caminho relativo a ~/projetos, ex.: meu-app/App.js') }, ['caminho']),
  fn('escrever_arquivo', 'Cria ou substitui um arquivo inteiro com o conteúdo completo.', { caminho: S('caminho relativo a ~/projetos, ex.: meu-app/App.js'), conteudo: S('conteúdo completo do arquivo') }, ['caminho', 'conteudo']),
  fn('apagar_arquivo', 'Apaga um arquivo ou pasta de um projeto.', { caminho: S('caminho relativo a ~/projetos') }, ['caminho']),
  fn('rodar_comando', 'Roda um comando de terminal (bash) dentro de um projeto. Comandos que alteram algo pedem aprovação do usuário.', { projeto: S('slug do projeto (vazio = pasta de projetos)'), comando: S('comando bash'), motivo: S('por que rodar, em poucas palavras') }, ['comando']),
  fn('gerar_previa', 'Gera a prévia web do projeto e mostra na janela Prévia/Emulador.', { projeto: S('slug do projeto') }, ['projeto']),
  fn('gerar_apk', 'Gera o APK Android do projeto (roda em segundo plano).', { projeto: S('slug do projeto'), metodo: { type: 'string', enum: ['srv', 'gh'], description: 'srv = no servidor; gh = GitHub Actions; vazio = o padrão das configurações' } }, ['projeto']),
  fn('publicar_site', 'Publica um site ou jogo web no GitHub Pages.', { projeto: S('slug do projeto') }, ['projeto']),
  fn('lembrar', 'Guarda um fato duradouro sobre o usuário na memória.', { fato: S('o fato, numa frase') }, ['fato']),
  fn('status_sistema', 'Mostra uso de CPU, memória, disco e serviços do servidor.'),
  fn('abrir_ferramenta', 'Abre uma janela de ferramenta no app do usuário.', { ferramenta: { type: 'string', enum: ['term', 'files', 'proc', 'emu', 'prev', 'build'] }, projeto: S('slug do projeto, se fizer sentido') }, ['ferramenta']),
];

const LABEL = {
  listar_projetos: () => ['Vendo os projetos', 'Projetos'], criar_projeto: a => [`Criando o projeto ${a.nome}`, Projects.KINDS[a.tipo] || a.tipo],
  listar_arquivos: a => [`Lendo a estrutura de ${a.projeto}`, 'Arquivos'], ler_arquivo: a => [`Lendo ${a.caminho}`, 'Arquivo'],
  escrever_arquivo: a => [`Escrevendo ${path.basename(a.caminho || '')}`, 'Arquivo · ' + a.caminho], apagar_arquivo: a => [`Apagando ${a.caminho}`, 'Arquivo'],
  rodar_comando: a => [a.motivo || 'Rodando comando', 'Terminal'], gerar_previa: a => [`Gerando a prévia de ${a.projeto}`, 'Prévia'],
  gerar_apk: a => [`Iniciando o build do APK de ${a.projeto}`, 'Build'], publicar_site: a => [`Publicando ${a.projeto}`, 'GitHub Pages'],
  lembrar: () => ['Guardando na memória', 'Memória'], status_sistema: () => ['Checando o servidor', 'Sistema'], abrir_ferramenta: a => ['Abrindo ' + a.ferramenta, 'App'],
};

async function execTool(name, a, ctx) {
  const { job, signal } = ctx;
  switch (name) {
    case 'listar_projetos': return Projects.list().map(p => ({ projeto: p.slug, nome: p.title, tipo: p.kind, versao: p.version }));
    case 'criar_projeto': {
      const r = await Projects.create({ name: a.nome, kind: a.tipo, job, signal });
      ctx.project = r.slug; emit('opentool', { tool: 'files', project: r.slug, auto: true });
      return { ok: true, projeto: r.slug, tipo: r.kind, arquivos: Files.tree(r.slug, 2).map(f => f.path) };
    }
    case 'listar_arquivos': { const flat = []; const walk = l => l.forEach(f => { flat.push(f.path + (f.dir ? '/' : '') + (f.skipped ? ' (oculto)' : '')); if (f.children) walk(f.children); }); walk(Files.tree(a.projeto, 4)); return flat.slice(0, 300); }
    case 'ler_arquivo': { const t = Files.read(a.caminho); return t.length > 12000 ? t.slice(0, 12000) + '\n…(cortado)' : t; }
    case 'escrever_arquivo': {
      const r = Files.write(a.caminho, a.conteudo);
      job.detail(String(a.conteudo).split('\n').slice(0, 40).join('\n'));
      ctx.project = String(a.caminho).split('/')[0];
      return { ok: true, ...r };
    }
    case 'apagar_arquivo': {
      const ok = await askApproval({ cmd: 'rm -rf ' + a.caminho, cwd: CFG.projectsDir, why: 'Apagar ' + a.caminho, signal });
      if (!ok.ok) return { ok: false, motivo: 'O usuário recusou.' };
      Files.remove(a.caminho); return { ok: true };
    }
    case 'rodar_comando': {
      const cwd = a.projeto ? Files.safe(a.projeto) : CFG.projectsDir;
      job.detail('$ ' + a.comando);
      const ap = await askApproval({ cmd: a.comando, cwd, why: a.motivo || '', signal });
      if (!ap.ok) return { ok: false, motivo: 'O usuário recusou o comando.' };
      const r = await run(ap.cmd, { cwd, signal, onLine: l => job.line(l), timeout: 20 * 60e3 });
      return { codigo: r.code, saida: r.out.slice(-6000) };
    }
    case 'gerar_previa': {
      const r = await Projects.preview({ slug: a.projeto, job, signal }); ctx.project = a.projeto;
      emit('opentool', { tool: r.kind === 'expo' ? 'emu' : 'prev', project: a.projeto, url: r.url, auto: true }); ctx.previewTool = r.kind === 'expo' ? 'emu' : 'prev';
      return { ok: true, endereco: r.url };
    }
    case 'gerar_apk': {
      const b = startBuild({ slug: a.projeto, method: a.metodo || undefined });
      return { ok: true, tarefa: b.id, metodo: b.data.method === 'gh' ? 'GitHub Actions' : 'servidor', aviso: 'O build continua em segundo plano; o usuário acompanha pela janela Build. Não espere terminar.' };
    }
    case 'publicar_site': {
      await Projects.preview({ slug: a.projeto, job, signal });
      const url = await publishPages({ slug: a.projeto, srcDir: Projects.previewDir(a.projeto), job, signal });
      return { ok: true, endereco: url, aviso: 'O GitHub Pages pode levar 1 ou 2 minutos para atualizar.' };
    }
    case 'lembrar': await Memory.add(a.fato, 'ia'); return { ok: true };
    case 'status_sistema': { const s = await stats(); return { cpu: s.cpu + '%', ram: Math.round(100 * s.ram.used / s.ram.total) + '%', disco: Math.round(100 * s.disk.used / (s.disk.total || 1)) + '%', servicos: s.procs.map(p => p.name + ': ' + (p.on ? 'rodando' : 'parado')) }; }
    case 'abrir_ferramenta': emit('opentool', { tool: a.ferramenta, project: a.projeto }); return { ok: true };
    default: throw new Error('Ferramenta desconhecida: ' + name);
  }
}

// ---------- qual IA responde ----------
const DEV = /\b(cri[ae]r?|faz|faça|fazer|program\w*|c[oó]digo|app|aplicativo|jogo|game|site|p[aá]gina|apk|build|erro|bug|fun[cç][aã]o|script|componente|tela|api|banco de dados|deploy|publica\w*|corrig\w*|arrum\w*|refator\w*)\b/i;
function pickTargets(text, memories) {
  const s = settings(), local = localTarget();
  if (!s.reforco) return [local];
  const remote = remoteTargets().filter(t => !coolingDown(t.id));
  const personal = memories.some(m => m.score > 0.62);
  const hard = DEV.test(text) || text.length > 500;
  if (!remote.length || (personal && !hard)) return [local];
  return hard ? [...remote, local] : [local, ...remote];
}

function systemPrompt(target, memories, via) {
  const s = settings(), d = new Date();
  const projs = Projects.list().slice(0, 15).map(p => `- ${p.slug} (${p.kind})`).join('\n') || '- nenhum ainda';
  const mem = target.local && memories.length ? '\n\nO que você sabe sobre o usuário:\n' + memories.map(m => '- ' + m.text).join('\n') : '';
  return `Você é ${s.nome}, o assistente pessoal de ${s.usuario}. Personalidade: ${s.personalidade}
Hoje é ${d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' })}, ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}.
Responda sempre em português do Brasil, de forma direta.${via === 'voz' ? ' Este pedido veio por voz: responda em frases curtas e naturais, sem listas longas nem markdown pesado.' : ''}

Você roda num servidor próprio e tem ferramentas para: criar apps Android (Expo/React Native), jogos (Phaser 2D, Three.js 3D) e sites; ler e escrever arquivos em ~/projetos; rodar comandos (o usuário aprova os que alteram algo); gerar prévia; gerar o APK (no servidor ou pelo GitHub Actions) e publicar sites.
Regras:
- Quando pedirem para criar ou alterar algo, USE as ferramentas em vez de só explicar.
- Ao escrever um arquivo, mande o conteúdo COMPLETO e funcionando.
- Projetos web (site, phaser, three) ficam na pasta www/ do projeto.
- Depois de criar ou mudar um app, jogo ou site, gere a prévia.
- Só gere o APK quando o usuário pedir. O build roda em segundo plano: avise e não espere.
- Nunca diga que fez algo que não fez. Se faltar algo essencial, pergunte.
- No fim, diga em 1 a 3 frases o que foi feito.

Projetos existentes:
${projs}${mem}`;
}

// ---------- conversa principal ----------
const active = new Map(); // convId -> AbortController
export function stopConversation(convId) { const c = active.get(convId); if (c) { c.abort(); return true; } return false; }

export async function converse({ convId, text, via = 'texto', onDelta = () => { }, onInfo = () => { } }) {
  const ctrl = new AbortController(); active.set(convId, ctrl);
  const signal = ctrl.signal;
  Conv.add(convId, 'user', text, { via });
  const conv = Conv.get(convId);
  if (conv && conv.title === 'Nova conversa') Conv.rename(convId, text.replace(/^\s*nexus[,!.\s]*/i, '').split(/\s+/).slice(0, 7).join(' ') || 'Conversa');

  // comando de parar: não precisa de IA
  if (/^\s*(nexus[,!.\s]*)?(para|pare|parar|cancela|cancelar|stop)\b[\s.!]*$/i.test(text)) {
    const n = Jobs.stopAll(); const msg = n ? `Parei ${n === 1 ? 'a tarefa' : n + ' tarefas'}.` : 'Não há nenhuma tarefa rodando agora.';
    onDelta(msg); Conv.add(convId, 'assistant', msg, { model: 'sistema' }); active.delete(convId); return { text: msg };
  }

  const history = Conv.messages(convId, 24).filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({ role: m.role, content: m.content }));
  const memories = await Memory.recall(text).catch(() => []);
  const targets = pickTargets(text, memories);
  const s = settings();

  let job = null, finalText = '', used = null, toolLog = [];
  const ctx = { signal, project: null, get job() { return job || (job = new Job('agent', text.replace(/^\s*nexus[,!.\s]*/i, '').slice(0, 60), { convId })); } };

  for (const target of targets) {
    let msgs = [{ role: 'system', content: systemPrompt(target, memories, via) }, ...history];
    if (target.local && !s.pensar) msgs = withNoThink(msgs);
    let streamed = false;
    try {
      onInfo({ model: target.name });
      for (let turn = 0; turn < 30; turn++) {
        if (signal.aborted) throw new Error('cancelado');
        const r = await chat(target, { messages: msgs, tools: TOOLS, temperature: s.temperatura, maxTokens: 4096, signal, onDelta: d => { streamed = true; onDelta(d); } });
        if (r.text) finalText += (finalText && !finalText.endsWith('\n') ? '\n\n' : '') + r.text;
        if (!r.toolCalls.length) break;
        msgs.push({ role: 'assistant', content: r.raw ? stripThink(r.raw) : null, tool_calls: r.toolCalls });
        for (const call of r.toolCalls) {
          let args = {}; try { args = JSON.parse(call.function.arguments || '{}'); } catch { }
          const name = call.function.name, [label, kind] = (LABEL[name] || (() => [name, 'Ferramenta']))(args);
          ctx.job.step(label, kind); onInfo({ tool: name, label });
          let result;
          try { result = await execTool(name, args, ctx); }
          catch (e) { result = { erro: String(e.message || e).slice(0, 2000) }; ctx.job.line(String(e.message || e), 'e'); }
          toolLog.push({ name, label, ok: !result?.erro });
          const content = typeof result === 'string' ? result : JSON.stringify(result);
          msgs.push({ role: 'tool', tool_call_id: call.id, name, content: content.slice(0, 8000) });
          streamed = true;
        }
        ctx.job.progress(Math.min(95, (turn + 1) * 8));
      }
      used = target; break;
    } catch (e) {
      if (signal.aborted) { finalText += (finalText ? '\n\n' : '') + '(interrompido)'; used = target; break; }
      const st = e.status || 0;
      if (!target.local) coolDown(target.id, st === 429 ? 90e3 : st === 401 || st === 403 ? 3600e3 : 30e3);
      onInfo({ fallback: target.name, error: String(e.message || e).slice(0, 200) });
      if (streamed) { finalText += (finalText ? '\n\n' : '') + `(a ${target.name} parou no meio: ${String(e.message || e).slice(0, 120)})`; used = target; break; }
      if (target === targets[targets.length - 1]) { finalText = 'Não consegui falar com nenhuma IA agora. Confira se o llama-server está rodando (tela Sistema).'; onDelta(finalText); }
    }
  }
  active.delete(convId);
  if (job) job.finish(signal.aborted ? 'stop' : 'done');
  if (!finalText.trim()) { finalText = toolLog.length ? 'Pronto.' : '…'; onDelta(finalText); }
  const id = Conv.add(convId, 'assistant', finalText, { model: used?.name || '-', tools: toolLog, job: job?.id, project: ctx.project, preview: ctx.previewTool || null });
  emit('message', { convId, id });
  // memória de longo prazo (local, em segundo plano)
  if (!signal.aborted) Memory.extract(text, finalText).then(f => f.length && emit('memory', { added: f })).catch(() => { });
  return { text: finalText, model: used?.name, job: job?.id, project: ctx.project, preview: ctx.previewTool || null, build: toolLog.some(t => t.name === 'gerar_apk') };
}
