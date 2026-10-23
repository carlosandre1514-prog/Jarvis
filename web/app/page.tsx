"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelStats, ViewMode } from "@/components/ModelViewer";
import SettingsDialog from "@/components/SettingsDialog";
import { CATEGORIES, STYLES, type Category, type GenOptions } from "@/lib/prompt";
import { download, friendlyError, generateReferenceImage, imageTo3D, type Progress } from "@/lib/free3d";
import { deleteHistory, loadHistory, saveHistory, type HistoryItem } from "@/lib/history";
import { loadToken } from "@/lib/settings";

const ModelViewer = dynamic(() => import("@/components/ModelViewer"), { ssr: false });

const POLY_PRESETS = [
  { label: "Mobile", value: 5000 },
  { label: "PC", value: 20000 },
  { label: "Alta", value: 60000 },
];

/** Altura real sugerida (metros) para o modelo já chegar na escala certa na engine. */
const DEFAULT_HEIGHT: Record<Category, number> = {
  character: 1.8,
  creature: 2,
  object: 0.6,
  weapon: 1,
  vehicle: 1.6,
  building: 6,
};

const DEFAULT_OPTIONS: GenOptions = {
  category: "character",
  description: "",
  colorNotes: "",
  finish: "color",
  style: "realistic",
  pose: "a-pose",
  polycount: 20000,
};

type RefImage = { display: string; source: string | Blob };
type Busy = null | "image" | "model" | "export";

function slug(text: string) {
  return (
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40) || "modelo"
  );
}

function saveFile(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-zinc-950 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`rounded-md px-2 py-2 text-sm transition ${
            value === o.id ? "bg-indigo-600 font-semibold text-white" : "text-zinc-400 hover:text-zinc-100"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-zinc-200">{label}</span>
        {hint && <span className="text-xs text-zinc-500">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export default function Home() {
  const [token, setToken] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [opts, setOpts] = useState<GenOptions>(DEFAULT_OPTIONS);
  const [height, setHeight] = useState(DEFAULT_HEIGHT.character);
  const [refImage, setRefImage] = useState<RefImage | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<HistoryItem | null>(null);
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("textured");
  const [autoRotate, setAutoRotate] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const abortRef = useRef<AbortController | null>(null);
  const viewerRef = useRef<HTMLElement | null>(null);

  const set = <K extends keyof GenOptions>(k: K, v: GenOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));

  useEffect(() => {
    setToken(loadToken());
    loadHistory().then(setHistory);
  }, []);

  // Miniaturas do histórico como object URLs
  useEffect(() => {
    const urls: Record<string, string> = {};
    for (const h of history) if (h.thumbnail) urls[h.id] = URL.createObjectURL(h.thumbnail);
    setThumbs(urls);
    return () => Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
  }, [history]);

  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    setElapsed(0);
    const t = setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const showModel = useCallback((item: HistoryItem) => {
    setCurrent(item);
    setStats(null);
    setMode(item.options.finish === "white" ? "clay" : "textured");
    setViewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(item.glb);
    });
  }, []);

  function setCategory(c: Category) {
    set("category", c);
    setHeight(DEFAULT_HEIGHT[c]);
  }

  function start(kind: Busy) {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(kind);
    setError(null);
    setProgress(null);
    return ctrl;
  }

  function finish() {
    setBusy(null);
    setProgress(null);
    abortRef.current = null;
  }

  async function onReferenceImage() {
    if (!opts.description.trim()) return setError("Descreva o que você quer criar.");
    const ctrl = start("image");
    try {
      const url = await generateReferenceImage(opts, token, setProgress, ctrl.signal);
      setRefImage({ display: url, source: url });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(friendlyError(e));
    } finally {
      finish();
    }
  }

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.name.match(/\.(glb|gltf|fbx)$/i)) return setError("Para ver um modelo 3D pronto, use o botão “Abrir .GLB” embaixo do visualizador.");
    setRefImage({ display: URL.createObjectURL(file), source: file });
    setError(null);
  }

  async function onBuild3D() {
    if (!refImage) return;
    const ctrl = start("model");
    try {
      const { url, engine } = await imageTo3D(refImage.source, opts.finish, token, setProgress, ctrl.signal);
      setProgress({ stage: "Baixando o modelo" });
      const raw = await download(url, ctrl.signal);
      setProgress({ stage: "Otimizando a malha", detail: "Reduzindo polígonos e ajustando escala" });
      const { optimizeGlb } = await import("@/lib/optimize");
      const result = await optimizeGlb(raw, { targetTriangles: opts.polycount, white: opts.finish === "white", height });
      const thumbnail =
        typeof refImage.source === "string"
          ? await fetch(refImage.source).then((r) => r.blob()).catch(() => null)
          : refImage.source;
      const item: HistoryItem = {
        id: `${Date.now()}`,
        createdAt: Date.now(),
        options: opts,
        engine,
        triangles: result.trianglesAfter,
        thumbnail,
        glb: new Blob([result.glb], { type: "model/gltf-binary" }),
      };
      showModel(item);
      setHistory(await saveHistory(item));
      viewerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(friendlyError(e));
    } finally {
      finish();
    }
  }

  async function exportAs(kind: "glb" | "fbx", share = false) {
    if (!current) return;
    const name = `${slug(current.options.description)}.${kind}`;
    setError(null);
    try {
      let blob: Blob = current.glb;
      if (kind === "fbx") {
        setBusy("export");
        setProgress({ stage: "Gerando o .FBX" });
        const { glbToFbx } = await import("@/lib/toFbx");
        blob = new Blob([await glbToFbx(await current.glb.arrayBuffer())], { type: "application/octet-stream" });
      }
      const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
      if (share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
      } else {
        saveFile(blob, name);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(friendlyError(e));
    } finally {
      finish();
    }
  }

  function openLocal(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".glb")) return setError("Abra um arquivo .GLB.");
    showModel({
      id: `local-${Date.now()}`,
      createdAt: Date.now(),
      options: { ...opts, description: file.name.replace(/\.glb$/i, "") },
      engine: "Arquivo local",
      triangles: 0,
      thumbnail: null,
      glb: file,
    });
  }

  const isFigure = opts.category === "character";
  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-zinc-800/80 bg-zinc-950/90 px-4 py-3 backdrop-blur md:px-6">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-sm font-black">
            3D
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight md:text-lg">Gerador de Ativos 3D</h1>
            <p className="text-xs text-emerald-400">100% grátis · Unreal · Unity · Godot</p>
          </div>
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-1.5 text-sm hover:border-zinc-600"
        >
          <span className={`h-2 w-2 rounded-full ${token ? "bg-emerald-400" : "bg-zinc-500"}`} />
          {token ? "Cota extra" : "Cota"}
        </button>
      </header>

      <main className="flex flex-1 flex-col gap-4 p-4 md:p-6 lg:flex-row">
        <div className="flex w-full flex-col gap-4 lg:w-[400px] lg:shrink-0">
          {/* Passo 1: descrição */}
          <section className="flex flex-col gap-5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <h2 className="text-sm font-semibold text-indigo-300">1 · Descreva o ativo</h2>
            <Field label="Tipo">
              <div className="grid grid-cols-3 gap-1.5">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCategory(c.id)}
                    className={`rounded-lg border px-2 py-2 text-xs transition ${
                      opts.category === c.id
                        ? "border-indigo-500 bg-indigo-500/15 font-semibold text-white"
                        : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-zinc-500">{CATEGORIES.find((c) => c.id === opts.category)?.hint}</p>
            </Field>

            <Field label="Descrição e especificações" hint={`${opts.description.length}/400`}>
              <textarea
                value={opts.description}
                maxLength={400}
                onChange={(e) => set("description", e.target.value)}
                rows={4}
                placeholder={
                  isFigure
                    ? "Ex.: guerreiro viking adulto, alto e musculoso, barba ruiva trançada, armadura de couro, capa de pele, botas, machado nas costas"
                    : "Ex.: baú de tesouro medieval de madeira escura com reforços de ferro e cadeado dourado"
                }
                className="resize-y rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-base outline-none placeholder:text-zinc-600 focus:border-indigo-500 sm:text-sm"
              />
              <p className="text-xs text-zinc-500">
                Detalhe corpo, roupas, acessórios e proporções. Em inglês a IA costuma entender melhor.
              </p>
            </Field>

            <Field label="Acabamento">
              <Segmented
                value={opts.finish}
                onChange={(v) => set("finish", v)}
                options={[
                  { id: "color", label: "Colorido" },
                  { id: "white", label: "Só o modelo (branco)" },
                ]}
              />
            </Field>

            {opts.finish === "color" && (
              <Field label="Cores e materiais" hint="opcional">
                <input
                  value={opts.colorNotes}
                  maxLength={200}
                  onChange={(e) => set("colorNotes", e.target.value)}
                  placeholder="Ex.: couro marrom, detalhes dourados, capa vermelha"
                  className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-base outline-none placeholder:text-zinc-600 focus:border-indigo-500 sm:text-sm"
                />
              </Field>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Estilo">
                <select
                  value={opts.style}
                  onChange={(e) => set("style", e.target.value as GenOptions["style"])}
                  className="rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-sm"
                >
                  {STYLES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
              {isFigure && (
                <Field label="Pose">
                  <select
                    value={opts.pose}
                    onChange={(e) => set("pose", e.target.value as GenOptions["pose"])}
                    className="rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-sm"
                  >
                    <option value="a-pose">A-pose (rig)</option>
                    <option value="t-pose">T-pose</option>
                  </select>
                </Field>
              )}
            </div>

            <details className="rounded-lg border border-zinc-800 p-3">
              <summary className="cursor-pointer select-none text-sm font-medium text-zinc-300">Ajustes técnicos</summary>
              <div className="mt-4 flex flex-col gap-4">
                <Field label="Polígonos (triângulos)" hint={opts.polycount.toLocaleString("pt-BR")}>
                  <input
                    type="range"
                    min={1000}
                    max={150000}
                    step={1000}
                    value={opts.polycount}
                    onChange={(e) => set("polycount", Number(e.target.value))}
                    className="accent-indigo-500"
                  />
                  <div className="flex gap-1.5">
                    {POLY_PRESETS.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => set("polycount", p.value)}
                        className={`flex-1 rounded-md border px-2 py-1.5 text-xs ${
                          opts.polycount === p.value ? "border-indigo-500 text-white" : "border-zinc-800 text-zinc-400"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Altura real (metros)" hint="escala na engine">
                  <input
                    type="number"
                    min={0.05}
                    max={500}
                    step={0.05}
                    value={height}
                    onChange={(e) => setHeight(Number(e.target.value) || 0)}
                    className="rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-base sm:text-sm"
                  />
                </Field>
              </div>
            </details>

            <button
              type="button"
              onClick={onReferenceImage}
              disabled={!!busy || !opts.description.trim()}
              className="rounded-lg bg-gradient-to-r from-indigo-600 to-fuchsia-600 px-4 py-3 font-semibold shadow-lg shadow-indigo-900/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {refImage ? "Gerar outra imagem" : "Gerar imagem de referência"}
            </button>
            <label className="cursor-pointer text-center text-xs text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline">
              ou use uma imagem sua (foto, desenho, concept art)
              <input type="file" accept="image/*" onChange={onUpload} className="hidden" />
            </label>
          </section>

          {/* Passo 2: aprovar a imagem e gerar o 3D */}
          {(refImage || busy === "image") && (
            <section className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <h2 className="text-sm font-semibold text-indigo-300">2 · Confira a referência e gere o 3D</h2>
              <div className="relative overflow-hidden rounded-lg border border-zinc-800 bg-white">
                {refImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={refImage.display} alt="Imagem de referência" className="mx-auto max-h-80 w-auto object-contain" />
                ) : (
                  <div className="h-64" />
                )}
                {busy === "image" && (
                  <div className="absolute inset-0 grid place-items-center bg-zinc-950/70 text-sm">Desenhando… {elapsed}s</div>
                )}
              </div>
              <p className="text-xs text-zinc-500">
                O 3D é reconstruído a partir desta imagem. Se não gostou (corpo cortado, pose errada), gere outra antes:
                assim você não gasta a cota de 3D à toa.
              </p>
              <button
                type="button"
                onClick={onBuild3D}
                disabled={!!busy || !refImage}
                className="rounded-lg bg-emerald-600 px-4 py-3 font-semibold transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Transformar em 3D {opts.finish === "white" ? "(branco)" : "(colorido)"}
              </button>
            </section>
          )}

          {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

          {history.length > 0 && (
            <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <h2 className="mb-3 text-sm font-semibold text-zinc-300">Seus modelos (salvos neste aparelho)</h2>
              <div className="grid grid-cols-4 gap-2">
                {history.map((h) => (
                  <div key={h.id} className="group relative">
                    <button
                      type="button"
                      title={h.options.description}
                      onClick={() => showModel(h)}
                      disabled={!!busy}
                      className={`aspect-square w-full overflow-hidden rounded-lg border bg-white ${
                        current?.id === h.id ? "border-indigo-500 ring-2 ring-indigo-500/40" : "border-zinc-800"
                      }`}
                    >
                      {thumbs[h.id] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumbs[h.id]} alt="" className="h-full w-full object-contain" />
                      ) : (
                        <span className="text-[10px] text-zinc-500">{h.options.description.slice(0, 20)}</span>
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label="Apagar"
                      onClick={async () => setHistory(await deleteHistory(h.id))}
                      className="absolute -right-1 -top-1 hidden h-5 w-5 rounded-full bg-zinc-800 text-xs text-zinc-300 group-hover:block"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <section
          ref={viewerRef}
          className="relative flex min-h-[70vh] flex-1 scroll-mt-20 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-[#141417] lg:min-h-0"
        >
          <div className="relative flex-1">
            <ModelViewer url={viewUrl} format="glb" mode={mode} autoRotate={autoRotate} showGrid={showGrid} onStats={setStats} />

            {!viewUrl && !busy && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-zinc-500">
                <p className="text-lg text-zinc-300">Seu modelo 3D aparece aqui</p>
                <p className="text-sm">Arraste para girar 360°, pinça para zoom, dois dedos para mover.</p>
              </div>
            )}

            {(busy === "model" || busy === "export") && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-950/75 p-6 text-center backdrop-blur-sm">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-zinc-700 border-t-indigo-500" />
                <p className="font-medium">{progress?.stage ?? "Processando"}</p>
                {progress?.detail && <p className="text-sm text-zinc-400">{progress.detail}</p>}
                <p className="text-xs text-zinc-500">{elapsed}s · normalmente de 20 s a 2 min</p>
                {busy === "model" && (
                  <button onClick={() => abortRef.current?.abort()} className="mt-2 rounded-lg border border-zinc-700 px-4 py-1.5 text-sm hover:bg-zinc-800">
                    Cancelar
                  </button>
                )}
              </div>
            )}

            <div className="absolute left-3 top-3 flex gap-1 rounded-lg bg-zinc-900/90 p-1 text-xs">
              {(
                [
                  ["textured", "Textura"],
                  ["clay", "Argila"],
                  ["wireframe", "Malha"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setMode(id)}
                  className={`rounded-md px-2.5 py-1.5 ${mode === id ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-white"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="absolute right-3 top-3 flex gap-1 rounded-lg bg-zinc-900/90 p-1 text-xs">
              <button onClick={() => setShowGrid((v) => !v)} className={`rounded-md px-2.5 py-1.5 ${showGrid ? "text-white" : "text-zinc-500"}`}>
                Grade
              </button>
              <button onClick={() => setAutoRotate((v) => !v)} className={`rounded-md px-2.5 py-1.5 ${autoRotate ? "text-white" : "text-zinc-500"}`}>
                Girar
              </button>
            </div>

            {stats && viewUrl && (
              <div className="absolute bottom-3 left-3 grid grid-cols-2 gap-x-4 gap-y-0.5 rounded-lg bg-zinc-900/90 px-3 py-2 font-mono text-[11px] text-zinc-400">
                <span>Triângulos</span>
                <span className="text-right text-zinc-200">{Math.round(stats.triangles).toLocaleString("pt-BR")}</span>
                <span>Altura</span>
                <span className="text-right text-zinc-200">{stats.size[1].toFixed(2)} m</span>
                <span>Texturas</span>
                <span className="text-right text-zinc-200">{stats.textures}</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 p-3">
            {current ? (
              <>
                <span className="mr-auto w-full truncate text-xs text-zinc-400 sm:w-auto">
                  {current.options.finish === "white" ? "Modelo branco" : "Colorido"} · {current.engine}
                </span>
                <button
                  onClick={() => exportAs("fbx")}
                  disabled={!!busy}
                  className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50 sm:flex-none"
                >
                  Baixar .FBX
                </button>
                <button
                  onClick={() => exportAs("glb")}
                  disabled={!!busy}
                  className="flex-1 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold hover:bg-sky-500 disabled:opacity-50 sm:flex-none"
                >
                  Baixar .GLB
                </button>
                {canShare && (
                  <button
                    onClick={() => exportAs("fbx", true)}
                    disabled={!!busy}
                    className="w-full rounded-lg border border-zinc-700 px-3 py-2.5 text-sm hover:bg-zinc-800 disabled:opacity-50 sm:w-auto"
                  >
                    Enviar para… (Drive, WhatsApp)
                  </button>
                )}
              </>
            ) : (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200">
                <span className="rounded-md border border-zinc-700 px-3 py-1.5">Abrir .GLB do aparelho</span>
                <input type="file" accept=".glb" onChange={openLocal} className="hidden" />
              </label>
            )}
          </div>
        </section>
      </main>

      <footer className="px-4 pb-6 text-center text-xs text-zinc-600">
        IA: FLUX.1-schnell, Hunyuan3D-2 e TRELLIS via Hugging Face (GPU grátis com cota diária).
      </footer>

      <SettingsDialog open={settingsOpen} token={token} onClose={() => setSettingsOpen(false)} onSaved={setToken} />
    </div>
  );
}
