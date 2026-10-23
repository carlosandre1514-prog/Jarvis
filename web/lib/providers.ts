import { buildNegativePrompt, buildPrompt, buildTexturePrompt, type GenOptions } from "./prompt";
import type { Settings } from "./settings";

export interface GenResult {
  provider: GenOptions["provider"];
  taskId: string;
  glbUrl: string;
  fbxUrl?: string;
  objUrl?: string;
  thumbnail?: string;
}

export interface Callbacks {
  onProgress: (pct: number) => void;
  onStage: (text: string) => void;
  signal: AbortSignal;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Cancelado", "AbortError"));
    });
  });

/** Chama o Worker (que guarda as chaves) e devolve o JSON, com erros legíveis. */
export async function callWorker<T = any>(
  s: Settings,
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {}
): Promise<T> {
  if (!s.workerUrl) throw new Error("Configure o endereço do Worker em ⚙ Configurações.");
  const res = await fetch(s.workerUrl.replace(/\/+$/, "") + path, {
    method: init.method || "GET",
    headers: { "Content-Type": "application/json", "X-Access-Token": s.accessToken },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  });
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!res.ok) throw new Error(data.error || data.message || `Erro ${res.status}`);
  return data as T;
}

/** Baixa um arquivo gerado através do Worker (os servidores das IAs não liberam CORS). */
export async function fetchFile(s: Settings, url: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(
    `${s.workerUrl.replace(/\/+$/, "")}/download?url=${encodeURIComponent(url)}`,
    { headers: { "X-Access-Token": s.accessToken }, signal }
  );
  if (!res.ok) throw new Error(`Não foi possível baixar o arquivo (${res.status}). Links da IA expiram após alguns dias.`);
  return res.blob();
}

// ---------------- Meshy ----------------

async function meshyWait(s: Settings, id: string, cb: Callbacks, from: number, to: number) {
  for (;;) {
    const t = await callWorker(s, `/meshy/text-to-3d/${id}`, { signal: cb.signal });
    cb.onProgress(from + ((t.progress || 0) / 100) * (to - from));
    if (t.status === "SUCCEEDED") return t;
    if (t.status === "FAILED" || t.status === "CANCELED" || t.status === "EXPIRED") {
      throw new Error(t.task_error?.message || `Meshy: tarefa ${t.status}`);
    }
    await sleep(4000, cb.signal);
  }
}

async function meshyGenerate(s: Settings, o: GenOptions, cb: Callbacks): Promise<GenResult> {
  const isFigure = o.category === "character";
  cb.onStage("Esculpindo a malha 3D");
  const preview = await callWorker(s, "/meshy/text-to-3d", {
    method: "POST",
    signal: cb.signal,
    body: {
      mode: "preview",
      prompt: buildPrompt(o),
      art_style: "realistic",
      should_remesh: true,
      topology: o.topology,
      target_polycount: o.polycount,
      symmetry_mode: isFigure ? "on" : "auto",
      pose_mode: isFigure ? o.pose : "",
    },
  });
  const white = o.finish === "white";
  let task = await meshyWait(s, preview.result, cb, 0, white ? 100 : 45);

  if (!white) {
    cb.onStage("Pintando texturas PBR (cor, normal, rugosidade, metal)");
    const texturePrompt = buildTexturePrompt(o);
    const refine = await callWorker(s, "/meshy/text-to-3d", {
      method: "POST",
      signal: cb.signal,
      body: {
        mode: "refine",
        preview_task_id: preview.result,
        enable_pbr: true,
        ...(texturePrompt ? { texture_prompt: texturePrompt } : {}),
      },
    });
    task = await meshyWait(s, refine.result, cb, 45, 100);
  }

  const urls = task.model_urls || {};
  if (!urls.glb) throw new Error("A Meshy não retornou o arquivo .GLB");
  return {
    provider: "meshy",
    taskId: task.id,
    glbUrl: urls.glb,
    fbxUrl: urls.fbx,
    objUrl: urls.obj,
    thumbnail: task.thumbnail_url,
  };
}

// ---------------- Tripo3D ----------------

async function tripoWait(s: Settings, id: string, cb: Callbacks, from: number, to: number) {
  for (;;) {
    const { data } = await callWorker(s, `/tripo/task/${id}`, { signal: cb.signal });
    cb.onProgress(from + ((data.progress || 0) / 100) * (to - from));
    if (data.status === "success") return data;
    if (["failed", "cancelled", "banned", "expired", "unknown"].includes(data.status)) {
      throw new Error(`Tripo3D: tarefa ${data.status}`);
    }
    await sleep(4000, cb.signal);
  }
}

async function tripoCreate(s: Settings, body: unknown, signal: AbortSignal): Promise<string> {
  const r = await callWorker(s, "/tripo/task", { method: "POST", body, signal });
  if (r.code !== 0 || !r.data?.task_id) throw new Error(r.message || "Tripo3D recusou a tarefa");
  return r.data.task_id;
}

async function tripoGenerate(s: Settings, o: GenOptions, cb: Callbacks): Promise<GenResult> {
  const color = o.finish === "color";
  cb.onStage(color ? "Gerando malha e texturas PBR" : "Esculpindo a malha 3D (sem textura)");
  const id = await tripoCreate(
    s,
    {
      type: "text_to_model",
      prompt: buildPrompt(o),
      negative_prompt: buildNegativePrompt(o),
      face_limit: o.polycount,
      texture: color,
      pbr: color,
    },
    cb.signal
  );
  const data = await tripoWait(s, id, cb, 0, 100);
  const out = data.output || {};
  const glbUrl = out.pbr_model || out.model || out.base_model;
  if (!glbUrl) throw new Error("A Tripo3D não retornou o modelo");
  return { provider: "tripo", taskId: id, glbUrl, thumbnail: out.rendered_image };
}

/** A Tripo entrega GLB; o FBX é gerado sob demanda por uma tarefa de conversão. */
export async function tripoToFbx(s: Settings, r: GenResult, o: GenOptions, cb: Callbacks): Promise<string> {
  cb.onStage("Convertendo para .FBX");
  const id = await tripoCreate(
    s,
    {
      type: "convert_model",
      format: "FBX",
      original_model_task_id: r.taskId,
      quad: o.topology === "quad",
      face_limit: o.polycount,
    },
    cb.signal
  );
  const data = await tripoWait(s, id, cb, 0, 100);
  const url = data.output?.model;
  if (!url) throw new Error("A conversão para FBX não retornou arquivo");
  return url;
}

export function generate(s: Settings, o: GenOptions, cb: Callbacks): Promise<GenResult> {
  return o.provider === "tripo" ? tripoGenerate(s, o, cb) : meshyGenerate(s, o, cb);
}
