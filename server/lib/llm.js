// Cliente único para qualquer API compatível com OpenAI (llama-server local, Groq, Gemini, OpenRouter, Mistral)
import { CFG } from './config.js';
import { settings, secretGet } from './db.js';

export const PROVIDERS = {
  groq: { name: 'Groq', url: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys' },
  gemini: { name: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai', keyUrl: 'https://aistudio.google.com/apikey' },
  openrouter: { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys' },
  mistral: { name: 'Mistral', url: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys' },
};

export function localTarget() { return { id: 'local', name: 'IA local', url: CFG.llmUrl, key: '', model: CFG.llmModel, local: true }; }
export function remoteTargets() {
  const s = settings(), out = [];
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const conf = s.provedores[id] || {}, key = secretGet('key:' + id);
    if (conf.on && key && conf.model) out.push({ id, name: p.name, url: p.url, key, model: conf.model });
  }
  return out;
}

// limite de cada provedor: quando bate o limite, fica de molho por um tempo
const cooldown = new Map();
export const coolingDown = id => (cooldown.get(id) || 0) > Date.now();
export const coolDown = (id, ms) => cooldown.set(id, Date.now() + ms);

// Remove o "pensamento" do Qwen3 do texto visível
export function stripThink(t) { return t.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/^\s+/, ''); }

/**
 * Faz uma chamada em streaming. onDelta(texto) recebe pedaços de resposta.
 * Retorna { text, toolCalls, finish }.
 */
export async function chat(target, { messages, tools, temperature = 0.6, maxTokens = 2048, signal, onDelta }) {
  const body = { model: target.model, messages, stream: true, temperature, max_tokens: maxTokens };
  if (tools && tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
  const res = await fetch(target.url.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', ...(target.key ? { authorization: 'Bearer ' + target.key } : {}),
      ...(target.id === 'openrouter' ? { 'x-title': 'NEXUS' } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = new Error(`${target.name}: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
    err.status = res.status; throw err;
  }
  let text = '', raw = '', finish = null, inThink = false;
  const calls = [];
  const dec = new TextDecoder(); let buf = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim(); if (data === '[DONE]') continue;
      let j; try { j = JSON.parse(data); } catch { continue; }
      const ch = j.choices && j.choices[0]; if (!ch) continue;
      if (ch.finish_reason) finish = ch.finish_reason;
      const d = ch.delta || {};
      if (d.content) {
        raw += d.content;
        // esconde <think>…</think> enquanto chega
        let piece = d.content, vis = '';
        while (piece) {
          if (inThink) { const e = piece.indexOf('</think>'); if (e < 0) { piece = ''; } else { inThink = false; piece = piece.slice(e + 8); } }
          else { const s = piece.indexOf('<think>'); if (s < 0) { vis += piece; piece = ''; } else { vis += piece.slice(0, s); inThink = true; piece = piece.slice(s + 7); } }
        }
        if (vis) { if (!text) vis = vis.replace(/^\s+/, ''); if (vis) { text += vis; onDelta && onDelta(vis); } }
      }
      for (const tc of d.tool_calls || []) {
        const k = tc.index ?? calls.length;
        calls[k] = calls[k] || { id: tc.id || 'call_' + k, type: 'function', function: { name: '', arguments: '' } };
        if (tc.id) calls[k].id = tc.id;
        if (tc.function?.name) calls[k].function.name += tc.function.name;
        if (tc.function?.arguments) calls[k].function.arguments += tc.function.arguments;
      }
    }
  }
  return { text: text.trim(), raw, toolCalls: calls.filter(Boolean), finish };
}

// Chamada simples, sem streaming de tela (para tarefas internas: títulos, memória)
export async function quick(messages, { maxTokens = 400, temperature = 0.2, target } = {}) {
  const t = target || localTarget();
  const m = settings().pensar ? messages : withNoThink(messages);
  const r = await chat(t, { messages: m, maxTokens, temperature });
  return stripThink(r.text);
}
export function withNoThink(messages) {
  // Qwen3: "/no_think" desliga o raciocínio longo, deixando a CPU livre
  const m = messages.slice(); const last = m.length - 1;
  if (last >= 0 && m[last].role === 'user' && typeof m[last].content === 'string' && !m[last].content.includes('/no_think'))
    m[last] = { ...m[last], content: m[last].content + ' /no_think' };
  return m;
}

export async function embed(texts) {
  const res = await fetch(CFG.embedUrl.replace(/\/$/, '') + '/embeddings', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: texts, model: 'embed' }),
  });
  if (!res.ok) throw new Error('embeddings HTTP ' + res.status);
  const j = await res.json();
  return j.data.map(d => Float32Array.from(d.embedding));
}

export async function health() {
  const ping = async u => { try { const r = await fetch(u.replace(/\/v1\/?$/, '') + '/health', { signal: AbortSignal.timeout(2500) }); return r.ok; } catch { return false; } };
  return { llm: await ping(CFG.llmUrl), embed: await ping(CFG.embedUrl) };
}
