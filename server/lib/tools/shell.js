// Execução de comandos: terminal do usuário e comandos da IA (com aprovação)
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { CFG } from '../config.js';
import { emit } from '../bus.js';
import { uid, settings } from '../db.js';

// esconde tokens que possam aparecer na saída
const SECRETS = new Set();
export const hideSecret = s => { if (s && s.length > 8) SECRETS.add(s); };
export function scrub(t) { for (const s of SECRETS) t = t.split(s).join('••••'); return t; }

export function term(text, cls = '', src = 'ia') { emit('term', { text: scrub(String(text)), cls, src }); }

export function run(cmd, { cwd = CFG.projectsDir, signal, onLine, timeout = 30 * 60e3, env = {}, echo = true, src = 'ia' } = {}) {
  return new Promise(resolve => {
    if (echo) term(cmd, 'cmd', src);
    const p = spawn('bash', ['-lc', cmd], { cwd, env: { ...process.env, CI: '1', FORCE_COLOR: '0', ...env }, detached: true });
    let out = '', killed = false;
    const kill = () => { if (killed) return; killed = true; try { process.kill(-p.pid, 'SIGTERM'); setTimeout(() => { try { process.kill(-p.pid, 'SIGKILL'); } catch { } }, 3000); } catch { } };
    const tm = setTimeout(() => { term('Tempo esgotado; comando encerrado.', 'w', src); kill(); }, timeout);
    signal?.addEventListener('abort', kill, { once: true });
    let part = { o: '', e: '' };
    const feed = (k, d) => {
      part[k] += d.toString('utf8');
      const lines = part[k].split(/\r?\n/); part[k] = lines.pop();
      for (let l of lines) { l = l.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, ''); if (!l.trim()) continue; onLine?.(l, k); if (l.startsWith('__NEXUS_PWD__')) continue; out += l + '\n'; if (out.length > 60000) out = out.slice(-40000); term(l, k === 'e' ? 'e' : 'o', src); }
    };
    p.stdout.on('data', d => feed('o', d)); p.stderr.on('data', d => feed('e', d));
    p.on('close', code => {
      clearTimeout(tm);
      for (const k of ['o', 'e']) if (part[k].trim()) { out += part[k]; term(part[k], k === 'e' ? 'e' : 'o', src); }
      if (code === 0) term('✔ concluído', 'ok', src); else term(killed ? '■ interrompido' : `✖ saiu com código ${code}`, 'e', src);
      resolve({ code: killed ? -1 : code, out: scrub(out) });
    });
  });
}

// ---------- terminal do usuário (mantém a pasta atual entre comandos) ----------
let userCwd = CFG.projectsDir, userProc = null;
export function userCwdGet() { return userCwd; }
export async function userRun(cmd) {
  if (userProc) return { busy: true };
  const ctrl = new AbortController(); userProc = ctrl;
  const marker = '__NEXUS_PWD__';
  const r = await run(`cd ${JSON.stringify(userCwd)} 2>/dev/null; ${cmd}\n__s=$?; printf '\\n${marker}%s\\n' "$PWD"; exit $__s`, {
    cwd: fs.existsSync(userCwd) ? userCwd : CFG.projectsDir, signal: ctrl.signal, src: 'voce', echo: false,
    onLine: l => { if (l.startsWith(marker)) userCwd = l.slice(marker.length) || userCwd; },
  });
  userProc = null; emit('cwd', { cwd: userCwd });
  return { code: r.code, cwd: userCwd };
}
export function userStop() { if (userProc) { userProc.abort(); return true; } return false; }

// ---------- aprovação de comandos da IA ----------
const READ_ONLY = /^\s*(ls|ll|pwd|cat|head|tail|wc|du|df|tree|which|whoami|date|uname|free|uptime|echo|stat|file|node\s+-v|npm\s+(-v|ls|view|outdated)|git\s+(status|log|diff|branch|remote\s+-v|show))\b/;
const DANGER = /[;&|`$>]|\brm\b|\bsudo\b|\bmv\b|\bchmod\b|\bchown\b|\bdd\b|\bmkfs\b|\bcurl\b.*\|\s*(ba)?sh/;
export function isReadOnly(cmd) {
  if (!READ_ONLY.test(cmd)) return false;
  if (/^\s*find\b/.test(cmd) && /-(exec|delete|ok)\b/.test(cmd)) return false;
  return !DANGER.test(cmd.replace(/2>\/dev\/null/g, '').replace(/\|\s*(head|tail|wc|grep|sort)\b[^|]*/g, ''));
}
const pending = new Map();
export function askApproval({ cmd, cwd, why = '', signal }) {
  if (!settings().aprovacao || isReadOnly(cmd)) return Promise.resolve({ ok: true, cmd });
  return new Promise(resolve => {
    const id = uid();
    const rel = path.relative(CFG.projectsDir, cwd) || '.';
    pending.set(id, { id, cmd, cwd: rel, why, resolve, at: Date.now() });
    emit('approval', { id, cmd, cwd: rel, why, state: 'wait' });
    signal?.addEventListener('abort', () => answerApproval(id, 'no'), { once: true });
  });
}
export function answerApproval(id, action, cmd) {
  const p = pending.get(id); if (!p) return false;
  pending.delete(id);
  const ok = action === 'ok', finalCmd = ok && cmd ? cmd : p.cmd;
  emit('approval', { id, cmd: finalCmd, cwd: p.cwd, state: ok ? 'ok' : 'no' });
  p.resolve({ ok, cmd: finalCmd });
  return true;
}
export const pendingApprovals = () => [...pending.values()].map(({ resolve, ...r }) => ({ ...r, state: 'wait' }));
