// Uso do servidor: CPU, memória, disco, rede e serviços
import os from 'node:os';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { health } from './llm.js';

let prev = os.cpus().map(c => c.times);
function cpuPct() {
  const cur = os.cpus().map(c => c.times); let idle = 0, tot = 0;
  cur.forEach((t, i) => { const p = prev[i] || t; const d = k => t[k] - p[k]; const all = d('user') + d('nice') + d('sys') + d('idle') + d('irq'); idle += d('idle'); tot += all; });
  prev = cur; return tot ? Math.round(100 * (1 - idle / tot)) : 0;
}
const sh = (cmd, args) => new Promise(r => execFile(cmd, args, { timeout: 4000 }, (e, out) => r(e ? '' : out)));

let net = null;
function netRates() {
  try {
    const lines = fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2);
    let rx = 0, tx = 0; for (const l of lines) { const p = l.trim().split(/[:\s]+/); if (!p[0] || p[0] === 'lo') continue; rx += +p[1]; tx += +p[9]; }
    const t = Date.now(), r = net ? { down: (rx - net.rx) / ((t - net.t) / 1000), up: (tx - net.tx) / ((t - net.t) / 1000) } : { down: 0, up: 0 };
    net = { rx, tx, t }; return { ...r, rxTotal: rx, txTotal: tx };
  } catch { return { down: 0, up: 0 }; }
}

export async function stats() {
  const df = (await sh('df', ['-kP', os.homedir()])).trim().split('\n')[1]?.split(/\s+/) || [];
  const diskTot = +df[1] * 1024 || 0, diskUsed = +df[2] * 1024 || 0;
  const ps = await sh('ps', ['-eo', 'pid,pcpu,rss,args', '--sort=-pcpu']);
  const watch = [['llama-server', /llama-server(?!.*--embeddings)/, 'IA (llama-server)'], ['embed', /llama-server.*--embeddings/, 'memória (embeddings)'], ['node', /server\/index\.js/, 'API (Node.js)'], ['caddy', /caddy run/, 'HTTPS (Caddy)'], ['gradle', /GradleDaemon|gradlew/, 'build Android (Gradle)']];
  const procs = watch.map(([id, re, name]) => {
    const line = ps.split('\n').find(l => re.test(l));
    if (!line) return { id, name, on: false, cpu: 0, ram: 0 };
    const p = line.trim().split(/\s+/); return { id, name, on: true, cpu: +p[1], ram: +p[2] * 1024 };
  });
  return {
    cpu: cpuPct(), cores: os.cpus().length, load: os.loadavg()[0],
    ram: { total: os.totalmem(), used: os.totalmem() - os.freemem() },
    disk: { total: diskTot, used: diskUsed },
    uptime: os.uptime(), host: os.hostname(), arch: os.arch(), net: netRates(),
    procs, ia: await health(),
  };
}
