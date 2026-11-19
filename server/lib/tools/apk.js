// Build do APK: no próprio servidor (ARM) ou pelo GitHub Actions
import fs from 'node:fs';
import path from 'node:path';
import { CFG } from '../config.js';
import { settings } from '../db.js';
import { Job } from '../jobs.js';
import { emit } from '../bus.js';
import { run } from './shell.js';
import { safe } from './files.js';
import { detectKind, meta, setMeta, slugify } from './projects.js';
import { buildOnGithub, creds } from './github.js';

const JAVA = { expo: process.env.JAVA17_HOME || '/usr/lib/jvm/java-17-openjdk-arm64', cap: process.env.JAVA21_HOME || '/usr/lib/jvm/java-21-openjdk-arm64' };

function buildToolsDir() {
  const d = path.join(CFG.androidHome, 'build-tools');
  try { const v = fs.readdirSync(d).sort().reverse(); return v.length ? path.join(d, v[0]) : null; } catch { return null; }
}
function aapt2() { if (CFG.aapt2 && fs.existsSync(CFG.aapt2)) return CFG.aapt2; const bt = buildToolsDir(); const p = bt && path.join(bt, 'aapt2'); return p && fs.existsSync(p) ? p : null; }

export function serverReady() {
  const sdk = fs.existsSync(path.join(CFG.androidHome, 'platforms'));
  return { sdk, aapt2: !!aapt2(), ok: sdk && !!aapt2(), androidHome: CFG.androidHome };
}

/** Projetos web (site, jogos, vite) viram app com o Capacitor */
function prepareCapacitor(dir, slug, title, kind) {
  const pkgPath = path.join(dir, 'package.json');
  let pkg = {}; try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch { pkg = { name: slug, version: '1.0.0', private: true }; }
  pkg.dependencies = { ...(pkg.dependencies || {}), '@capacitor/core': pkg.dependencies?.['@capacitor/core'] || 'latest', '@capacitor/android': pkg.dependencies?.['@capacitor/android'] || 'latest' };
  pkg.devDependencies = { ...(pkg.devDependencies || {}), '@capacitor/cli': pkg.devDependencies?.['@capacitor/cli'] || 'latest' };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  const webDir = kind === 'vite-react' ? 'dist' : (fs.existsSync(path.join(dir, 'www')) ? 'www' : '.');
  const capPath = path.join(dir, 'capacitor.config.json');
  if (!fs.existsSync(capPath)) fs.writeFileSync(capPath, JSON.stringify({ appId: 'com.nexus.' + slug.replace(/[^a-z0-9]/g, ''), appName: title, webDir }, null, 2));
}

function bumpVersion(v) { const p = String(v || '1.0.0').split('.').map(n => +n || 0); while (p.length < 3) p.push(0); p[2]++; return p.join('.'); }

function findSigner() {
  const d = path.join(CFG.androidHome, 'build-tools');
  try { for (const v of fs.readdirSync(d).sort().reverse()) { const p = path.join(d, v, 'apksigner'); if (fs.existsSync(p)) return p; } } catch { }
  return null;
}
async function resign(apkIn, apkOut, job) {
  const signer = findSigner();
  if (!CFG.keystore || !fs.existsSync(CFG.keystore) || !signer || !fs.existsSync(signer)) { fs.copyFileSync(apkIn, apkOut); return false; }
  job.step('Assinando', 'apksigner', 'chave: ' + path.basename(CFG.keystore));
  const r = await run(`${JSON.stringify(signer)} sign --ks ${JSON.stringify(CFG.keystore)} --ks-pass env:KSPASS --out ${JSON.stringify(apkOut)} ${JSON.stringify(apkIn)}`,
    { env: { KSPASS: CFG.keystorePass }, onLine: l => job.line(l) });
  if (r.code !== 0) { job.line('Não consegui assinar com a chave do servidor; mantive a assinatura do build.', 'w'); fs.copyFileSync(apkIn, apkOut); return false; }
  return true;
}

async function buildOnServer({ slug, dir, kind, job, signal }) {
  const ready = serverReady();
  if (!ready.ok) throw new Error('O build no servidor ainda não está instalado (Android SDK/aapt2 ARM). Rode "bash install.sh android" ou use o GitHub Actions.');
  const ndk = process.env.ANDROID_NDK_HOME && fs.existsSync(process.env.ANDROID_NDK_HOME);
  if (kind === 'expo' && !ndk) throw new Error('Apps Expo/React Native precisam do NDK do Android, que o Google não publica para servidores ARM. Gere este APK pelo GitHub Actions (Configurações → Build do APK). Sites e jogos funcionam no servidor.');
  const env = { ANDROID_HOME: CFG.androidHome, ANDROID_SDK_ROOT: CFG.androidHome, JAVA_HOME: kind === 'expo' ? JAVA.expo : JAVA.cap, GRADLE_OPTS: '-Dorg.gradle.jvmargs=-Xmx3g' };
  const ov = `-Pandroid.aapt2FromMavenOverride=${aapt2()}`;
  const sh = (c, p) => { job.progress(p); return run(c, { cwd: dir, env, signal, onLine: l => job.line(l) }); };
  const must = async (c, p, msg) => { const r = await sh(c, p); if (r.code !== 0) throw new Error(msg + '\n' + r.out.slice(-1500)); return r; };
  job.step('Baixando dependências', 'npm'); await must('npm install --no-audit --no-fund', 15, 'Falha ao instalar as dependências.');
  let apk;
  if (kind === 'expo') {
    job.step('Preparando o projeto Android', 'expo prebuild'); await must('npx expo prebuild --platform android --no-install', 30, 'Falha no prebuild.');
    job.step('Compilando o código', 'Gradle'); await must(`cd android && ./gradlew assembleRelease ${ov} --no-daemon`, 45, 'Falha na compilação (Gradle).');
    apk = path.join(dir, 'android/app/build/outputs/apk/release/app-release.apk');
  } else {
    if (kind === 'vite-react') { job.step('Gerando o site', 'Vite'); await must('npx vite build --base=./ --outDir dist', 25, 'Falha no build do Vite.'); }
    job.step('Preparando o projeto Android', 'Capacitor');
    if (!fs.existsSync(path.join(dir, 'android'))) await must('npx cap add android', 35, 'Falha ao criar o projeto Android.');
    await must('npx cap sync android', 40, 'Falha no cap sync.');
    job.step('Compilando o código', 'Gradle'); await must(`cd android && ./gradlew assembleDebug ${ov} --no-daemon`, 50, 'Falha na compilação (Gradle).');
    apk = path.join(dir, 'android/app/build/outputs/apk/debug/app-debug.apk');
  }
  if (!fs.existsSync(apk)) throw new Error('O Gradle terminou, mas não achei o APK.');
  return { apk };
}

/** Inicia o build como tarefa em segundo plano */
export function startBuild({ slug, method }) {
  const dir = safe(slug); if (!fs.existsSync(dir)) throw new Error('Projeto não encontrado: ' + slug);
  const m = meta(slug) || {}, kind = detectKind(slug), title = m.title || slug;
  method = method || settings().build || 'srv';
  let autoGh = false;
  if (method === 'srv' && kind === 'expo' && !(process.env.ANDROID_NDK_HOME && fs.existsSync(process.env.ANDROID_NDK_HOME))) { const c = creds(); if (c.repo && c.token) { method = 'gh'; autoGh = true; } }
  const version = m.lastApk ? bumpVersion(m.version) : (m.version || '1.0.0');
  const job = new Job('build', 'APK ' + title, { slug, method, kind, version, title });
  (async () => {
    const outDir = path.join(CFG.dataDir, 'apks'); let cleanup = null;
    try {
      job.step('Preparando o projeto', kind === 'expo' ? 'Expo' : 'Capacitor'); job.progress(3);
      if (autoGh) job.line('Apps Expo não compilam no servidor ARM (falta o NDK); usando o GitHub Actions.', 'w');
      const code = (m.builds || 0) + 1;
      if (kind !== 'expo') prepareCapacitor(dir, slug, title, kind);
      else { // versão e versionCode crescentes: permite atualizar o app já instalado
        const aj = path.join(dir, 'app.json');
        try { const a = JSON.parse(fs.readFileSync(aj, 'utf8')); a.expo.version = version; a.expo.android = { ...(a.expo.android || {}), versionCode: code, package: a.expo.android?.package || 'com.nexus.' + slug.replace(/[^a-z0-9]/g, '') }; fs.writeFileSync(aj, JSON.stringify(a, null, 2)); } catch { }
      }
      setMeta(slug, { builds: code });
      const r = method === 'gh' ? await buildOnGithub({ slug, dir, kind, job, signal: job.signal, outDir }) : await buildOnServer({ slug, dir, kind, job, signal: job.signal });
      cleanup = r.cleanup;
      const name = `${slugify(slug)}-${version}.apk`, final = path.join(outDir, name);
      await resign(r.apk, final, job);
      job.step('Verificando', 'APK'); job.progress(97);
      const size = fs.statSync(final).size;
      setMeta(slug, { version, lastApk: name });
      job.line(`✔ ${name} · ${(size / 1048576).toFixed(1).replace('.', ',')} MB`, 'ok');
      job.finish('done', { apk: name, size, url: '/api/apks/' + name });
      emit('apk', { slug, name, size });
    } catch (e) {
      if (job.cancelled) return;
      job.finish('error', { error: String(e.message || e) });
    } finally { if (cleanup) fs.rmSync(cleanup, { recursive: true, force: true }); }
  })();
  return job;
}

export function listApks() {
  const d = path.join(CFG.dataDir, 'apks');
  try { return fs.readdirSync(d).filter(f => f.endsWith('.apk')).map(f => ({ name: f, size: fs.statSync(path.join(d, f)).size, at: fs.statSync(path.join(d, f)).mtimeMs })).sort((a, b) => b.at - a.at); } catch { return []; }
}
