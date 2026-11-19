// Memória de longo prazo: fatos sobre o usuário com busca por significado (embeddings)
import { db, now } from './db.js';
import { embed, quick } from './llm.js';

const toBlob = v => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
const fromBlob = b => b ? new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) : null;
function cos(a, b) { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / (Math.sqrt(x * y) || 1); }

export const Memory = {
  list: () => db.prepare('SELECT id,text,source,created,updated FROM memories ORDER BY updated DESC').all(),
  async add(text, source = 'manual') {
    text = String(text).trim().slice(0, 500); if (!text) return null;
    let e = null; try { [e] = await embed([text]); } catch { }
    // evita duplicata quase idêntica
    if (e) { const dup = this._near(e, 0.93)[0]; if (dup) { db.prepare('UPDATE memories SET text=?,emb=?,updated=? WHERE id=?').run(text, toBlob(e), now(), dup.id); return dup.id; } }
    const r = db.prepare('INSERT INTO memories(text,emb,source,created,updated) VALUES(?,?,?,?,?)').run(text, e ? toBlob(e) : null, source, now(), now());
    return Number(r.lastInsertRowid);
  },
  async edit(id, text) {
    let e = null; try { [e] = await embed([text]); } catch { }
    db.prepare('UPDATE memories SET text=?,emb=?,updated=? WHERE id=?').run(text, e ? toBlob(e) : null, now(), id);
  },
  remove: id => db.prepare('DELETE FROM memories WHERE id=?').run(id),
  _near(vec, min) {
    return db.prepare('SELECT id,text,emb FROM memories WHERE emb IS NOT NULL').all()
      .map(r => ({ id: r.id, text: r.text, score: cos(vec, fromBlob(r.emb)) }))
      .filter(r => r.score >= min).sort((a, b) => b.score - a.score);
  },
  // busca os fatos mais ligados à pergunta
  async recall(query, k = 6, min = 0.45) {
    try { const [q] = await embed([query]); return this._near(q, min).slice(0, k); }
    catch { // sem embeddings: busca por palavra
      const words = query.toLowerCase().split(/\W+/).filter(w => w.length > 3);
      if (!words.length) return [];
      return this.list().filter(m => words.some(w => m.text.toLowerCase().includes(w))).slice(0, k).map(m => ({ ...m, score: 0.5 }));
    }
  },
  // depois de cada conversa, a IA local separa fatos duradouros sobre o usuário
  async extract(userText, aiText) {
    if (userText.length < 12) return [];
    const prompt = `Leia a mensagem do usuário e liste apenas FATOS DURADOUROS sobre ele (nome, trabalho, preferências, projetos, pessoas próximas, aparelhos).
Ignore pedidos passageiros, perguntas e o que a IA disse. Responda SOMENTE um JSON: {"fatos":["..."]} (lista vazia se não houver).

Mensagem do usuário: """${userText.slice(0, 2000)}"""`;
    try {
      const out = await quick([{ role: 'user', content: prompt }], { maxTokens: 300 });
      const m = out.match(/\{[\s\S]*\}/); if (!m) return [];
      const fatos = (JSON.parse(m[0]).fatos || []).filter(f => typeof f === 'string' && f.length > 5).slice(0, 5);
      for (const f of fatos) await this.add(f, 'auto');
      return fatos;
    } catch { return []; }
  },
};
