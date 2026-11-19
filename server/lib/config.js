// Configuração lida do arquivo .env (sem dependências externas)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv(path.join(ROOT, '.env'));

const env = (k, d) => (process.env[k] ?? '') !== '' ? process.env[k] : d;

export const CFG = {
  port: +env('NEXUS_PORT', 3000),
  host: env('NEXUS_HOST', '127.0.0.1'),
  dataDir: path.resolve(ROOT, env('NEXUS_DATA', 'dados')),
  projectsDir: path.resolve(env('NEXUS_PROJECTS', path.join(process.env.HOME || ROOT, 'projetos'))),
  secret: env('NEXUS_SECRET', ''),
  // IA local (llama-server)
  llmUrl: env('LLM_URL', 'http://127.0.0.1:8080/v1'),
  llmModel: env('LLM_MODEL', 'qwen3-4b'),
  embedUrl: env('EMBED_URL', 'http://127.0.0.1:8081/v1'),
  // voz
  piperBin: env('PIPER_BIN', path.join(ROOT, 'voz', 'piper', 'piper')),
  piperVoice: env('PIPER_VOICE', path.join(ROOT, 'voz', 'pt_BR-faber-medium.onnx')),
  whisperBin: env('WHISPER_BIN', path.join(ROOT, 'voz', 'whisper.cpp', 'build', 'bin', 'whisper-cli')),
  whisperModel: env('WHISPER_MODEL', path.join(ROOT, 'voz', 'whisper.cpp', 'models', 'ggml-base.bin')),
  // build Android no servidor
  androidHome: env('ANDROID_HOME', path.join(process.env.HOME || ROOT, 'android-sdk')),
  aapt2: env('AAPT2_ARM64', ''),
  keystore: env('NEXUS_KEYSTORE', ''),
  keystorePass: env('NEXUS_KEYSTORE_PASS', ''),
  // endereço público (para links de prévia e download)
  publicUrl: env('NEXUS_PUBLIC_URL', ''),
  dev: env('NEXUS_DEV', '') === '1',
};

fs.mkdirSync(CFG.dataDir, { recursive: true });
fs.mkdirSync(CFG.projectsDir, { recursive: true });
fs.mkdirSync(path.join(CFG.dataDir, 'apks'), { recursive: true });
