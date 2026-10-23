import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";
import { providers } from "./providers/index.js";
import { downloadFile } from "./util.js";
import { runBlender } from "./blender.js";

/** Jobs em memória. Para produção, troque por Redis/banco. */
const jobs = new Map();

export function getJob(id) {
  return jobs.get(id);
}

export function createJob({ prompt, provider, targetFaces }) {
  const id = crypto.randomUUID();
  const job = {
    id,
    prompt,
    provider,
    targetFaces,
    status: "queued",
    progress: 0,
    message: "Na fila",
    files: {},
    createdAt: new Date().toISOString(),
  };
  jobs.set(id, job);
  runPipeline(job).catch((e) => {
    job.status = "failed";
    job.error = e.message;
    job.message = "Erro no pipeline";
    console.error(`[job ${id}]`, e);
  });
  return job;
}

const fileUrl = (id, name) => `/files/${id}/${name}`;

async function runPipeline(job) {
  const dir = path.join(config.tempDir, job.id);
  fs.mkdirSync(dir, { recursive: true });
  const raw = path.join(dir, "raw.glb");
  const p = providers[job.provider];

  // Etapas 1-3: prompt -> API de IA 3D -> .GLB bruto em /temp
  job.status = "generating";
  if (p.generate) {
    const url = await p.generate(job.prompt, {
      onProgress: (v) => (job.progress = Math.min(70, v * 0.7)),
      onMessage: (m) => (job.message = m),
    });
    job.message = "Baixando modelo bruto...";
    await downloadFile(url, raw);
  } else {
    job.message = "Demo: Blender criando modelo de exemplo...";
    await runBlender(["--demo", raw]);
  }
  job.files.rawGlb = fileUrl(job.id, "raw.glb");
  job.progress = 70;

  // Etapa 4: Blender headless otimiza malha/UV e exporta FBX + GLB
  job.status = "processing";
  job.message = "Blender: decimação, UV e exportação...";
  const stats = await runBlender([
    "--input", raw,
    "--output-dir", dir,
    "--name", "model",
    "--target-faces", String(job.targetFaces),
  ]);
  const { fbx, glb, ...publicStats } = stats; // não expõe caminhos do servidor
  job.stats = publicStats;
  job.files.glb = fileUrl(job.id, "model.glb");
  job.files.fbx = fileUrl(job.id, "model.fbx");

  // Etapas 5-6: visualização e download na interface
  job.status = "done";
  job.progress = 100;
  job.message = "Pronto para Unreal, Unity ou Godot!";
}
