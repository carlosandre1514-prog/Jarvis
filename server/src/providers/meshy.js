import { config } from "../config.js";
import { fetchJson, sleep } from "../util.js";

// Docs: https://docs.meshy.ai/api/text-to-3d
const BASE = "https://api.meshy.ai/openapi/v2/text-to-3d";

function headers() {
  return { Authorization: `Bearer ${config.meshyKey}`, "Content-Type": "application/json" };
}

async function waitTask(id, onProgress, from, to) {
  for (;;) {
    const task = await fetchJson(`${BASE}/${id}`, { headers: headers() });
    onProgress(from + ((task.progress || 0) / 100) * (to - from));
    if (task.status === "SUCCEEDED") return task;
    if (task.status === "FAILED" || task.status === "CANCELED") {
      throw new Error(task.task_error?.message || `Tarefa Meshy ${task.status}`);
    }
    await sleep(4000);
  }
}

/**
 * Gera em duas etapas: "preview" (malha) e "refine" (texturas PBR:
 * albedo, normal, roughness, metallic). Retorna a URL do .GLB final.
 */
export async function generate(prompt, { onProgress, onMessage }) {
  onMessage("Meshy: gerando malha (preview)...");
  const preview = await fetchJson(BASE, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ mode: "preview", prompt, art_style: "realistic", should_remesh: true }),
  });
  await waitTask(preview.result, onProgress, 0, 50);

  onMessage("Meshy: aplicando texturas PBR (refine)...");
  const refine = await fetchJson(BASE, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ mode: "refine", preview_task_id: preview.result, enable_pbr: true }),
  });
  const done = await waitTask(refine.result, onProgress, 50, 100);

  const url = done.model_urls?.glb;
  if (!url) throw new Error("Meshy não retornou um arquivo .GLB");
  return url;
}
