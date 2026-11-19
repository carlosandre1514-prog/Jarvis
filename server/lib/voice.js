// Voz: Piper (texto → fala, voz masculina pt-BR) e Whisper (fala → texto)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CFG } from './config.js';

export const voiceStatus = () => ({ tts: fs.existsSync(CFG.piperBin) && fs.existsSync(CFG.piperVoice), stt: fs.existsSync(CFG.whisperBin) && fs.existsSync(CFG.whisperModel) });

function exec(bin, args, input) {
  return new Promise((ok, no) => {
    const p = spawn(bin, args); let err = '', out = '';
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('error', no); p.on('close', c => c === 0 ? ok(out) : no(new Error(err.slice(-400) || 'falhou')));
    if (input != null) { p.stdin.end(input); }
  });
}

// limpa markdown e código antes de falar
export function speakable(t) {
  return String(t).replace(/```[\s\S]*?```/g, ' (código na tela) ').replace(/`([^`]+)`/g, '$1').replace(/[*_#>|]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, 'o link').replace(/\s+/g, ' ').trim().slice(0, 1200);
}

export async function tts(text) {
  if (!voiceStatus().tts) throw Object.assign(new Error('Voz do servidor não instalada'), { status: 501 });
  const out = path.join(os.tmpdir(), `nexus-tts-${process.pid}-${Date.now()}.wav`);
  await exec(CFG.piperBin, ['--model', CFG.piperVoice, '--output_file', out, '--length_scale', '0.95'], speakable(text));
  const buf = fs.readFileSync(out); fs.rmSync(out, { force: true }); return buf;
}

export async function stt(audio) {
  if (!voiceStatus().stt) throw Object.assign(new Error('Reconhecimento de voz do servidor não instalado'), { status: 501 });
  const base = path.join(os.tmpdir(), `nexus-stt-${process.pid}-${Date.now()}`);
  fs.writeFileSync(base + '.in', audio);
  try {
    await exec('ffmpeg', ['-y', '-loglevel', 'error', '-i', base + '.in', '-ar', '16000', '-ac', '1', base + '.wav']);
    const out = await exec(CFG.whisperBin, ['-m', CFG.whisperModel, '-f', base + '.wav', '-l', 'pt', '-nt', '-np', '-t', String(Math.max(1, os.cpus().length - 1))]);
    return out.replace(/\[.*?\]/g, '').replace(/\s+/g, ' ').trim();
  } finally { for (const e of ['.in', '.wav']) fs.rmSync(base + e, { force: true }); }
}
