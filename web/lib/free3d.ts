/**
 * Motor 100% gratuito: modelos abertos rodando nos Spaces do Hugging Face (GPU grátis "ZeroGPU").
 *
 *   texto ──FLUX.1-schnell──► imagem de referência ─┬─Hunyuan3D-2──► modelo branco (.glb)
 *                                                    └─TRELLIS─────► modelo colorido (.glb)
 *
 * Tudo é chamado direto do navegador: não há servidor, chave paga ou cobrança.
 * A cota diária de GPU é do Hugging Face (maior com um token grátis de conta HF).
 */
import { Client, handle_file } from "@gradio/client";
import { buildImagePrompt, type GenOptions } from "./prompt";

export const SPACES = {
  image: "black-forest-labs/FLUX.1-schnell",
  hunyuan: "tencent/Hunyuan3D-2",
  trellis: "trellis-community/TRELLIS",
} as const;

export interface Progress {
  stage: string;
  detail?: string;
}

interface FileData {
  url: string;
  orig_name?: string;
  size?: number | null;
}

type Token = `hf_${string}` | undefined;

const asToken = (t: string): Token => (t.trim().startsWith("hf_") ? (t.trim() as `hf_${string}`) : undefined);

/** Respostas do Gradio às vezes vêm embrulhadas em { value, __type__: "update" }. */
function unwrap(d: any): any {
  return d && typeof d === "object" && "__type__" in d && "value" in d ? d.value : d;
}

function files(data: unknown[]): FileData[] {
  return data.map(unwrap).filter((d): d is FileData => !!d && typeof d === "object" && typeof d.url === "string");
}

/** Junta o cancelamento do usuário com um tempo limite (funciona em navegadores antigos). */
function withTimeout(signal: AbortSignal, ms: number): AbortSignal {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  signal.addEventListener("abort", () => ctrl.abort());
  ctrl.signal.addEventListener("abort", () => clearTimeout(timer));
  return ctrl.signal;
}

/** Mensagens de erro do Hugging Face em português e com o que fazer. */
export function friendlyError(err: unknown): string {
  const msg = String((err as any)?.message ?? (err as any)?.title ?? err ?? "");
  if (/quota/i.test(msg)) {
    const wait = msg.match(/Try again in ([\d:]+)/i)?.[1];
    return (
      "A cota grátis de GPU do Hugging Face acabou por hoje" +
      (wait && wait !== "0:00:00" ? ` (libera em ${wait})` : "") +
      ". Coloque um token grátis do Hugging Face em ⚙ Configurações para ganhar mais cota."
    );
  }
  if (/GPU duration|subscribe/i.test(msg)) return "Este modelo de IA exige plano pago no Hugging Face. Tente de novo mais tarde.";
  if (/sleeping|paused|building|not running|could not resolve app config/i.test(msg)) {
    return "O servidor grátis da IA está ligando ou fora do ar agora. Tente de novo em 1 ou 2 minutos.";
  }
  if (/network|fetch|connection/i.test(msg)) return "Falha de conexão com o Hugging Face. Verifique a internet e tente de novo.";
  return msg || "Erro desconhecido na IA.";
}

async function connect(space: string, token: Token, onProgress: (p: Progress) => void, label: string) {
  return Client.connect(space, {
    token,
    record_history: false,
    // sem "status" o cliente engole erros (ex.: cota esgotada) e só encerra o fluxo
    events: ["data", "status"],
    status_callback: (s) => {
      if (s.status === "sleeping" || s.status === "building") onProgress({ stage: label, detail: "Ligando o servidor grátis (pode levar 1 min)" });
    },
  });
}

/** Executa um endpoint acompanhando a fila e devolve os dados. */
async function run(
  client: Awaited<ReturnType<typeof Client.connect>>,
  endpoint: string,
  args: Record<string, unknown>,
  label: string,
  onProgress: (p: Progress) => void,
  signal: AbortSignal
): Promise<unknown[]> {
  const job = client.submit(endpoint, args);
  const onAbort = () => job.cancel();
  signal.addEventListener("abort", onAbort);
  try {
    for await (const msg of job) {
      if (signal.aborted) throw new DOMException("Cancelado", "AbortError");
      if (msg.type === "status") {
        if (msg.stage === "error") throw new Error(typeof msg.message === "string" && msg.message ? msg.message : "Erro na IA");
        if (msg.queue && typeof msg.position === "number" && msg.position > 0) {
          onProgress({ stage: label, detail: `Na fila: posição ${msg.position}${msg.eta ? ` · ~${Math.round(msg.eta)} s` : ""}` });
        } else if (msg.stage === "pending" || msg.stage === "generating") {
          onProgress({ stage: label, detail: msg.progress_data?.[0]?.desc ?? undefined });
        }
      }
      if (msg.type === "data") return msg.data as unknown[];
    }
    throw new Error("A IA encerrou sem resposta");
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Passo 1: texto → imagem de referência (concept art do objeto isolado).
 * Primeiro tenta o Pollinations.ai (FLUX grátis, não gasta a cota de GPU do Hugging Face,
 * que fica toda para o 3D); se falhar, usa o FLUX.1-schnell no Hugging Face.
 */
export async function generateReferenceImage(
  o: GenOptions,
  hfToken: string,
  onProgress: (p: Progress) => void,
  signal: AbortSignal
): Promise<Blob> {
  const label = "Desenhando a imagem de referência";
  onProgress({ stage: label });
  const tall = o.category === "character" || o.category === "creature" || o.category === "building";
  const width = tall ? 768 : 1024;
  const height = 1024;
  const prompt = buildImagePrompt(o);

  try {
    const seed = Math.floor(Math.random() * 1e9);
    const url =
      `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
      `?width=${width}&height=${height}&seed=${seed}&model=flux&nologo=true&safe=true`;
    const res = await fetch(url, { signal: withTimeout(signal, 90000) });
    const blob = await res.blob();
    if (res.ok && blob.type.startsWith("image/") && blob.size > 5000) return blob;
    throw new Error(`Pollinations ${res.status}`);
  } catch (err) {
    if (signal.aborted) throw err;
    onProgress({ stage: label, detail: "Usando o servidor reserva" });
  }

  const client = await connect(SPACES.image, asToken(hfToken), onProgress, label);
  const data = await run(
    client,
    "/infer",
    { prompt, seed: 0, randomize_seed: true, width, height, num_inference_steps: 4 },
    label,
    onProgress,
    signal
  );
  const [img] = files(data);
  if (!img) throw new Error("A IA não devolveu a imagem");
  return new Blob([await download(img.url, signal)], { type: "image/webp" });
}

/** Passo 2: imagem → modelo 3D. Devolve a URL do .glb. */
export async function imageTo3D(
  image: string | Blob,
  finish: GenOptions["finish"],
  hfToken: string,
  onProgress: (p: Progress) => void,
  signal: AbortSignal
): Promise<{ url: string; engine: string }> {
  const token = asToken(hfToken);
  const label = finish === "white" ? "Esculpindo o modelo 3D" : "Esculpindo e pintando o modelo 3D";
  onProgress({ stage: label });

  // Só o modelo: Hunyuan3D-2 (malha limpa e detalhada em ~10 s de GPU).
  if (finish === "white") {
    const client = await connect(SPACES.hunyuan, token, onProgress, label);
    const [mesh] = files(
      await run(
        client,
        "/shape_generation",
        {
          caption: "",
          image: handle_file(image),
          mv_image_front: null,
          mv_image_back: null,
          mv_image_left: null,
          mv_image_right: null,
          steps: 30,
          guidance_scale: 5,
          seed: 1234,
          octree_resolution: 256,
          check_box_rembg: true,
          num_chunks: 8000,
          randomize_seed: true,
        },
        label,
        onProgress,
        signal
      )
    );
    if (!mesh) throw new Error("A IA não devolveu o modelo");
    return { url: mesh.url, engine: "Hunyuan3D-2" };
  }

  // Colorido: TRELLIS gera malha + textura de cor dentro da cota grátis
  // (a textura do Hunyuan3D-2.1 exige plano pago e a do 2.0 está quebrada no Space).
  const client = await connect(SPACES.trellis, token, onProgress, label);
  await client.predict("/start_session", {}).catch(() => undefined);
  const [pre] = files((await client.predict("/preprocess_image", { image: handle_file(image) })).data as unknown[]);
  const out = files(
    await run(
      client,
      "/generate_and_extract_glb",
      {
        image: handle_file(pre?.url ?? image),
        multiimages: [],
        seed: 0,
        ss_guidance_strength: 7.5,
        ss_sampling_steps: 12,
        slat_guidance_strength: 3,
        slat_sampling_steps: 12,
        multiimage_algo: "stochastic",
        mesh_simplify: 0.95,
        texture_size: 1024,
      },
      label,
      onProgress,
      signal
    )
  );
  const glb = out.find((f) => /\.glb/i.test(f.url)) ?? out[0];
  if (!glb) throw new Error("A IA não devolveu o modelo");
  return { url: glb.url, engine: "TRELLIS" };
}

/** Baixa um arquivo gerado (os Spaces liberam CORS para o navegador). */
export async function download(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Não foi possível baixar o modelo (${res.status})`);
  return res.arrayBuffer();
}
