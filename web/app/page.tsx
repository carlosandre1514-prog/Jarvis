"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

const ModelViewer = dynamic(() => import("@/components/ModelViewer"), { ssr: false });

type JobStatus = "queued" | "generating" | "processing" | "done" | "failed";

interface Job {
  id: string;
  prompt: string;
  provider: string;
  status: JobStatus;
  progress: number;
  message?: string;
  error?: string;
  files: { rawGlb?: string; glb?: string; fbx?: string };
  stats?: { facesBefore?: number; facesAfter?: number; uvOk?: boolean };
}

const STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Na fila",
  generating: "IA gerando o modelo",
  processing: "Blender otimizando malha",
  done: "Pronto",
  failed: "Falhou",
};

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState("meshy");
  const [targetFaces, setTargetFaces] = useState(20000);
  const [job, setJob] = useState<Job | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<"glb" | "fbx">("glb");
  const [autoRotate, setAutoRotate] = useState(true);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [localFormat, setLocalFormat] = useState<"glb" | "fbx">("glb");
  const [providers, setProviders] = useState<{ id: string; label: string; available: boolean }[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/providers")
      .then((r) => r.json())
      .then((list) => {
        setProviders(list);
        const first = list.find((p: { available: boolean }) => p.available);
        if (first) setProvider(first.id);
      })
      .catch(() => setError("Backend indisponível. Rode `npm run dev` em /server."));
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  function poll(id: string) {
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(async () => {
      const res = await fetch(`/api/jobs/${id}`);
      if (!res.ok) return;
      const data: Job = await res.json();
      setJob(data);
      if (data.status === "done" || data.status === "failed") {
        clearInterval(timer.current!);
        timer.current = null;
      }
    }, 2000);
  }

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    setSubmitting(true);
    setError(null);
    setLocalUrl(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, provider, targetFaces }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao iniciar geração");
      setJob(data);
      poll(data.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function openLocal(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (localUrl) URL.revokeObjectURL(localUrl);
    setLocalFormat(file.name.toLowerCase().endsWith(".fbx") ? "fbx" : "glb");
    setLocalUrl(URL.createObjectURL(file));
  }

  // O que mostrar no visualizador: arquivo local > final escolhido > bruto da IA.
  let viewUrl: string | null = null;
  let viewFormat: "glb" | "fbx" = "glb";
  if (localUrl) {
    viewUrl = localUrl;
    viewFormat = localFormat;
  } else if (job?.files) {
    if (preview === "fbx" && job.files.fbx) {
      viewUrl = job.files.fbx;
      viewFormat = "fbx";
    } else {
      viewUrl = job.files.glb ?? job.files.rawGlb ?? null;
    }
  }

  const busy = job && !["done", "failed"].includes(job.status);

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 p-4 md:p-8 lg:flex-row">
      <section className="flex w-full flex-col gap-5 lg:w-96">
        <header>
          <h1 className="text-2xl font-bold">Gerador de Ativos 3D</h1>
          <p className="text-sm text-zinc-400">Texto → IA 3D → Blender → .FBX / .GLB para sua engine.</p>
        </header>

        <form onSubmit={generate} className="flex flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <label className="flex flex-col gap-1 text-sm">
            Descreva o objeto
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="Ex.: baú de tesouro medieval de madeira com detalhes em ferro"
              className="rounded-lg border border-zinc-700 bg-zinc-950 p-2 outline-none focus:border-indigo-500"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Motor de IA
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 p-2"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.available}>
                  {p.label}
                  {p.available ? "" : " (sem chave de API)"}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Polígonos alvo (decimação): {targetFaces.toLocaleString("pt-BR")}
            <input
              type="range"
              min={1000}
              max={100000}
              step={1000}
              value={targetFaces}
              onChange={(e) => setTargetFaces(Number(e.target.value))}
            />
          </label>

          <button
            disabled={submitting || !!busy || !prompt.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Gerando..." : "Gerar modelo 3D"}
          </button>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </form>

        {job && (
          <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm">
            <div className="flex justify-between">
              <span className="font-semibold">{STATUS_LABEL[job.status]}</span>
              <span className="text-zinc-400">{Math.round(job.progress)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded bg-zinc-800">
              <div
                className={`h-full transition-all ${job.status === "failed" ? "bg-red-500" : "bg-indigo-500"}`}
                style={{ width: `${job.progress}%` }}
              />
            </div>
            {job.message && <p className="text-zinc-400">{job.message}</p>}
            {job.error && <p className="text-red-400">{job.error}</p>}
            {job.stats?.facesBefore != null && (
              <p className="text-zinc-400">
                Faces: {job.stats.facesBefore.toLocaleString("pt-BR")} →{" "}
                {job.stats.facesAfter?.toLocaleString("pt-BR")} · UV {job.stats.uvOk ? "OK" : "gerado automaticamente"}
              </p>
            )}
            {job.status === "done" && (
              <div className="flex gap-2">
                {job.files.fbx && (
                  <a href={job.files.fbx} download className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-center font-semibold hover:bg-emerald-500">
                    Baixar .FBX
                  </a>
                )}
                {job.files.glb && (
                  <a href={job.files.glb} download className="flex-1 rounded-lg bg-sky-600 px-3 py-2 text-center font-semibold hover:bg-sky-500">
                    Baixar .GLB
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        <label className="flex cursor-pointer flex-col gap-1 rounded-xl border border-dashed border-zinc-700 p-4 text-sm text-zinc-400 hover:border-zinc-500">
          Ou abra um arquivo .GLB / .FBX do seu computador
          <input type="file" accept=".glb,.gltf,.fbx" onChange={openLocal} className="text-xs" />
        </label>
      </section>

      <section className="relative min-h-[60vh] flex-1 overflow-hidden rounded-xl border border-zinc-800">
        <ModelViewer url={viewUrl} format={viewFormat} autoRotate={autoRotate} />
        {!viewUrl && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-zinc-500">
            O modelo aparece aqui · arraste para girar 360°
          </div>
        )}
        <div className="absolute right-3 top-3 flex gap-2 text-xs">
          {job?.status === "done" && !localUrl && (
            <>
              <button onClick={() => setPreview("glb")} className={`rounded px-2 py-1 ${preview === "glb" ? "bg-indigo-600" : "bg-zinc-800"}`}>GLB</button>
              <button onClick={() => setPreview("fbx")} className={`rounded px-2 py-1 ${preview === "fbx" ? "bg-indigo-600" : "bg-zinc-800"}`}>FBX</button>
            </>
          )}
          <button onClick={() => setAutoRotate((v) => !v)} className="rounded bg-zinc-800 px-2 py-1">
            {autoRotate ? "Pausar giro" : "Girar"}
          </button>
        </div>
      </section>
    </main>
  );
}
