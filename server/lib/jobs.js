// Tarefas em segundo plano (criação de app, build do APK...). Continuam mesmo com a janela fechada.
import { db, uid, now } from './db.js';
import { emit } from './bus.js';

const live = new Map();

export class Job {
  constructor(kind, title, data = {}) {
    this.id = uid(); this.kind = kind; this.title = title; this.state = 'run';
    this.steps = []; this.pct = 0; this.data = data; this.log = [];
    this.created = now(); this.ctrl = new AbortController();
    live.set(this.id, this); this.save(true);
  }
  get signal() { return this.ctrl.signal; }
  get cancelled() { return this.ctrl.signal.aborted; }
  snapshot() { return { id: this.id, kind: this.kind, title: this.title, state: this.state, pct: this.pct, steps: this.steps, data: this.data, created: this.created, log: this.log.slice(-200) }; }
  save(force) {
    const t = now();
    if (!force && t - (this._saved || 0) < 700) { clearTimeout(this._tm); this._tm = setTimeout(() => this.save(true), 750); }
    else {
      this._saved = t;
      db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,data=excluded.data,updated=excluded.updated')
        .run(this.id, this.kind, this.title, this.state, JSON.stringify(this.snapshot()), this.created, t);
    }
    emit('job', this.snapshot());
  }
  step(t, k = '', detail = '') {
    const prev = this.steps[this.steps.length - 1]; if (prev && prev.state === 'run') prev.state = 'done';
    this.steps.push({ t, k, state: 'run', detail: String(detail || '').slice(0, 8000) }); this.save(); return this.steps.length - 1;
  }
  detail(text) { const s = this.steps[this.steps.length - 1]; if (s) { s.detail = (s.detail + '\n' + text).slice(-8000); this.save(); } }
  line(text, cls = '') { this.log.push({ text, cls }); if (this.log.length > 2000) this.log.splice(0, 500); emit('joblog', { id: this.id, text, cls }); }
  progress(p) { this.pct = Math.max(this.pct, Math.min(99, Math.round(p))); this.save(); }
  finish(state = 'done', data = {}) {
    if (this.state !== 'run') return;
    const s = this.steps[this.steps.length - 1]; if (s && s.state === 'run') s.state = state === 'done' ? 'done' : 'fail';
    this.state = state; if (state === 'done') this.pct = 100; Object.assign(this.data, data);
    this.save(true); live.delete(this.id);
  }
  cancel() { if (this.state !== 'run') return; this.ctrl.abort(); this.finish('stop'); }
}

export const Jobs = {
  get: id => live.get(id),
  running: () => [...live.values()],
  recent() {
    const rows = db.prepare('SELECT data FROM jobs ORDER BY updated DESC LIMIT 20').all().map(r => JSON.parse(r.data));
    return rows.map(r => live.get(r.id)?.snapshot() || r);
  },
  stopAll() { const r = [...live.values()]; r.forEach(j => j.cancel()); return r.length; },
};
// tarefas que estavam rodando quando o servidor caiu ficam como interrompidas
db.prepare(`UPDATE jobs SET state='stop' WHERE state='run'`).run();
