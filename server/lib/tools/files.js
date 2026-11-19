// Arquivos dos projetos: tudo fica preso dentro da pasta ~/projetos
import fs from 'node:fs';
import path from 'node:path';
import { CFG } from '../config.js';
import { emit } from '../bus.js';

const SKIP = new Set(['node_modules', '.git', '.expo', '.gradle', 'build', 'dist', '.cache', '.nexus-build', 'android', 'ios']);

export function safe(rel = '') {
  const p = path.resolve(CFG.projectsDir, String(rel).replace(/^\/+/, ''));
  if (p !== CFG.projectsDir && !p.startsWith(CFG.projectsDir + path.sep)) throw Object.assign(new Error('Caminho fora da pasta de projetos'), { status: 400 });
  return p;
}
export const relOf = abs => path.relative(CFG.projectsDir, abs).split(path.sep).join('/');

export function tree(rel = '', depth = 4) {
  const base = safe(rel);
  const walk = (dir, d) => {
    let items = [];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
    return items.filter(e => !e.name.startsWith('.nexus') && e.name !== '.DS_Store')
      .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name))
      .map(e => {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) return { name: e.name, path: relOf(abs), dir: true, skipped: SKIP.has(e.name) || undefined, children: SKIP.has(e.name) || d <= 0 ? [] : walk(abs, d - 1) };
        let size = 0; try { size = fs.statSync(abs).size; } catch { }
        return { name: e.name, path: relOf(abs), size };
      });
  };
  return walk(base, depth);
}
export function read(rel) {
  const p = safe(rel), st = fs.statSync(p);
  if (st.size > 1.5e6) throw Object.assign(new Error('Arquivo grande demais para abrir aqui'), { status: 413 });
  const buf = fs.readFileSync(p);
  if (buf.includes(0)) throw Object.assign(new Error('Arquivo binário'), { status: 415 });
  return buf.toString('utf8');
}
export function write(rel, content) {
  const p = safe(rel); fs.mkdirSync(path.dirname(p), { recursive: true });
  const existed = fs.existsSync(p);
  fs.writeFileSync(p, content ?? '');
  emit('file', { path: relOf(p), action: existed ? 'edit' : 'new' });
  return { path: relOf(p), bytes: Buffer.byteLength(content ?? ''), existed };
}
export function remove(rel) {
  const p = safe(rel); if (p === CFG.projectsDir) throw new Error('Não posso apagar a pasta raiz');
  fs.rmSync(p, { recursive: true, force: true }); emit('file', { path: relOf(p), action: 'delete' });
}
export function rename(from, to) { const a = safe(from), b = safe(to); fs.mkdirSync(path.dirname(b), { recursive: true }); fs.renameSync(a, b); emit('file', { path: relOf(b), action: 'rename' }); }
export function mkdir(rel) { fs.mkdirSync(safe(rel), { recursive: true }); emit('file', { path: rel, action: 'new' }); }
