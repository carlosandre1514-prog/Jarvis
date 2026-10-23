import { config } from "../config.js";
import { fetchJson, sleep } from "../util.js";

// Docs: https://platform.tripo3d.ai/docs/generation
const BASE = "https://api.tripo3d.ai/v2/openapi/task";

function headers() {
  return { Authorization: `Bearer ${config.tripoKey}`, "Content-Type": "application/json" };
}

export async function generate(prompt, { onProgress, onMessage }) {
  onMessage("Tripo3D: gerando modelo texturizado (PBR)...");
  const created = await fetchJson(BASE, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ type: "text_to_model", prompt, texture: true, pbr: true }),
  });
  if (created.code !== 0) throw new Error(created.message || "Tripo3D recusou a tarefa");
  const id = created.data.task_id;

  for (;;) {
    const { data } = await fetchJson(`${BASE}/${id}`, { headers: headers() });
    onProgress(data.progress || 0);
    if (data.status === "success") {
      const out = data.output || {};
      const url = out.pbr_model || out.model || out.base_model;
      if (!url) throw new Error("Tripo3D não retornou um arquivo de modelo");
      return url;
    }
    if (["failed", "cancelled", "banned", "expired", "unknown"].includes(data.status)) {
      throw new Error(`Tarefa Tripo3D: ${data.status}`);
    }
    await sleep(4000);
  }
}
