// Login por senha única; sessão em cookie HttpOnly
import crypto from 'node:crypto';
import { kvGet, kvSet } from './db.js';

const sessions = new Map(); // token -> expira
const DAYS = 60;

export function hasPassword() { return !!kvGet('auth:hash'); }
export function setPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64);
  kvSet('auth:hash', salt.toString('hex') + ':' + hash.toString('hex'));
  kvSet('auth:sessions', []); sessions.clear();
}
export function checkPassword(pw) {
  const v = kvGet('auth:hash'); if (!v) return false;
  const [s, h] = v.split(':');
  const calc = crypto.scryptSync(String(pw), Buffer.from(s, 'hex'), 64);
  return crypto.timingSafeEqual(calc, Buffer.from(h, 'hex'));
}
// sessões persistem entre reinícios
for (const [t, e] of kvGet('auth:sessions', [])) if (e > Date.now()) sessions.set(t, e);
function persist() { kvSet('auth:sessions', [...sessions].filter(([, e]) => e > Date.now())); }

export function newSession() {
  const t = crypto.randomBytes(32).toString('base64url');
  sessions.set(t, Date.now() + DAYS * 864e5); persist(); return t;
}
export function endSession(t) { sessions.delete(t); persist(); }
export function cookieToken(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)nexus=([^;]+)/); return m ? m[1] : null;
}
export function authed(req) {
  const t = cookieToken(req) || (req.headers.authorization || '').replace(/^Bearer\s+/, '');
  const e = t && sessions.get(t); return !!e && e > Date.now();
}
export function sessionCookie(t, secure) {
  return `nexus=${t}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${DAYS * 86400}${secure ? '; Secure' : ''}`;
}

// trava simples contra tentativa e erro
const fails = new Map();
export function throttled(ip) { const f = fails.get(ip); return f && f.n >= 5 && Date.now() - f.t < 10 * 60e3; }
export function failed(ip) { const f = fails.get(ip) || { n: 0, t: 0 }; f.n++; f.t = Date.now(); fails.set(ip, f); }
export function cleared(ip) { fails.delete(ip); }
