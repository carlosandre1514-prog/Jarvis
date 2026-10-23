import fs from "node:fs";
import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { providers } from "./providers/index.js";
import { createJob, getJob } from "./jobs.js";

fs.mkdirSync(config.tempDir, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: "100kb" }));

app.get("/api/providers", (_req, res) => {
  res.json(
    Object.entries(providers).map(([id, p]) => ({ id, label: p.label, available: p.available() }))
  );
});

// Recebe o prompt e inicia o pipeline em segundo plano. O cliente consulta /api/jobs/:id.
app.post("/api/generate", (req, res) => {
  const prompt = String(req.body?.prompt || "").trim();
  const provider = String(req.body?.provider || "meshy");
  const targetFaces = Math.max(500, Math.min(500000, Number(req.body?.targetFaces) || 20000));

  if (!prompt) return res.status(400).json({ error: "Informe um prompt." });
  if (prompt.length > 600) return res.status(400).json({ error: "Prompt muito longo (máx. 600)." });
  const p = providers[provider];
  if (!p) return res.status(400).json({ error: `Provedor desconhecido: ${provider}` });
  if (!p.available()) return res.status(400).json({ error: `Configure a chave de API do ${p.label} no .env` });

  res.status(202).json(createJob({ prompt, provider, targetFaces }));
});

app.get("/api/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job não encontrado" });
  res.json(job);
});

// Arquivos gerados (download .FBX / .GLB e visualização).
app.use(
  "/files",
  express.static(config.tempDir, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".glb")) res.setHeader("Content-Type", "model/gltf-binary");
    },
  })
);

app.listen(config.port, () => {
  console.log(`Backend em http://localhost:${config.port}`);
  console.log(`Blender: ${config.blenderPath} · temp: ${config.tempDir}`);
});
