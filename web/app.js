// N.E.X.U.S. — app web (PWA). Fala com a API do servidor.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const two = n => String(n).padStart(2, '0');
const hm = t => { const d = t ? new Date(t) : new Date(); return two(d.getHours()) + ':' + two(d.getMinutes()); };
const isMob = () => innerWidth < 1000;
const mb = n => (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
const gb = n => (n / 1073741824).toFixed(1).replace('.', ',') + ' GB';
const icon = (id, s = 18) => `<svg width="${s}" height="${s}" aria-hidden="true"><use href="#${id}"/></svg>`;

// ---------- estado ----------
const S = { cfg: null, convId: localStorage.getItem('nexus_conv') || null, page: 0, jobs: new Map(), approvals: new Map(), projects: [], streaming: null, cwd: '~/projetos', lastAgentJob: null, lastBuildJob: null, currentProject: localStorage.getItem('nexus_proj') || '' };
const NOME = () => S.cfg?.nome || 'N.E.X.U.S.';

// ---------- API ----------
async function api(path, opts = {}) {
  const o = { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: {}, credentials: 'same-origin' };
  if (opts.body !== undefined) { o.headers['content-type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
  const r = await fetch(path, o);
  if (r.status === 401 && !opts.noGate) { showGate(); throw new Error('Faça login'); }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error(data?.erro || data || 'Erro ' + r.status);
  return data;
}
function toast(t, ms = 2800) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), ms); }

// ---------- login ----------
let gateMode = 'login';
async function showGate() {
  const st = await api('/api/state', { noGate: true }).catch(() => ({ setup: false }));
  gateMode = st.setup ? 'setup' : 'login';
  $('gate').hidden = false; $('shell').hidden = true;
  $('gNome').hidden = $('gSenha2').hidden = gateMode !== 'setup';
  $('gateP').textContent = gateMode === 'setup' ? 'Primeiro acesso: crie a senha do seu Nexus' : 'Digite sua senha';
  $('gBtn').textContent = gateMode === 'setup' ? 'Criar e entrar' : 'Entrar';
  $('gSenha').autocomplete = gateMode === 'setup' ? 'new-password' : 'current-password';
  setTimeout(() => $(gateMode === 'setup' ? 'gNome' : 'gSenha').focus(), 50);
}
$('gateF').onsubmit = async e => {
  e.preventDefault(); $('gErr').textContent = '';
  try {
    if (gateMode === 'setup') {
      if ($('gSenha').value !== $('gSenha2').value) throw new Error('As senhas não batem');
      await api('/api/setup', { body: { senha: $('gSenha').value, usuario: $('gNome').value.trim() || undefined }, noGate: true });
    } else await api('/api/login', { body: { senha: $('gSenha').value }, noGate: true });
    $('gSenha').value = $('gSenha2').value = ''; $('gate').hidden = true; $('shell').hidden = false; boot();
  } catch (err) { $('gErr').textContent = err.message; }
};

// ---------- markdown simples ----------
function md(src) {
  const blocks = []; let t = String(src || '');
  t = t.replace(/```(\w*)\n?([\s\S]*?)(```|$)/g, (_, lang, code) => { blocks.push(`<pre><button class="cp" type="button">Copiar</button><code>${esc(code.replace(/\n$/, ''))}</code></pre>`); return `\u0000${blocks.length - 1}\u0000`; });
  const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>').replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  const out = []; let list = null;
  for (const line of t.split('\n')) {
    const b = line.match(/^\u0000(\d+)\u0000$/);
    const ul = line.match(/^\s*[-*•]\s+(.*)/), ol = line.match(/^\s*\d+[.)]\s+(.*)/), h = line.match(/^(#{1,3})\s+(.*)/);
    if ((ul || ol) && !b) { const k = ul ? 'ul' : 'ol'; if (!list || list.k !== k) { if (list) out.push(`</${list.k}>`); out.push(`<${k}>`); list = { k }; } out.push('<li>' + inline((ul || ol)[1]) + '</li>'); continue; }
    if (list) { out.push(`</${list.k}>`); list = null; }
    if (b) out.push(blocks[+b[1]]);
    else if (h) out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`);
    else if (line.trim()) out.push('<p>' + inline(line) + '</p>');
  }
  if (list) out.push(`</${list.k}>`);
  return out.join('').replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
}
document.addEventListener('click', e => { const b = e.target.closest('.md pre .cp'); if (!b) return; navigator.clipboard?.writeText(b.nextElementSibling.textContent).then(() => { b.textContent = 'Copiado'; setTimeout(() => b.textContent = 'Copiar', 1500); }); });

// ---------- conversa ----------
const conv = $('conv'), chatV = $('chat'), pageV = $('pageV'), page = $('page'), pop = $('pop');
const atBottom = () => chatV.scrollHeight - chatV.scrollTop - chatV.clientHeight < 120;
const scrollEnd = (force) => { if (force || atBottom()) chatV.scrollTop = chatV.scrollHeight; };

function actions(meta) {
  const b = [];
  if (meta.job) b.push(['proc', 'i-proc', 'Processo']);
  if (meta.project) b.push(['files', 'i-files', 'Arquivos']);
  if (meta.preview) b.push([meta.preview, meta.preview === 'emu' ? 'i-emu' : 'i-prev', meta.preview === 'emu' ? 'Emulador' : 'Prévia']);
  if (meta.build) b.push(['build', 'i-build', 'Build']);
  return b.length ? '<div class="act">' + b.map(([t, i, n]) => `<button type="button" data-tool="${t}"${meta.project ? ` data-proj="${esc(meta.project)}"` : ''}>${icon(i, 15)}${n}</button>`).join('') + '</div>' : '';
}
function msgAI(text = '', meta = {}) {
  const m = document.createElement('div'); m.className = 'msg ai';
  m.innerHTML = `<span class="who nm">${esc(NOME())}</span><div class="tx md"></div><div class="meta"><span class="tm">${hm(meta.created)}</span>${meta.model && meta.model !== '-' ? `<span>· ${esc(meta.model)}</span>` : ''}<button type="button" data-say>Ouvir</button><button type="button" data-copy>Copiar</button></div>`;
  m.querySelector('.tx').innerHTML = md(text); m._raw = text;
  m.querySelector('.meta').insertAdjacentHTML('beforebegin', actions({ ...meta, build: meta.tools?.some(t => t.name === 'gerar_apk') }));
  conv.appendChild(m); return m;
}
function msgMe(text, via, created) {
  const m = document.createElement('div'); m.className = 'msg me';
  m.innerHTML = '<div class="bub"></div>' + (via === 'voz' || (via && via !== 'texto') ? `<span class="via">${icon('i-mic', 12)}por voz${via && via !== 'voz' ? ' · em ' + esc(via) : ''}</span>` : `<span class="tm">${hm(created)}</span>`);
  m.querySelector('.bub').textContent = text; conv.appendChild(m); return m;
}
conv.addEventListener('click', e => {
  const t = e.target.closest('[data-tool]'); if (t) { if (t.dataset.proj) { S.currentProject = t.dataset.proj; localStorage.setItem('nexus_proj', t.dataset.proj); } openTool(t.dataset.tool); if (t.dataset.tool === 'prev' || t.dataset.tool === 'emu') refreshPreview(t.dataset.tool, true); }
  const say = e.target.closest('[data-say]'); if (say) speak(say.closest('.msg')._raw, true);
  const cp = e.target.closest('[data-copy]'); if (cp) navigator.clipboard?.writeText(cp.closest('.msg')._raw).then(() => toast('Copiado'));
  const ap = e.target.closest('.appr [data-a]'); if (ap) answerApproval(ap.closest('.appr').dataset.id, ap.dataset.a);
});

async function loadConv(id) {
  conv.innerHTML = '';
  if (!id) { greet(); return; }
  try {
    const c = await api('/api/convs/' + id);
    S.convId = id; localStorage.setItem('nexus_conv', id);
    if (!c.messages.length) greet();
    for (const m of c.messages) m.role === 'user' ? msgMe(m.content, m.meta?.via, m.created) : msgAI(m.content, { ...(m.meta || {}), created: m.created });
    for (const a of S.approvals.values()) if (a.state === 'wait') renderApproval(a);
    scrollEnd(true);
  } catch { S.convId = null; localStorage.removeItem('nexus_conv'); greet(); }
}
function greet() {
  const u = S.cfg?.usuario || '';
  msgAI(`Olá${u ? ', ' + u : ''}. Estou ouvindo enquanto o app estiver aberto.\nComece com **“Nexus”** e diga o que precisa, de qualquer tela. Ou escreva aqui embaixo.`);
}
function newConv() { S.convId = null; localStorage.removeItem('nexus_conv'); conv.innerHTML = ''; greet(); go(0); }

async function send(text, via = 'texto') {
  text = String(text || '').trim(); if (!text) return;
  if (localCommand(text)) { msgMe(text, via === 'texto' ? '' : via); scrollEnd(true); return; }
  if (S.streaming) { toast('Espere eu terminar a resposta atual (ou toque em parar).'); return; }
  msgMe(text, via === 'texto' ? '' : via); scrollEnd(true);
  const m = msgAI(''); const tx = m.querySelector('.tx'); tx.classList.add('cursor'); m.querySelector('.meta').hidden = true;
  let raw = '', toolEl = null;
  const ctrl = new AbortController(); S.streaming = { ctrl, convId: S.convId }; setSendMode();
  try {
    const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ convId: S.convId, text, via: via === 'texto' ? 'texto' : 'voz' }), signal: ctrl.signal });
    if (r.status === 401) { showGate(); throw new Error('login'); }
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
    while (true) {
      const { value, done } = await rd.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = (chunk.match(/^event: (.*)$/m) || [])[1], data = (chunk.match(/^data: (.*)$/m) || [])[1];
        if (!ev || !data) continue; const d = JSON.parse(data);
        if (ev === 'conv') { S.convId = d.convId; S.streaming.convId = d.convId; localStorage.setItem('nexus_conv', d.convId); }
        else if (ev === 'delta') { raw += d.t; tx.innerHTML = md(raw); if (toolEl) { toolEl.remove(); toolEl = null; } scrollEnd(); }
        else if (ev === 'info' && d.tool) { if (!toolEl) { toolEl = document.createElement('div'); toolEl.className = 'toolrun'; m.insertBefore(toolEl, m.querySelector('.meta')); } toolEl.innerHTML = '<i></i>' + esc(d.label || d.tool); scrollEnd(); }
        else if (ev === 'info' && d.fallback) { /* trocou de IA: segue sem alarde */ }
        else if (ev === 'done') { raw = d.text || raw; m.querySelector('.meta').insertAdjacentHTML('beforeend', d.model ? `<span>· ${esc(d.model)}</span>` : ''); m.querySelector('.meta').insertAdjacentHTML('beforebegin', actions(d)); }
      }
    }
  } catch (err) { if (err.name !== 'AbortError' && err.message !== 'login') raw += (raw ? '\n\n' : '') + '_(sem conexão com o servidor: ' + err.message + ')_'; }
  toolEl?.remove(); tx.classList.remove('cursor'); tx.innerHTML = md(raw || '…'); m._raw = raw; m.querySelector('.meta').hidden = false;
  S.streaming = null; setSendMode(); scrollEnd();
  if (S.page !== 0) showPop(raw);
  if (via !== 'texto') speak(raw);
}
function showPop(t) { $('popT').textContent = String(t).replace(/[*`#_]/g, '').trim(); pop.classList.add('on'); clearTimeout(showPop.t); showPop.t = setTimeout(() => pop.classList.remove('on'), 7000); }
pop.onclick = () => { pop.classList.remove('on'); go(0); };

// campo de texto
const q = $('q'), sendB = $('sendB');
function setSendMode() {
  const st = !!S.streaming; sendB.classList.toggle('stop', st); sendB.disabled = !st && !q.value.trim();
  sendB.setAttribute('aria-label', st ? 'Parar resposta' : 'Enviar');
  sendB.innerHTML = st ? '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"/></svg>' : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
}
function grow() { q.style.height = 'auto'; q.style.height = Math.min(140, q.scrollHeight) + 'px'; setSendMode(); }
q.addEventListener('input', grow);
q.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !isMob()) { e.preventDefault(); $('f').requestSubmit(); } });
$('f').addEventListener('submit', e => {
  e.preventDefault();
  if (S.streaming) { stopChat(); return; }
  const v = q.value; q.value = ''; grow(); send(v, 'texto');
});
function stopChat() { if (!S.streaming) return; api('/api/chat/stop', { body: { convId: S.streaming.convId } }).catch(() => { }); S.streaming.ctrl.abort(); }

// ---------- comandos que o próprio app resolve (sem IA) ----------
const TOOLN = { term: 'terminal', files: 'arquivos', proc: 'processo', emu: 'emulador', prev: 'prévia', build: 'build' };
function localCommand(raw) {
  const s = ' ' + raw.toLowerCase().replace(/^\s*nexus[,!.\s]*/, '') + ' ';
  if (/^\s*(para|pare|parar|cancela|cancelar|stop)\b[\s.!]*$/.test(s)) {
    stopChat(); api('/api/stop', { body: {} }).then(r => { msgAI(r.tarefas || r.terminal ? 'Parei o que estava rodando.' : 'Não há nada rodando agora.'); scrollEnd(true); }); return true;
  }
  const tgt = /\bterminal\b/.test(s) ? 'term' : /\barquivos?\b|\beditor\b/.test(s) ? 'files' : /\bemulador\b/.test(s) ? 'emu' : /\bpr[eé]via\b|\bnavegador\b/.test(s) ? 'prev' : /\bprocesso\b|\bpassos\b/.test(s) ? 'proc' : /\bjanela d[oe] build\b|\bo build\b/.test(s) ? 'build' : null;
  const short = s.trim().split(/\s+/).length <= 5;
  if (!tgt || !short) {
    if (short && /\bfech\w*\s+tud/.test(s)) { Object.keys(WIN).forEach(closeWin); reply('Fechei as janelas. O que estava rodando continua.'); return true; }
    return false;
  }
  const n = TOOLN[tgt];
  if (/\bminimiz/.test(s)) { minWin(tgt); reply('Minimizei o ' + n + '.'); return true; }
  if (/\bmaximiz|\bamplia|\btela cheia\b/.test(s)) { openTool(tgt); if (!WIN[tgt].max) maxWin(tgt); reply('Ampliei o ' + n + '.'); return true; }
  if (/\brestaur|\bdiminu|\btamanho normal\b/.test(s)) { openTool(tgt); if (WIN[tgt].max) maxWin(tgt); reply('Voltei o ' + n + ' ao tamanho normal.'); return true; }
  if (/\bfech\w*|\besconde\b/.test(s)) { closeWin(tgt); reply('Fechei o ' + n + '.'); return true; }
  if (/\babr\w*|\bmostr\w*|\bver\b/.test(s)) { openTool(tgt); reply('Abri o ' + n + '.'); return true; }
  return false;
}
function reply(t) { setTimeout(() => { msgAI(t); scrollEnd(true); if (S.page) showPop(t); }, 120); }

// ---------- aprovações ----------
function renderApproval(a) {
  let el = conv.querySelector(`.appr[data-id="${a.id}"]`);
  if (!el) { el = document.createElement('div'); el.className = 'appr'; el.dataset.id = a.id; conv.appendChild(el); }
  el.classList.toggle('done', a.state !== 'wait');
  el.innerHTML = `<b>${a.state === 'wait' ? 'PEDIDO DE APROVAÇÃO' : a.state === 'ok' ? 'COMANDO APROVADO' : 'COMANDO RECUSADO'}</b><small>${esc(a.why || 'A IA quer rodar este comando')} · em ~/projetos/${esc(a.cwd === '.' ? '' : a.cwd)}</small>` +
    (a.state === 'wait' ? `<textarea aria-label="Comando (pode editar)">${esc(a.cmd)}</textarea><div class="row"><button class="ok" data-a="ok">Aprovar</button><button data-a="edit">Aprovar editado</button><button class="no" data-a="no">Recusar</button></div>` : `<pre>${esc(a.cmd)}</pre>`);
  scrollEnd();
}
async function answerApproval(id, action) {
  const el = conv.querySelector(`.appr[data-id="${id}"]`), cmd = el?.querySelector('textarea')?.value;
  await api('/api/approvals/' + id, { body: { action: action === 'no' ? 'no' : 'ok', cmd: action === 'edit' ? cmd : undefined } }).catch(e => toast(e.message));
}

// ---------- eventos em tempo real ----------
let es = null;
function connectEvents() {
  es?.close(); es = new EventSource('/api/events');
  const on = (n, f) => es.addEventListener(n, e => f(JSON.parse(e.data)));
  on('hello', d => { S.jobs.clear(); d.jobs.forEach(j => S.jobs.set(j.id, j)); d.approvals.forEach(a => { S.approvals.set(a.id, a); renderApproval(a); }); S.cwd = d.cwd; pickLast(); renderSide(); refreshTools(); });
  on('job', j => { S.jobs.set(j.id, j); pickLast(); renderSide(); refreshTools(j); if (j.kind === 'build' && j.state !== 'run' && S.page) showPop(j.state === 'done' ? `APK pronto: ${j.data.apk}` : `O build parou: ${j.data.error || j.state}`); });
  on('joblog', d => { const j = S.jobs.get(d.id); if (j) { j.log = j.log || []; j.log.push(d); if (j.log.length > 400) j.log.splice(0, 100); } if (WIN.build && S.lastBuildJob === d.id) buildLogLine(d); });
  on('term', d => termLine(d));
  on('cwd', d => { S.cwd = d.cwd; const p = WIN.term?.body.querySelector('.cwd'); if (p) p.textContent = shortCwd(); });
  on('approval', a => { S.approvals.set(a.id, a); if (a.state === 'wait') { if (S.page !== 0) showPop('A IA quer rodar um comando. Toque para aprovar ou recusar.'); speakShort('Preciso da sua aprovação para um comando.'); } renderApproval(a); });
  on('file', () => { if (WIN.files?.state === 'open') filesRefresh(); });
  on('project', () => loadProjects());
  on('preview', d => { S.currentProject = d.slug; localStorage.setItem('nexus_proj', d.slug); loadProjects().then(() => { refreshPreview(d.kind === 'expo' ? 'emu' : 'prev', true); }); });
  on('opentool', d => { if (d.project) { S.currentProject = d.project; localStorage.setItem('nexus_proj', d.project); } if (d.auto) { renderSide(); UPDATE[d.tool]?.(); if (WIN[d.tool]) d.tool === 'files' ? filesRefresh() : 0; return; } openTool(d.tool); });
  on('memory', d => toast('Guardei na memória: ' + d.added[0]));
  on('apk', d => toast(`APK pronto: ${d.name}`));
  on('message', d => { if (!S.streaming && d.convId === S.convId) loadConv(S.convId); });
  es.onerror = () => { setTimeout(() => { if (es.readyState === 2) connectEvents(); }, 3000); };
}
function pickLast() {
  const all = [...S.jobs.values()].sort((a, b) => b.created - a.created);
  S.lastAgentJob = all.find(j => j.kind === 'agent')?.id || null;
  S.lastBuildJob = all.find(j => j.kind === 'build')?.id || null;
}

// ---------- menu lateral ----------
const side = $('side'), scrim = $('scrim'), sideb = $('sideb');
const TOOLS = [['term', 'Terminal', 'i-term'], ['files', 'Arquivos', 'i-files'], ['proc', 'Processo', 'i-proc'], ['emu', 'Emulador', 'i-emu'], ['prev', 'Prévia', 'i-prev'], ['build', 'Build do APK', 'i-build']];
const PAGES = [[1, 'Conversas', 'i-hist'], [2, 'Projetos', 'i-box'], [3, 'Memórias', 'i-mem'], [4, 'Sistema', 'i-gear'], [5, 'Comandos', 'i-chat'], [6, 'Configurações', 'i-sliders'], [7, 'Sobre', 'i-info']];
function openSide() { side.classList.add('on'); scrim.classList.add('on'); $('menuBtn').setAttribute('aria-expanded', 'true'); }
function closeSide() { side.classList.remove('on'); scrim.classList.remove('on'); $('menuBtn').setAttribute('aria-expanded', 'false'); }
$('menuBtn').onclick = openSide; $('sideX').onclick = closeSide; scrim.onclick = closeSide;
addEventListener('keydown', e => { if (e.key === 'Escape') closeSide(); });
{ let x0 = null; side.addEventListener('touchstart', e => x0 = e.touches[0].clientX, { passive: true }); side.addEventListener('touchmove', e => { if (x0 !== null && x0 - e.touches[0].clientX > 70) { x0 = null; closeSide(); } }, { passive: true }); }

function badge(id) {
  const w = WIN[id]; if (w && w.state === 'open') return '<span class="bd open"><i></i>ABERTA</span>';
  const j = id === 'build' ? S.jobs.get(S.lastBuildJob) : id === 'proc' || id === 'term' ? S.jobs.get(S.lastAgentJob) : null;
  if (j?.state === 'run') return '<span class="bd run"><i></i>AO VIVO</span>';
  if (id === 'build' && j) return j.state === 'done' ? '<span class="bd done"><i></i>PRONTO</span>' : '<span class="bd stop"><i></i>' + (j.state === 'error' ? 'ERRO' : 'PARADO') + '</span>';
  return '';
}
function sub(id) {
  const p = S.currentProject;
  if (id === 'build') { const b = S.jobs.get(S.lastBuildJob); if (b?.state === 'run') return 'Gerando · ' + b.pct + '%'; if (b?.state === 'done') return b.data.apk; return S.cfg?.build === 'gh' ? 'Pelo GitHub Actions' : 'No servidor (ARM)'; }
  if (id === 'proc') { const j = S.jobs.get(S.lastAgentJob); return j ? (j.state === 'run' ? 'Passo ' + j.steps.length : j.title) : 'Passos de cada tarefa'; }
  if (id === 'term') return shortCwd();
  if (id === 'emu' || id === 'prev' || id === 'files') return p || 'Nenhum projeto aberto';
  return '';
}
function renderSide() {
  const running = [...S.jobs.values()].filter(j => j.state === 'run').sort((a, b) => b.created - a.created);
  let h = `<button class="it" data-new>${icon('i-plus', 20)}<span class="tt">Nova conversa</span></button><button class="it${S.page === 0 ? ' cur' : ''}" data-go="0">${icon('i-chat', 20)}<span class="tt">Conversa</span></button>`;
  if (running.length) h += '<div class="lbl">TAREFAS</div>' + running.map(j => `<div class="job"><div class="r"><span>${esc(j.title)}</span><span>${j.pct}%</span></div><div class="pb"><i style="width:${j.pct}%"></i></div><small>${esc(j.steps[j.steps.length - 1]?.t || 'Começando…')}</small><button class="stopb" data-stopjob="${j.id}">Parar</button></div>`).join('');
  h += '<div class="lbl">FERRAMENTAS</div>' + TOOLS.map(t => `<button class="it" data-tool="${t[0]}">${icon(t[2], 20)}<span class="tt">${t[1]}<small>${esc(sub(t[0]))}</small></span>${badge(t[0])}</button>`).join('');
  h += '<div class="lbl">TELAS</div>' + PAGES.map(p => `<button class="it${S.page === p[0] ? ' cur' : ''}" data-go="${p[0]}">${icon(p[2], 20)}<span class="tt">${p[1]}</span></button>`).join('');
  sideb.innerHTML = h;
}
sideb.onclick = e => {
  const g = e.target.closest('[data-go]'), t = e.target.closest('[data-tool]'), sj = e.target.closest('[data-stopjob]'), nw = e.target.closest('[data-new]');
  if (sj) { api(`/api/jobs/${sj.dataset.stopjob}/stop`, { body: {} }); return; }
  if (nw) { newConv(); if (isMob()) closeSide(); return; }
  if (g) { go(+g.dataset.go); if (isMob()) closeSide(); }
  if (t) { if (isMob()) closeSide(); openTool(t.dataset.tool); }
};

// ---------- janelas das ferramentas ----------
const fwl = $('fwl'), WIN = {}; let zTop = 50;
const WN = { term: 'Terminal', files: 'Arquivos', proc: 'Processo', emu: 'Emulador', prev: 'Prévia', build: 'Build do APK' };
const WI = { term: 'i-term', files: 'i-files', proc: 'i-proc', emu: 'i-emu', prev: 'i-prev', build: 'i-build' };
const BTN = { min: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 18h14"/></svg>', max: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>', res: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="4" y="8" width="12" height="12" rx="2"/><path d="M8 8V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-3"/></svg>', x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>' };
function defRect(id) {
  const W = innerWidth, H = innerHeight;
  if (isMob()) { const y = Math.round($('hd').getBoundingClientRect().bottom) + 6, w = Math.min(W - 12, 760); return { x: (W - w) / 2, y, w, h: H - y - 10 }; }
  const L = 288, top = 72, bot = 24, avail = W - L, ph = Math.round((H - top - bot) * .58), pw = Math.min(460, avail * .42);
  if (id === 'emu') return { x: L + 20, y: top, w: 320, h: H - top - bot };
  if (id === 'proc') return { x: W - pw - 20, y: top, w: pw, h: ph };
  if (id === 'term') return { x: W - pw - 20, y: top + ph + 12, w: pw, h: H - top - bot - ph - 12 };
  const cw = Math.min(900, avail - 60); return { x: L + (avail - cw) / 2, y: top, w: cw, h: H - top - bot };
}
const maxRect = () => isMob() ? { x: 0, y: 0, w: innerWidth, h: innerHeight } : { x: 300, y: 12, w: innerWidth - 312, h: innerHeight - 24 };
const place = (w, r) => Object.assign(w.el.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
function focusWin(w) { w.el.style.zIndex = ++zTop; Object.values(WIN).forEach(o => o.el.classList.toggle('top', o === w)); }
function makeWin(id) {
  const el = document.createElement('section'); el.className = 'fw spawn hide'; el.setAttribute('aria-label', WN[id]);
  el.innerHTML = `<div class="fwh">${icon(WI[id], 17).replace('<svg', '<svg class="ic"')}<b>${WN[id]}</b><span class="lv" hidden><i></i><span>AO VIVO</span></span><button class="bm" aria-label="Minimizar ${WN[id]}">${BTN.min}</button><button class="bM" aria-label="Maximizar ${WN[id]}">${BTN.max}</button><button class="x" aria-label="Fechar ${WN[id]}">${BTN.x}</button></div><div class="fwb"></div><div class="fwr" aria-hidden="true"></div>`;
  fwl.appendChild(el);
  const w = WIN[id] = { id, el, body: el.querySelector('.fwb'), state: 'closed', max: false, rect: defRect(id) };
  el.querySelector('.bm').onclick = () => minWin(id); el.querySelector('.bM').onclick = () => maxWin(id); el.querySelector('.x').onclick = () => closeWin(id);
  el.addEventListener('pointerdown', () => focusWin(w));
  const hd = el.querySelector('.fwh'); let d = null, tap = 0;
  hd.addEventListener('pointerdown', e => { if (e.target.closest('button') || isMob()) return; const n = Date.now(); if (n - tap < 300) { maxWin(id); tap = 0; return; } tap = n; if (w.max) return; d = { x: e.clientX, y: e.clientY, r: { ...w.rect } }; hd.setPointerCapture(e.pointerId); el.classList.add('drag'); });
  hd.addEventListener('pointermove', e => { if (!d) return; w.rect = { ...d.r, x: Math.max(-d.r.w + 120, Math.min(innerWidth - 120, d.r.x + e.clientX - d.x)), y: Math.max(0, Math.min(innerHeight - 60, d.r.y + e.clientY - d.y)) }; place(w, w.rect); });
  hd.addEventListener('pointerup', () => { d = null; el.classList.remove('drag'); });
  const rz = el.querySelector('.fwr'); let r = null;
  rz.addEventListener('pointerdown', e => { if (w.max) return; r = { x: e.clientX, y: e.clientY, r: { ...w.rect } }; rz.setPointerCapture(e.pointerId); el.classList.add('rsz'); e.stopPropagation(); });
  rz.addEventListener('pointermove', e => { if (!r) return; w.rect = { ...r.r, w: Math.max(260, r.r.w + e.clientX - r.x), h: Math.max(170, r.r.h + e.clientY - r.y) }; place(w, w.rect); });
  rz.addEventListener('pointerup', () => { r = null; el.classList.remove('rsz'); });
  RENDER[id](w); return w;
}
function openWin(id) {
  const w = WIN[id] || makeWin(id), was = w.state; w.state = 'open'; w.el.classList.remove('hide');
  if (isMob() && !w.max) w.rect = defRect(id);
  place(w, w.max ? maxRect() : w.rect); focusWin(w);
  if (was === 'closed') requestAnimationFrame(() => requestAnimationFrame(() => w.el.classList.remove('spawn')));
  renderSide(); return w;
}
function minWin(id) { const w = WIN[id]; if (!w || w.state !== 'open') return; w.state = 'min'; w.el.classList.add('hide'); renderSide(); toast(WN[id] + ' minimizado. Está no menu lateral.'); }
function closeWin(id) { const w = WIN[id]; if (!w || w.state === 'closed') return; w.state = 'closed'; w.el.classList.add('hide'); renderSide(); }
function maxWin(id) { const w = WIN[id] || openWin(id); if (w.state !== 'open') openWin(id); w.max = !w.max; place(w, w.max ? maxRect() : w.rect); const b = w.el.querySelector('.bM'); b.innerHTML = w.max ? BTN.res : BTN.max; b.setAttribute('aria-label', (w.max ? 'Restaurar ' : 'Maximizar ') + WN[id]); focusWin(w); }
addEventListener('resize', () => Object.values(WIN).forEach(w => { if (w.state !== 'open') return; if (isMob() && !w.max) w.rect = defRect(w.id); place(w, w.max ? maxRect() : w.rect); }));
function openTool(id) { if (!WN[id]) return; const fresh = !WIN[id]; openWin(id); if (!fresh) UPDATE[id]?.(); }
function setLive(id, st) { const l = WIN[id]?.el.querySelector('.lv'); if (!l) return; l.hidden = !st; if (!st) return; l.className = 'lv' + (st === 'run' ? '' : st === 'done' ? ' done' : ' stop'); l.innerHTML = '<i></i><span>' + (st === 'run' ? 'AO VIVO' : st === 'done' ? 'CONCLUÍDO' : st === 'error' ? 'ERRO' : 'PARADO') + '</span>'; }
function refreshTools(j) {
  if (!j || j.kind === 'agent') { UPDATE.proc?.(); }
  if (!j || j.kind === 'build') { UPDATE.build?.(); }
}

// --- terminal ---
const shortCwd = () => String(S.cwd || '').replace(/^.*?\/projetos/, '~/projetos');
let termBuf = [];
function termLine(d) {
  termBuf.push(d); if (termBuf.length > 1500) termBuf.splice(0, 300);
  const w = WIN.term; if (!w) return;
  const out = w.body.querySelector('.term'), stick = out.scrollHeight - out.scrollTop - out.clientHeight < 60;
  out.appendChild(termEl(d)); while (out.childElementCount > 1500) out.firstChild.remove();
  if (stick) out.scrollTop = out.scrollHeight;
}
function termEl(d) {
  const el = document.createElement('div');
  if (d.cls === 'cmd') el.innerHTML = `<span class="p">${d.src === 'voce' ? 'você' : 'nexus'}@servidor</span>$ <span class="c">${esc(d.text)}</span>`;
  else { el.className = { e: 'e', ok: 'ok', w: 'w', o: 'o' }[d.cls] || 'o'; el.textContent = d.text; }
  return el;
}
const RENDER = {
  term(w) {
    w.body.innerHTML = `<div class="tw"><div class="term" role="log"><div class="o">${esc(NOME())} · terminal do servidor. Comandos digitados aqui rodam direto (você é o dono). Os da IA pedem aprovação.</div></div><form><span class="cwd">${esc(shortCwd())}</span><span>$</span><input aria-label="Comando" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="digite um comando"><button type="button" class="stp">Parar</button></form></div>`;
    const out = w.body.querySelector('.term'); termBuf.forEach(d => out.appendChild(termEl(d))); out.scrollTop = out.scrollHeight;
    const f = w.body.querySelector('form'), inp = f.querySelector('input'); const hist = []; let hi = 0;
    f.onsubmit = async e => { e.preventDefault(); const cmd = inp.value.trim(); if (!cmd) return; hist.push(cmd); hi = hist.length; inp.value = ''; termLine({ text: cmd, cls: 'cmd', src: 'voce' }); const r = await api('/api/term', { body: { cmd } }).catch(err => ({ erro: err.message })); if (r.busy) toast('Ainda rodando o comando anterior. Toque em Parar.'); if (r.erro) termLine({ text: r.erro, cls: 'e' }); };
    inp.addEventListener('keydown', e => { if (e.key === 'ArrowUp' && hi > 0) { inp.value = hist[--hi]; e.preventDefault(); } if (e.key === 'ArrowDown') { inp.value = hist[++hi] || ''; hi = Math.min(hi, hist.length); } });
    f.querySelector('.stp').onclick = () => api('/api/term/stop', { body: {} });
  },
  proc(w) { w.body.innerHTML = '<div class="proc"><div class="hdp"><span id="pTitle">Nenhuma tarefa ainda</span><span id="pCount"></span></div><div class="bar"><i id="pBar"></i></div><div id="pSteps"><div class="vazio">Quando a IA usar ferramentas, os passos aparecem aqui.</div></div></div>'; w.body.addEventListener('click', e => { const b = e.target.closest('.stp>button'); if (b) { const s = b.parentElement; s.classList.toggle('open'); b.setAttribute('aria-expanded', s.classList.contains('open')); } }); UPDATE.proc(); },
  files(w) {
    w.body.innerHTML = `<div class="fx"><div class="tree"><select class="proj" aria-label="Projeto"></select><div class="tl"></div></div><div class="ed"><div class="edh"><button type="button" class="bk">‹ Arquivos</button><span class="fn">Escolha um arquivo</span><button type="button" class="sv" disabled>Salvar</button></div><textarea spellcheck="false" aria-label="Conteúdo do arquivo" disabled></textarea></div></div>`;
    const fx = w.body.querySelector('.fx'), sel = w.body.querySelector('.proj'), ta = w.body.querySelector('textarea'), sv = w.body.querySelector('.sv');
    sel.onchange = () => { S.currentProject = sel.value; localStorage.setItem('nexus_proj', sel.value); filesRefresh(); renderSide(); };
    w.body.querySelector('.tl').onclick = async e => {
      const b = e.target.closest('button[data-p]'); if (!b) return;
      if (b.dataset.dir) { b.parentElement.querySelector('ul')?.toggleAttribute('hidden'); return; }
      try { const r = await api('/api/files/read?path=' + encodeURIComponent(b.dataset.p)); w.file = b.dataset.p; ta.value = r.content; ta.disabled = false; sv.disabled = false; w.body.querySelector('.fn').textContent = b.dataset.p; fx.classList.add('editing'); w.body.querySelectorAll('.tl button.on').forEach(x => x.classList.remove('on')); b.classList.add('on'); }
      catch (err) { toast(err.message); }
    };
    w.body.querySelector('.bk').onclick = () => fx.classList.remove('editing');
    sv.onclick = async () => { try { await api('/api/files/write', { method: 'PUT', body: { path: w.file, content: ta.value } }); toast('Salvo'); } catch (err) { toast(err.message); } };
    ta.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); sv.click(); } if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); } });
    filesRefresh();
  },
  emu(w) { w.body.innerHTML = `<div class="emu" style="position:absolute;inset:0"><div class="ub"><select class="proj" aria-label="Projeto" style="flex:1;height:32px;border-radius:16px;border:1px solid var(--line);background:#16171d;color:#fff;font:13px var(--b);padding:0 10px"></select><button type="button" class="ib rl" style="width:32px;height:32px" aria-label="Gerar a prévia de novo">${icon('i-reload', 16)}</button></div><div class="phone" style="height:calc(100% - 44px);max-height:640px;width:auto;max-width:100%;margin-top:40px"><div class="scr"><div class="boot"><div class="sp"></div>Sem prévia ainda</div></div></div></div>`; previewWire(w, 'emu'); refreshPreview('emu'); },
  prev(w) { w.body.innerHTML = `<div class="brw"><div class="ub"><select class="proj" aria-label="Projeto"></select><button type="button" class="rl" aria-label="Gerar a prévia de novo">${icon('i-reload', 16)}</button><a class="ex" target="_blank" rel="noopener" aria-label="Abrir em outra aba">${icon('i-ext', 16)}</a></div><div class="nada">Escolha um projeto para ver a prévia.</div><iframe title="Prévia" hidden></iframe></div>`; previewWire(w, 'prev'); refreshPreview('prev'); },
  build(w) {
    w.body.innerHTML = `<div class="bld"><div class="ctl"><div class="r"><select class="proj" aria-label="Projeto"></select></div><div class="seg" role="radiogroup" aria-label="Onde gerar"><button type="button" role="radio" data-b="srv"><b>No servidor</b><small>Oracle ARM</small></button><button type="button" role="radio" data-b="gh"><b>GitHub Actions</b><small>nuvem do GitHub</small></button></div><button class="btnp go" type="button" style="margin:0">Gerar APK</button></div><div class="cur"></div><div class="sec">APKs GERADOS</div><ul class="hist"></ul></div>`;
    const seg = w.body.querySelector('.seg');
    seg.onclick = e => { const b = e.target.closest('[data-b]'); if (!b) return; S.cfg.build = b.dataset.b; api('/api/settings', { method: 'PUT', body: { build: b.dataset.b } }).then(c => S.cfg = c); UPDATE.build(); };
    w.body.querySelector('.proj').onchange = e => { S.currentProject = e.target.value; localStorage.setItem('nexus_proj', e.target.value); };
    w.body.querySelector('.go').onclick = async () => { const slug = w.body.querySelector('.proj').value; if (!slug) return toast('Crie um projeto primeiro.'); try { const j = await api('/api/build', { body: { slug, method: S.cfg.build } }); S.jobs.set(j.id, j); S.lastBuildJob = j.id; UPDATE.build(); } catch (err) { toast(err.message); } };
    w.body.addEventListener('click', e => { const b = e.target.closest('[data-stopjob]'); if (b) api(`/api/jobs/${b.dataset.stopjob}/stop`, { body: {} }); });
    UPDATE.build();
  },
};
function projOptions(sel) {
  const cur = S.currentProject;
  sel.innerHTML = S.projects.length ? S.projects.map(p => `<option value="${esc(p.slug)}"${p.slug === cur ? ' selected' : ''}>${esc(p.title)} · ${esc(p.kind)}</option>`).join('') : '<option value="">Nenhum projeto</option>';
  if (!cur && S.projects[0]) S.currentProject = S.projects[0].slug;
}
async function filesRefresh() {
  const w = WIN.files; if (!w) return;
  projOptions(w.body.querySelector('.proj'));
  const slug = S.currentProject, tl = w.body.querySelector('.tl');
  if (!slug) { tl.innerHTML = '<div class="empty2">Nenhum projeto ainda. Peça: “Nexus, cria um site…”</div>'; return; }
  try {
    const t = await api('/api/files/tree?path=' + encodeURIComponent(slug));
    const ul = l => '<ul>' + l.map(f => `<li><button type="button" data-p="${esc(f.path)}"${f.dir ? ' data-dir="1"' : ''} class="${f.skipped ? 'sk' : ''}${w.file === f.path ? ' on' : ''}">${icon(f.dir ? 'i-dir' : 'i-files', 14)}${esc(f.name)}</button>${f.dir && f.children?.length ? ul(f.children) : ''}</li>`).join('') + '</ul>';
    tl.innerHTML = t.length ? ul(t) : '<div class="empty2">Pasta vazia</div>';
  } catch (err) { tl.innerHTML = `<div class="empty2">${esc(err.message)}</div>`; }
}
function previewWire(w, id) {
  const sel = w.body.querySelector('.proj');
  sel.onchange = () => { S.currentProject = sel.value; localStorage.setItem('nexus_proj', sel.value); refreshPreview(id); renderSide(); };
  w.body.querySelector('.rl').onclick = async () => {
    const slug = sel.value; if (!slug) return;
    toast('Gerando a prévia…');
    try { await api('/api/preview/' + encodeURIComponent(slug), { body: {} }); refreshPreview(id, true); } catch (err) { toast(err.message, 5000); }
  };
}
function refreshPreview(id, bust) {
  const w = WIN[id]; if (!w) return;
  const sel = w.body.querySelector('.proj'); projOptions(sel);
  const slug = S.currentProject, url = slug ? `/p/${encodeURIComponent(slug)}/` + (bust ? '?v=' + Date.now() : '') : '';
  if (id === 'prev') {
    const fr = w.body.querySelector('iframe'), nada = w.body.querySelector('.nada'); w.body.querySelector('.ex').href = url || '#';
    if (!slug) { fr.hidden = true; nada.hidden = false; return; }
    nada.hidden = true; fr.hidden = false; if (bust || !fr.src.includes(`/p/${slug}/`)) fr.src = url;
  } else {
    const scr = w.body.querySelector('.scr'); if (!slug) return;
    let fr = scr.querySelector('iframe'); if (!fr) { scr.innerHTML = '<iframe title="Emulador"></iframe>'; fr = scr.querySelector('iframe'); }
    if (bust || !fr.src.includes(`/p/${slug}/`)) fr.src = url;
  }
}
const UPDATE = {
  proc() {
    const w = WIN.proc; if (!w) return; const j = S.jobs.get(S.lastAgentJob);
    setLive('proc', j?.state);
    if (!j) return;
    w.body.querySelector('#pTitle').textContent = j.title; w.body.querySelector('#pCount').textContent = j.steps.length + (j.steps.length === 1 ? ' passo' : ' passos');
    w.body.querySelector('#pBar').style.width = (j.state === 'run' ? Math.max(5, j.pct) : 100) + '%';
    const open = new Set([...w.body.querySelectorAll('.stp.open')].map(e => e.dataset.i));
    w.body.querySelector('#pSteps').innerHTML = j.steps.map((s, i) => {
      const st = s.state === 'done' ? '<svg class="dn" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>' : s.state === 'run' ? '<i class="sp"></i>' : '<span class="xx">×</span>';
      return `<div class="stp${open.has(String(i)) ? ' open' : ''}" data-i="${i}"><button type="button" aria-expanded="${open.has(String(i))}"><span class="si">${st}</span><span class="tt">${esc(s.t)}<small>${esc(s.k)}</small></span>${s.detail ? '<svg class="chv" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>' : ''}</button>${s.detail ? `<div class="dt">${esc(s.detail)}</div>` : ''}</div>`;
    }).join('') || '<div class="vazio">Começando…</div>';
  },
  build() {
    const w = WIN.build; if (!w) return;
    projOptions(w.body.querySelector('.proj'));
    w.body.querySelectorAll('.seg [data-b]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.b === (S.cfg?.build || 'srv'))));
    const b = S.jobs.get(S.lastBuildJob), cur = w.body.querySelector('.cur');
    setLive('build', b?.state);
    w.body.querySelector('.go').disabled = b?.state === 'run';
    if (!b) cur.innerHTML = '';
    else {
      const meta = `Android · v${esc(b.data.version || '')} · ${b.data.method === 'gh' ? 'GitHub Actions' : 'no servidor (ARM)'}`;
      const steps = b.steps.map(s => `<li class="${s.state === 'done' ? 'dn' : s.state === 'run' ? 'sp' : 'xx'}"><span class="si">${s.state === 'done' ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>' : s.state === 'run' ? '<i class="sp"></i>' : '×'}</span>${esc(s.t)}</li>`).join('');
      cur.innerHTML = `<div class="bh" style="margin-top:14px"><b>${esc(b.title)}</b><span>${meta}</span></div><div class="bar" style="margin:10px 0"><i style="width:${b.state === 'run' ? b.pct : 100}%"></i></div><ol class="bs">${steps}</ol><div class="blog term" id="bLog"></div>` +
        (b.state === 'run' ? `<button class="stopb" data-stopjob="${b.id}" style="margin-top:10px">Parar build</button>` : '') +
        (b.state === 'done' ? `<div class="apk" style="margin-top:12px">${icon('i-build', 26)}<div class="tt"><b>${esc(b.data.apk)}</b><small>${mb(b.data.size || 0)} · pronto para instalar</small></div></div><div class="cmdsA"><a class="btnp" href="${esc(b.data.url)}" download>Baixar APK</a><a class="btng" href="${esc(b.data.url)}" style="display:inline-grid;place-items:center;text-decoration:none">Instalar no celular</a></div>` : '') +
        (b.state === 'error' ? `<div class="err" style="margin-top:12px">${esc(b.data.error || 'Falhou')}</div>` : '');
      const L = cur.querySelector('#bLog'); (b.log || []).slice(-150).forEach(d => buildLogLine(d, L));
    }
    api('/api/apks').then(l => { w.body.querySelector('.hist').innerHTML = l.slice(0, 8).map(a => `<li><a href="/api/apks/${encodeURIComponent(a.name)}" download>${icon('i-build', 16)}${esc(a.name)}<span>${mb(a.size)}</span></a></li>`).join('') || '<li class="empty2">Nenhum ainda</li>'; }).catch(() => { });
  },
};
function buildLogLine(d, L) {
  L = L || WIN.build?.body.querySelector('#bLog'); if (!L) return;
  const el = document.createElement('div'); el.className = d.cls === 'cmd' ? 'c' : d.cls || 'o'; el.textContent = d.text; L.appendChild(el);
  while (L.childElementCount > 200) L.firstChild.remove(); L.scrollTop = L.scrollHeight;
}
async function loadProjects() { try { const r = await api('/api/projects'); S.projects = r.list; S.kinds = r.kinds; if (S.currentProject && !S.projects.some(p => p.slug === S.currentProject)) S.currentProject = S.projects[0]?.slug || ''; } catch { } ['files', 'build'].forEach(id => WIN[id] && (id === 'files' ? filesRefresh() : UPDATE.build())); ['emu', 'prev'].forEach(id => WIN[id] && projOptions(WIN[id].body.querySelector('.proj'))); renderSide(); }

// ---------- telas ----------
let viewTimer = null;
const kv = (k, v, cls = '') => `<div><span>${esc(k)}</span><b class="${cls}">${v}</b></div>`;
function gauge(label, v, color) { const C = 2 * Math.PI * 32, d = C * Math.min(100, v) / 100; return `<div class="ga" data-g="${label}"><div><svg viewBox="0 0 76 76"><circle cx="38" cy="38" r="32" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="7"/><circle class="arc" cx="38" cy="38" r="32" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${d} ${C}"/></svg><b><span class="gv">${Math.round(v)}</span><small>%</small></b></div>${label}</div>`; }
const VIEWS = {
  1: { t: 'Conversas', async h() { return `<input class="srch" type="search" placeholder="Buscar nas conversas" aria-label="Buscar"><ul class="lst" id="cl"></ul>`; },
    async init(el) {
      const draw = l => { el.querySelector('#cl').innerHTML = l.map(c => `<li class="${c.id === S.convId ? 'cur' : ''}"><span class="tt" data-open="${c.id}" style="cursor:pointer"><b>${esc(c.title)}</b><small>${new Date(c.updated).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></span><button class="ic" data-ren="${c.id}" aria-label="Renomear">${icon('i-edit')}</button><button class="ic" data-del="${c.id}" aria-label="Apagar">${icon('i-trash')}</button></li>`).join('') || '<li class="empty2">Nenhuma conversa ainda</li>'; };
      draw(await api('/api/convs'));
      let t; el.querySelector('.srch').oninput = e => { clearTimeout(t); t = setTimeout(async () => draw(await api(e.target.value ? '/api/search?q=' + encodeURIComponent(e.target.value) : '/api/convs')), 250); };
      el.onclick = async e => {
        const o = e.target.closest('[data-open]'), r = e.target.closest('[data-ren]'), d = e.target.closest('[data-del]');
        if (o) { await loadConv(o.dataset.open); go(0); }
        if (r) { const n = prompt('Novo nome da conversa:'); if (n) { await api('/api/convs/' + r.dataset.ren, { method: 'PATCH', body: { title: n } }); draw(await api('/api/convs')); } }
        if (d && confirm('Apagar esta conversa?')) { await api('/api/convs/' + d.dataset.del, { method: 'DELETE' }); if (d.dataset.del === S.convId) newConv(); draw(await api('/api/convs')); }
      };
    } },
  2: { t: 'Projetos', async h() {
      await loadProjects();
      return `<form class="addrow" id="np"><input name="n" placeholder="Nome do projeto novo" required><select name="k">${Object.entries(S.kinds || {}).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select><button>Criar</button></form><ul class="lst">${S.projects.map(p => `<li><span class="tt"><b>${esc(p.title)}</b><small>${esc((S.kinds || {})[p.kind] || p.kind)} · v${esc(p.version)}${p.lastApk ? ' · ' + esc(p.lastApk) : ''}</small><span class="pchips"><button data-pa="files" data-s="${esc(p.slug)}">Arquivos</button><button data-pa="prev" data-s="${esc(p.slug)}">Prévia</button><button data-pa="build" data-s="${esc(p.slug)}">Gerar APK</button>${p.kind !== 'expo' ? `<button data-pa="pub" data-s="${esc(p.slug)}">Publicar site</button>` : ''}</span></span></li>`).join('') || '<li class="empty2">Nenhum projeto ainda. Diga: “Nexus, cria um app de tarefas”.</li>'}</ul>`;
    },
    init(el) {
      el.querySelector('#np').onsubmit = async e => { e.preventDefault(); const f = e.target; toast('Criando…', 8000); try { await api('/api/projects', { body: { name: f.n.value, kind: f.k.value } }); toast('Projeto criado'); go(2); } catch (err) { toast(err.message, 6000); } };
      el.onclick = async e => {
        const b = e.target.closest('[data-pa]'); if (!b) return; S.currentProject = b.dataset.s; localStorage.setItem('nexus_proj', b.dataset.s);
        if (b.dataset.pa === 'pub') { go(0); send(`Nexus, publica o projeto ${b.dataset.s} no GitHub Pages`, 'texto'); return; }
        if (b.dataset.pa === 'build') { openTool('build'); return; }
        if (b.dataset.pa === 'prev') { const p = S.projects.find(x => x.slug === b.dataset.s); openTool(p?.kind === 'expo' ? 'emu' : 'prev'); WIN[p?.kind === 'expo' ? 'emu' : 'prev'].body.querySelector('.rl').click(); return; }
        openTool(b.dataset.pa); filesRefresh();
      };
    } },
  3: { t: 'Memórias', async h() {
      const l = await api('/api/memories');
      return `<p class="vp">Tudo o que eu sei sobre você. Eu guardo sozinha o que for duradouro; você pode corrigir ou apagar.</p><form class="addrow" id="nm"><input name="t" placeholder="Algo para eu lembrar" required><button>Guardar</button></form><ul class="lst">${l.map(m => `<li><span class="tt"><b style="white-space:normal">${esc(m.text)}</b><small>${m.source === 'auto' ? 'aprendido na conversa' : m.source === 'ia' ? 'guardado pela IA' : 'adicionado por você'} · ${new Date(m.updated).toLocaleDateString('pt-BR')}</small></span><button class="ic" data-ed="${m.id}" data-t="${esc(m.text)}" aria-label="Editar">${icon('i-edit')}</button><button class="ic" data-rm="${m.id}" aria-label="Apagar">${icon('i-trash')}</button></li>`).join('') || '<li class="empty2">Nada guardado ainda.</li>'}</ul>`;
    },
    init(el) {
      el.querySelector('#nm').onsubmit = async e => { e.preventDefault(); await api('/api/memories', { body: { text: e.target.t.value } }); go(3); };
      el.onclick = async e => { const ed = e.target.closest('[data-ed]'), rm = e.target.closest('[data-rm]'); if (ed) { const t = prompt('Editar memória:', ed.dataset.t); if (t) { await api('/api/memories/' + ed.dataset.ed, { method: 'PATCH', body: { text: t } }); go(3); } } if (rm && confirm('Apagar esta memória?')) { await api('/api/memories/' + rm.dataset.rm, { method: 'DELETE' }); go(3); } };
    } },
  4: { t: 'Sistema', async h() { return '<div id="sy"><div class="empty2">Lendo o servidor…</div></div>'; },
    init(el) {
      const draw = async () => {
        let s; try { s = await api('/api/system'); } catch { return; }
        const up = s.uptime > 86400 ? Math.floor(s.uptime / 86400) + ' dias' : Math.floor(s.uptime / 3600) + ' h';
        const sy = el.querySelector('#sy'); if (!sy) return;
        sy.innerHTML = `<div class="vgauges">${gauge('CPU', s.cpu, '#60a5fa')}${gauge('RAM', 100 * s.ram.used / s.ram.total, '#6ee7b7')}${gauge('DISCO', 100 * s.disk.used / (s.disk.total || 1), '#fcd34d')}</div>
<div class="sec">SERVIDOR</div><div class="kv">${kv('IA local', s.ia.llm ? 'online' : 'fora do ar', s.ia.llm ? 'g' : '')}${kv('Memória (embeddings)', s.ia.embed ? 'online' : 'fora do ar', s.ia.embed ? 'g' : '')}${kv('Ligado há', up)}${kv('Processador', s.cores + ' núcleos · ' + s.arch)}${kv('RAM', gb(s.ram.used) + ' de ' + gb(s.ram.total))}${kv('Disco', gb(s.disk.used) + ' de ' + gb(s.disk.total))}${kv('Rede ↓', (s.net.down * 8 / 1e6).toFixed(1).replace('.', ',') + ' Mbps')}${kv('Rede ↑', (s.net.up * 8 / 1e6).toFixed(1).replace('.', ',') + ' Mbps')}</div>
<div class="sec">SERVIÇOS</div><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Serviço</th><th>Estado</th><th class="n">CPU</th><th class="n">RAM</th></tr></thead><tbody>${s.procs.map(p => `<tr><td>${esc(p.name)}</td><td class="${p.on ? 'on' : 'off'}">${p.on ? 'rodando' : 'parado'}</td><td class="n">${p.cpu.toFixed(0)}%</td><td class="n">${p.ram ? mb(p.ram) : '—'}</td></tr>`).join('')}</tbody></table></div>`;
      };
      draw(); viewTimer = setInterval(draw, 3000);
    } },
  5: { t: 'Comandos', async h() {
      const b = l => '<div class="cmds">' + l.map(t => `<button type="button">${esc(t)}</button>`).join('') + '</div>';
      return `<p class="vp">Fale começando com “Nexus” (de qualquer tela) ou toque num exemplo para mandar agora.</p><div class="sec">CRIAR</div>${b(['Nexus, cria um app de tarefas', 'Nexus, cria um jogo 2D de nave', 'Nexus, cria um site para a minha barbearia', 'Nexus, cria um jogo 3D simples e gera o APK'])}<div class="sec">BUILD E PUBLICAÇÃO</div>${b(['Nexus, gera o APK', 'Gera o APK pelo GitHub', 'Gera o APK no servidor', 'Publica o site'])}<div class="sec">JANELAS</div>${b(['Abre o terminal', 'Abre os arquivos', 'Abre a prévia', 'Maximiza o emulador', 'Fecha tudo', 'Para'])}<div class="sec">DIA A DIA</div>${b(['Status do sistema', 'O que você lembra sobre mim?', 'Resume a nossa última conversa'])}`;
    },
    init(el) { el.onclick = e => { const b = e.target.closest('.cmds button'); if (b) { const t = b.textContent; if (localCommand(t)) { msgMe(t); return; } go(0); send(t, 'texto'); } }; } },
  6: { t: 'Configurações', async h() {
      const c = S.cfg = await api('/api/settings'), P = c.provedoresInfo;
      const tg = (k, t, s) => `<div class="tg"><span>${t}<small>${s}</small></span><button type="button" class="sw" role="switch" data-k="${k}" aria-checked="${!!c[k]}" aria-label="${t}"></button></div>`;
      return `<form class="fm" id="cf">
<div class="sec">ASSISTENTE</div><div class="row2"><label>Nome do assistente<input name="nome" value="${esc(c.nome)}"></label><label>Seu nome<input name="usuario" value="${esc(c.usuario)}"></label></div>
<label>Personalidade<textarea name="personalidade" rows="3">${esc(c.personalidade)}</textarea></label>
${tg('voz', 'Responder falando', c.vozServidor.tts ? 'Voz masculina do servidor (Piper · faber)' : 'Voz do celular (instale o Piper para a voz do servidor)')}${tg('aprovacao', 'Pedir aprovação no terminal', 'Comandos que só leem rodam direto')}${tg('reforco', 'IAs de reforço', 'Perguntas difíceis e código vão para IAs grandes grátis')}${tg('pensar', 'Pensar mais (mais lento)', 'Liga o raciocínio longo do Qwen 3')}
<div class="sec">IAS DE REFORÇO</div><p class="hint">Cada chave é grátis. Quando uma bate o limite, passo para a próxima; se todas acabarem, uso a IA local. Assuntos pessoais e a memória ficam no servidor.</p>
${Object.entries(P).map(([id, p]) => `<div class="prov"><div class="hd"><b>${p.name}</b><button type="button" class="sw" role="switch" data-p="${id}" aria-checked="${!!c.provedores[id]?.on}" aria-label="Usar ${p.name}"></button></div><div class="row2"><label>Modelo<input name="m_${id}" value="${esc(c.provedores[id]?.model || '')}" autocomplete="off"></label><label>Chave de API ${c.chaves[id] ? '<span class="ok">· salva</span>' : `· <a href="${p.keyUrl}" target="_blank" rel="noopener">pegar chave</a>`}<input name="k_${id}" type="password" autocomplete="off" placeholder="${c.chaves[id] ? '•••••••• (deixe vazio para manter)' : 'cole a chave aqui'}"></label></div></div>`).join('')}
<div class="sec">BUILD DO APK</div><div class="seg" role="radiogroup" aria-label="Onde gerar o APK"><button type="button" role="radio" data-b="srv" aria-checked="${c.build !== 'gh'}"><b>No servidor</b><small>${c.buildServidor.ok ? 'Android SDK pronto' : 'SDK ainda não instalado'}</small></button><button type="button" role="radio" data-b="gh" aria-checked="${c.build === 'gh'}"><b>GitHub Actions</b><small>Build na nuvem do GitHub</small></button></div>
<label>Link do repositório<input name="repo" inputmode="url" placeholder="https://github.com/usuario/repositorio" value="${esc(c.repo)}" autocomplete="off"></label>
<label>Token do GitHub ${c.github ? '<span class="ok">· salvo no servidor</span>' : ''}<input name="gh" type="password" autocomplete="off" placeholder="${c.github ? '•••••••• (deixe vazio para manter)' : 'github_pat_…'}"></label>
<p class="hint">O link diz <b>onde</b> enviar; o token dá a <b>permissão</b>. Crie em GitHub → Settings → Developer settings → Fine-grained tokens, só para esse repositório, com <b>Contents</b> e <b>Actions</b> em “Read and write”. Também uso o mesmo repositório para publicar sites no GitHub Pages.</p>
<div class="btnrow"><button type="button" class="btng" id="ght">Testar conexão</button><span id="ghs" class="hint" style="margin:0"></span></div>
<div class="sec">SEGURANÇA</div><div class="row2"><label>Senha atual<input name="sa" type="password" autocomplete="current-password"></label><label>Senha nova<input name="sn" type="password" autocomplete="new-password"></label></div>
<div class="btnrow"><button class="btnp" type="submit">Salvar</button><button type="button" class="btng danger" id="out">${icon('i-out', 16)} Sair</button></div></form>`;
    },
    init(el) {
      const f = el.querySelector('#cf'), c = S.cfg;
      f.onclick = e => { const sw = e.target.closest('.sw'); if (sw) sw.setAttribute('aria-checked', String(sw.getAttribute('aria-checked') !== 'true')); const sb = e.target.closest('.seg [data-b]'); if (sb) f.querySelectorAll('.seg [data-b]').forEach(x => x.setAttribute('aria-checked', String(x === sb))); };
      el.querySelector('#ght').onclick = async () => { const s = el.querySelector('#ghs'); s.className = 'hint'; s.textContent = 'Testando…'; const r = await api('/api/github/test', { body: { repo: f.repo.value.trim(), token: f.gh.value.trim() } }); s.className = r.ok ? 'ok' : 'bad'; s.textContent = r.ok ? `✔ Conectado a ${r.full}${r.private ? ' (privado)' : ''}` : r.erro; if (r.ok) f.gh.value = ''; };
      el.querySelector('#out').onclick = async () => { await api('/api/logout', { body: {} }); location.reload(); };
      f.onsubmit = async e => {
        e.preventDefault();
        const on = k => f.querySelector(`.sw[data-k="${k}"]`).getAttribute('aria-checked') === 'true';
        const body = { nome: f.nome.value.trim() || 'N.E.X.U.S.', usuario: f.usuario.value.trim(), personalidade: f.personalidade.value, voz: on('voz'), aprovacao: on('aprovacao'), reforco: on('reforco'), pensar: on('pensar'),
          build: f.querySelector('.seg [aria-checked="true"]').dataset.b, repo: f.repo.value.trim(), provedores: {}, chaves: {} };
        for (const id of Object.keys(c.provedoresInfo)) { body.provedores[id] = { on: f.querySelector(`.sw[data-p="${id}"]`).getAttribute('aria-checked') === 'true', model: f['m_' + id].value.trim() }; if (f['k_' + id].value.trim()) body.chaves[id] = f['k_' + id].value.trim(); }
        if (f.gh.value.trim()) body.githubToken = f.gh.value.trim();
        if (f.sn.value) { body.novaSenha = f.sn.value; body.senhaAtual = f.sa.value; }
        try { S.cfg = await api('/api/settings', { method: 'PUT', body }); applyName(); toast('Configurações salvas'); go(6); } catch (err) { toast(err.message, 5000); }
      };
    } },
  7: { t: 'Sobre', async h() {
      const c = S.cfg;
      return `<div class="kv">${kv('Assistente', esc(c.nome))}${kv('Versão', esc(c.versao))}${kv('IA local', 'Qwen 3 4B (llama.cpp)')}${kv('Servidor', 'Oracle Cloud Always Free')}${kv('Voz do servidor', c.vozServidor.tts ? 'instalada' : 'não instalada')}${kv('Ouvir pelo servidor', c.vozServidor.stt ? 'instalado (Whisper)' : 'não instalado')}</div><p class="vp" style="margin-top:14px">Tudo roda no seu servidor. As conversas, a memória, os tokens e as chaves ficam guardados lá, criptografados quando são segredos.</p>`;
    } },
};
async function go(i) {
  clearInterval(viewTimer); viewTimer = null; S.page = i; document.body.classList.toggle('onpage', i !== 0);
  if (i === 0) { pageV.hidden = true; chatV.hidden = false; $('ttl').innerHTML = `<span class="nm">${esc(NOME())}</span>`; scrollEnd(true); }
  else {
    const V = VIEWS[i]; chatV.hidden = true; pageV.hidden = false; $('ttl').textContent = V.t; page.onclick = null; page.innerHTML = '<div class="empty2">Carregando…</div>';
    try { page.innerHTML = await V.h(); pageV.scrollTop = 0; V.init?.(page); } catch (err) { page.innerHTML = `<div class="empty2">${esc(err.message)}</div>`; }
  }
  renderSide();
}
$('backBtn').onclick = () => go(0);
pageV.addEventListener('scroll', () => $('hd').classList.toggle('sep', pageV.scrollTop > 4));
chatV.addEventListener('scroll', () => $('hd').classList.toggle('sep', chatV.scrollTop > 4));
function applyName() { document.querySelectorAll('.nm').forEach(e => e.textContent = NOME()); document.title = NOME(); }

// ---------- voz: escuta contínua com a palavra "Nexus" ----------
const ear = $('ear');
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const WAKE = /(?:^|\s)(nexus|nexos|nexo|néxus|nexis|next us|nécus|necsus|nexu)\b[\s,.!:]*(.*)$/i;
let rec = null, want = localStorage.getItem('nexus_mudo') !== '1', armed = 0, heardT = null, speaking = false;
function earSet(s, t) { ear.dataset.s = s; $('earT').textContent = t; ear.setAttribute('aria-label', 'Escuta: ' + t + '. Toque para ' + (s === 'on' || s === 'call' ? 'pausar' : 'ativar')); }
function showHeard(t, strong) { const h = $('heard'); $('heardT').innerHTML = strong ? '<b>' + esc(t) + '</b>' : esc(t); h.classList.add('on'); clearTimeout(heardT); heardT = setTimeout(() => h.classList.remove('on'), 2600); }
function viaName() { return S.page ? VIEWS[S.page].t : 'voz'; }
function command(t) { const v = viaName(); setTimeout(() => send(t, v), 200); }
function handleSpeech(t) {
  t = t.trim(); if (!t || speaking) return; const m = t.match(WAKE);
  if (m) { const cmd = m[2].trim(); if (cmd) { armed = 0; showHeard(t, true); command(cmd); if (want) earSet('on', 'Ouvindo'); } else { armed = Date.now() + 7000; earSet('call', 'Pode falar'); showHeard('Nexus…', true); setTimeout(() => { if (armed && Date.now() > armed) { armed = 0; if (ear.dataset.s === 'call') earSet('on', 'Ouvindo'); } }, 7200); } return; }
  if (armed && Date.now() < armed) { armed = 0; showHeard(t, true); earSet('on', 'Ouvindo'); command(t); return; }
  showHeard(t, false);
}
function startRec() {
  if (!SR) { earSet('no', S.cfg?.vozServidor?.stt ? 'Toque para falar' : 'Voz indisponível'); $('micB').hidden = !S.cfg?.vozServidor?.stt; return; }
  if (rec || document.hidden || !want) return;
  try {
    rec = new SR(); rec.lang = 'pt-BR'; rec.continuous = true; rec.interimResults = true;
    rec.onstart = () => earSet('on', 'Ouvindo');
    rec.onresult = e => { let fin = '', mid = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) fin += r[0].transcript; else mid += r[0].transcript; } if (mid && !speaking) showHeard(mid, false); if (fin) handleSpeech(fin); };
    rec.onerror = e => { if (/not-allowed|service-not-allowed|audio-capture/.test(e.error)) { want = false; earSet('no', 'Microfone bloqueado'); } };
    rec.onend = () => { rec = null; if (want && !document.hidden) setTimeout(startRec, 350); else if (ear.dataset.s !== 'no') earSet('off', document.hidden ? 'Pausado' : 'Mudo'); };
    rec.start();
  } catch { rec = null; earSet('no', 'Toque para ouvir'); }
}
function stopRec() { if (rec) { try { rec.abort(); } catch { } rec = null; } }
document.addEventListener('visibilitychange', () => { if (document.hidden) { stopRec(); speechSynthesis?.cancel(); audio?.pause(); if (ear.dataset.s !== 'no') earSet('off', 'Pausado'); } else if (want) startRec(); });
addEventListener('pagehide', stopRec);
ear.onclick = () => {
  const s = ear.dataset.s;
  if (s === 'on' || s === 'call') { want = false; localStorage.setItem('nexus_mudo', '1'); stopRec(); earSet('off', 'Mudo'); toast('Escuta pausada. Toque de novo para voltar a ouvir.'); return; }
  want = true; localStorage.removeItem('nexus_mudo');
  if (SR) { earSet('off', 'Ligando…'); startRec(); setTimeout(() => { if (ear.dataset.s === 'no') toast('Libere o microfone para este site nas permissões do navegador.', 5000); }, 800); }
  else if (S.cfg?.vozServidor?.stt) $('micB').click();
  else toast('Este navegador não reconhece voz. Use o Chrome no Android.', 5000);
};
// gravar e mandar para o Whisper do servidor (quando o navegador não reconhece voz)
let recMedia = null;
$('micB').onclick = async () => {
  if (recMedia) { recMedia.stop(); return; }
  try {
    const st = await navigator.mediaDevices.getUserMedia({ audio: true }); const chunks = [];
    recMedia = new MediaRecorder(st); recMedia.ondataavailable = e => chunks.push(e.data);
    recMedia.onstop = async () => { st.getTracks().forEach(t => t.stop()); recMedia = null; $('micB').classList.remove('on'); earSet('off', 'Transcrevendo…');
      try { const r = await fetch('/api/stt', { method: 'POST', body: new Blob(chunks) }); const j = await r.json(); earSet('no', 'Toque para falar'); if (j.text) { showHeard(j.text, true); send(j.text.replace(/^\s*nexus[,!.\s]*/i, ''), viaName()); } } catch { earSet('no', 'Toque para falar'); } };
    recMedia.start(); $('micB').classList.add('on'); earSet('call', 'Gravando… toque para enviar');
  } catch { toast('Sem acesso ao microfone.'); }
};

// fala as respostas (voz do servidor ou do celular)
let audio = null;
async function speak(text, force) {
  if (!force && !S.cfg?.voz) return; text = String(text || '').trim(); if (!text) return;
  speaking = true; const done = () => { speaking = false; };
  try {
    if (S.cfg?.vozServidor?.tts) {
      const r = await fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
      if (!r.ok) throw 0; audio?.pause(); audio = new Audio(URL.createObjectURL(await r.blob())); audio.onended = done; audio.onerror = done; await audio.play(); return;
    }
    throw 0;
  } catch {
    if (!window.speechSynthesis) return done();
    const u = new SpeechSynthesisUtterance(text.replace(/```[\s\S]*?```/g, ' código na tela ').replace(/[*_#`>]/g, '').slice(0, 900)); u.lang = 'pt-BR';
    const v = speechSynthesis.getVoices().filter(v => v.lang.startsWith('pt')); u.voice = v.find(v => /male|masculin|daniel|antonio|ricardo/i.test(v.name)) || v[0] || null;
    u.onend = done; u.onerror = done; speechSynthesis.cancel(); speechSynthesis.speak(u);
  }
}
const speakShort = t => { if (S.cfg?.voz && document.visibilityState === 'visible') speak(t); };

// ---------- início ----------
async function boot() {
  try { S.cfg = await api('/api/settings'); } catch { return; }
  applyName(); renderSide(); connectEvents(); loadProjects();
  await loadConv(S.convId);
  earSet('off', 'Ligando…'); if (want) setTimeout(startRec, 400); else earSet('off', 'Mudo');
  if (!SR && S.cfg.vozServidor?.stt) $('micB').hidden = false;
  setSendMode();
}
(async () => {
  const st = await api('/api/state', { noGate: true }).catch(() => null);
  if (!st) { document.body.innerHTML = '<div class="gate"><p>Não consegui falar com o servidor do Nexus. Ele está ligado?</p></div>'; return; }
  if (!st.authed) showGate(); else boot();
})();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { });
