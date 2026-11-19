// Banco de dados SQLite (módulo nativo node:sqlite, sem instalar nada)
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import crypto from 'node:crypto';
import { CFG } from './config.js';

export const db = new DatabaseSync(path.join(CFG.dataDir, 'ia.db'));
db.exec(`
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Nova conversa',
  created INTEGER NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, conv_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL, content TEXT NOT NULL, meta TEXT, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conv_id, id);
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, emb BLOB, source TEXT,
  created INTEGER NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, state TEXT NOT NULL,
  data TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL);
`);

export const now = () => Date.now();
export const uid = () => crypto.randomBytes(9).toString('base64url');

// ---------- chave/valor ----------
export function kvGet(k, d = null) { const r = db.prepare('SELECT v FROM kv WHERE k=?').get(k); return r ? JSON.parse(r.v) : d; }
export function kvSet(k, v) { db.prepare('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, JSON.stringify(v)); }

// ---------- segredos (tokens e chaves de API) criptografados ----------
const KEY = crypto.createHash('sha256').update(CFG.secret || 'nexus-dev-secret').digest();
export function seal(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
export function open(blob) {
  if (!blob) return '';
  try {
    const b = Buffer.from(blob, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch { return ''; }
}
export const secretGet = k => open(kvGet('secret:' + k, ''));
export const secretSet = (k, v) => kvSet('secret:' + k, v ? seal(v) : '');
export const secretHas = k => !!kvGet('secret:' + k, '');

// ---------- configurações do usuário ----------
export const DEFAULT_SETTINGS = {
  nome: 'N.E.X.U.S.', usuario: 'Carlos',
  personalidade: 'Educada, um pouco formal, com humor seco. Responde em português do Brasil, de forma direta.',
  voz: true, aprovacao: true, reforco: true, pensar: false, temperatura: 0.6,
  build: 'srv', repo: '',
  provedores: {
    groq: { on: true, model: 'openai/gpt-oss-120b' },
    gemini: { on: true, model: 'gemini-2.5-flash' },
    openrouter: { on: true, model: 'meta-llama/llama-3.3-70b-instruct:free' },
    mistral: { on: true, model: 'mistral-small-latest' },
  },
};
export function settings() {
  const s = kvGet('settings', {});
  return { ...DEFAULT_SETTINGS, ...s, provedores: { ...DEFAULT_SETTINGS.provedores, ...(s.provedores || {}) } };
}
export function saveSettings(patch) { const s = { ...settings(), ...patch }; kvSet('settings', s); return s; }

// ---------- conversas ----------
export const Conv = {
  list: () => db.prepare('SELECT id,title,updated FROM conversations ORDER BY updated DESC LIMIT 200').all(),
  create(title = 'Nova conversa') { const id = uid(), t = now(); db.prepare('INSERT INTO conversations VALUES(?,?,?,?)').run(id, title, t, t); return { id, title, updated: t }; },
  get: id => db.prepare('SELECT * FROM conversations WHERE id=?').get(id),
  rename: (id, title) => db.prepare('UPDATE conversations SET title=? WHERE id=?').run(title.slice(0, 80), id),
  remove: id => db.prepare('DELETE FROM conversations WHERE id=?').run(id),
  touch: id => db.prepare('UPDATE conversations SET updated=? WHERE id=?').run(now(), id),
  messages: (id, limit = 200) => db.prepare('SELECT id,role,content,meta,created FROM (SELECT * FROM messages WHERE conv_id=? ORDER BY id DESC LIMIT ?) ORDER BY id').all(id, limit)
    .map(m => ({ ...m, meta: m.meta ? JSON.parse(m.meta) : null })),
  add(convId, role, content, meta = null) {
    const r = db.prepare('INSERT INTO messages(conv_id,role,content,meta,created) VALUES(?,?,?,?,?)').run(convId, role, content, meta ? JSON.stringify(meta) : null, now());
    Conv.touch(convId); return Number(r.lastInsertRowid);
  },
  search: q => db.prepare(`SELECT DISTINCT c.id,c.title,c.updated FROM conversations c JOIN messages m ON m.conv_id=c.id
    WHERE m.content LIKE ? OR c.title LIKE ? ORDER BY c.updated DESC LIMIT 50`).all('%' + q + '%', '%' + q + '%'),
};
