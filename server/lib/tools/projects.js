// Projetos: criar (app, jogo, site), listar e gerar a prévia
import fs from 'node:fs';
import path from 'node:path';
import { CFG } from '../config.js';
import { emit } from '../bus.js';
import { run, askApproval } from './shell.js';
import { safe } from './files.js';

export const KINDS = {
  expo: 'App Android (Expo / React Native)',
  site: 'Site (HTML, CSS e JS)',
  'vite-react': 'Site/app web (Vite + React)',
  phaser: 'Jogo 2D (Phaser)',
  three: 'Jogo 3D (Three.js)',
};

export const slugify = s => String(s || 'projeto').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'projeto';
const metaPath = slug => path.join(safe(slug), '.nexus.json');
export function meta(slug) { try { return JSON.parse(fs.readFileSync(metaPath(slug), 'utf8')); } catch { return null; } }
export function setMeta(slug, patch) { const m = { ...(meta(slug) || {}), ...patch }; fs.writeFileSync(metaPath(slug), JSON.stringify(m, null, 2)); return m; }

export function detectKind(slug) {
  const dir = safe(slug), m = meta(slug); if (m?.kind) return m.kind;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.expo) return 'expo'; if (deps.vite) return 'vite-react'; if (deps.phaser) return 'phaser'; if (deps.three) return 'three';
  } catch { }
  return fs.existsSync(path.join(dir, 'www')) || fs.existsSync(path.join(dir, 'index.html')) ? 'site' : 'site';
}

export function list() {
  let items = []; try { items = fs.readdirSync(CFG.projectsDir, { withFileTypes: true }); } catch { }
  return items.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => {
    const m = meta(e.name) || {}, st = fs.statSync(path.join(CFG.projectsDir, e.name));
    return { slug: e.name, title: m.title || e.name, kind: m.kind || detectKind(e.name), updated: st.mtimeMs, version: m.version || '1.0.0', previewUrl: m.previewUrl || null, lastApk: m.lastApk || null };
  }).sort((a, b) => b.updated - a.updated);
}

// ---------- modelos prontos (sem precisar de internet) ----------
const T = {
  site: t => ({
    'www/index.html': `<!DOCTYPE html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${t}</title>\n<link rel="stylesheet" href="style.css">\n</head>\n<body>\n<main>\n  <h1>${t}</h1>\n  <p>Seu site novo. Peça ao Nexus o que colocar aqui.</p>\n</main>\n<script src="script.js"></script>\n</body>\n</html>\n`,
    'www/style.css': `*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#0b0c10;color:#eef0f4}main{max-width:720px;margin:0 auto;padding:48px 20px}h1{font-size:32px;margin:0 0 8px}\n`,
    'www/script.js': `console.log('pronto');\n`,
  }),
  phaser: t => ({
    'www/index.html': `<!DOCTYPE html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">\n<title>${t}</title>\n<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}</style>\n<script src="https://cdn.jsdelivr.net/npm/phaser@3/dist/phaser.min.js"></script>\n</head>\n<body>\n<script src="game.js"></script>\n</body>\n</html>\n`,
    'www/game.js': `// ${t} — jogo 2D com Phaser\nclass Cena extends Phaser.Scene {\n  create() {\n    this.add.text(this.scale.width / 2, 80, '${t}', { fontSize: '32px', color: '#fff' }).setOrigin(0.5);\n    this.jogador = this.add.rectangle(this.scale.width / 2, this.scale.height / 2, 48, 48, 0x6ee7b7);\n    this.input.on('pointermove', p => { this.jogador.x = p.x; this.jogador.y = p.y; });\n  }\n}\nnew Phaser.Game({ type: Phaser.AUTO, backgroundColor: '#0b0c10', scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight }, scene: Cena });\n`,
  }),
  three: t => ({
    'www/index.html': `<!DOCTYPE html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">\n<title>${t}</title>\n<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}</style>\n<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170/build/three.module.js"}}</script>\n</head>\n<body>\n<script type="module" src="game.js"></script>\n</body>\n</html>\n`,
    'www/game.js': `// ${t} — jogo 3D com Three.js\nimport * as THREE from 'three';\nconst cena = new THREE.Scene();\nconst camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 100);\ncamera.position.z = 3;\nconst render = new THREE.WebGLRenderer({ antialias: true });\nrender.setSize(innerWidth, innerHeight); document.body.appendChild(render.domElement);\nconst cubo = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: 0x6ee7b7 }));\ncena.add(cubo, new THREE.AmbientLight(0xffffff, 0.4));\nconst luz = new THREE.DirectionalLight(0xffffff, 1.2); luz.position.set(2, 3, 4); cena.add(luz);\naddEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); render.setSize(innerWidth, innerHeight); });\nrender.setAnimationLoop(t => { cubo.rotation.x = t / 1500; cubo.rotation.y = t / 1000; render.render(cena, camera); });\n`,
  }),
};

/** Cria um projeto novo. Para Expo e Vite usa os criadores oficiais (precisa de internet no servidor). */
export async function create({ name, kind = 'site', job, signal }) {
  if (!KINDS[kind]) throw new Error('Tipo de projeto desconhecido: ' + kind);
  let slug = slugify(name), n = 2;
  while (fs.existsSync(path.join(CFG.projectsDir, slug))) slug = slugify(name) + '-' + n++;
  const dir = path.join(CFG.projectsDir, slug);
  if (T[kind]) {
    for (const [f, c] of Object.entries(T[kind](name))) { const p = path.join(dir, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); }
  } else {
    const cmd = kind === 'expo'
      ? `npx --yes create-expo-app@latest ${slug} --template blank --no-install && cd ${slug} && npm install && npx --yes expo install react-dom react-native-web @expo/metro-runtime`
      : `npm create --yes vite@latest ${slug} -- --template react && cd ${slug} && npm install`;
    const ok = await askApproval({ cmd, cwd: CFG.projectsDir, why: 'Criar o projeto ' + name, signal });
    if (!ok.ok) throw new Error('Criação recusada');
    const r = await run(ok.cmd, { cwd: CFG.projectsDir, signal, onLine: l => job?.line(l) });
    if (r.code !== 0) throw new Error('Falha ao criar o projeto:\n' + r.out.slice(-1500));
    if (kind === 'expo') { // nome e pacote Android
      const appJson = path.join(dir, 'app.json');
      try { const a = JSON.parse(fs.readFileSync(appJson, 'utf8')); a.expo.name = name; a.expo.android = { ...(a.expo.android || {}), package: 'com.nexus.' + slug.replace(/-/g, '') }; fs.writeFileSync(appJson, JSON.stringify(a, null, 2)); } catch { }
    }
  }
  setMeta(slug, { title: name, kind, version: '1.0.0', created: Date.now() });
  emit('project', { slug, action: 'new' });
  return { slug, kind, title: name, dir };
}

/** Gera a prévia web do projeto e devolve o endereço /p/<slug>/ */
export async function preview({ slug, job, signal }) {
  const dir = safe(slug), kind = detectKind(slug), base = `/p/${slug}/`;
  let out = null;
  if (kind === 'expo') {
    const appJson = path.join(dir, 'app.json');
    try { const a = JSON.parse(fs.readFileSync(appJson, 'utf8')); a.expo.experiments = { ...(a.expo.experiments || {}), baseUrl: `/p/${slug}` }; fs.writeFileSync(appJson, JSON.stringify(a, null, 2)); } catch { }
    if (!fs.existsSync(path.join(dir, 'node_modules'))) await run('npm install', { cwd: dir, signal, onLine: l => job?.line(l) });
    const r = await run('npx expo export --platform web --output-dir .nexus-preview', { cwd: dir, signal, onLine: l => job?.line(l) });
    if (r.code !== 0) throw new Error('A prévia falhou:\n' + r.out.slice(-1500));
    out = '.nexus-preview';
  } else if (kind === 'vite-react' || fs.existsSync(path.join(dir, 'vite.config.js'))) {
    if (!fs.existsSync(path.join(dir, 'node_modules'))) await run('npm install', { cwd: dir, signal, onLine: l => job?.line(l) });
    const r = await run(`npx vite build --base=${base} --outDir .nexus-preview --emptyOutDir`, { cwd: dir, signal, onLine: l => job?.line(l) });
    if (r.code !== 0) throw new Error('A prévia falhou:\n' + r.out.slice(-1500));
    out = '.nexus-preview';
  } else out = fs.existsSync(path.join(dir, 'www')) ? 'www' : '.';
  setMeta(slug, { previewDir: out, previewUrl: base, previewAt: Date.now() });
  emit('preview', { slug, url: base, kind, at: Date.now() });
  return { url: base, kind };
}
export function previewDir(slug) { const m = meta(slug); if (!m?.previewDir) return null; return path.join(safe(slug), m.previewDir); }
