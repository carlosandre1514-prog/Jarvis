"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelStats, ViewMode } from "@/components/ModelViewer";
import SettingsDialog from "@/components/SettingsDialog";
import { CATEGORIES, STYLES, buildPrompt, type GenOptions } from "@/lib/prompt";
import { callWorker, fetchFile, generate, tripoToFbx, type GenResult } from "@/lib/providers";
import { loadSettings, type Settings } from "@/lib/settings";
import { loadHistory, pushHistory, type HistoryItem } from "@/lib/history";

const ModelViewer = dynamic(() => import("@/components/ModelViewer"), { ssr: false });

type Health = { meshy: boolean; tripo: boolean } | null;

const POLY_PRESETS = [
  { label: "Mobile", value: 5000 },
  { label: "PC / Console", value: 30000 },
  { label: "Alta", value: 100000 },
];

const DEFAULT_OPTIONS: GenOptions = {
  provider: "meshy",
  category: "character",
  description: "",
  colorNotes: "",
  finish: "color",
  style: "realistic",
  pose: "a-pose",
  polycount: 30000,
  topology: "quad",
};

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

function saveBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-zinc-950 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          disabled={o.disabled}
          onClick={() => onChange(o.id)}
          className={`rounded-md px-2 py-1.5 text-sm transition ${
            value === o.id ? "bg-indigo-600 font-semibold text-white" : "text-zinc-400 hover:text-zinc-100"
          } disabled:cursor-not-allowed disabled:opacity-40`}
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
  const [settings, setSettings] = useState<Settings>({ workerUrl: "", accessToken: "" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [health, setHealth] = useState<Health>(null);
  const [opts, setOpts] = useState<GenOptions>(DEFAULT_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<HistoryItem | null>(null);
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [viewFormat, setViewFormat] = useState<"glb" | "fbx">("glb");
  const [mode, setMode] = useState<ViewMode>("textured");
  const [autoRotate, setAutoRotate] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showPrompt, setShowPrompt] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const set = <K extends keyof GenOptions>(k: K, v: GenOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));

  const checkHealth = useCallback(async (s: Settings) => {
    if (!s.workerUrl) return setHealth(null);
    try {
      const h = await callWorker<{ meshy: boolean; tripo: boolean }>(s, "/health");
      setHealth(h);
      setOpts((o) => (h[o.provider] ? o : { ...o, provider: h.meshy ? "meshy" : "tripo" }));
    } catch {
      setHealth(null);
    }
  }, []);

  useEffect(() => {
    const s = loadSettings();
    setSettings(s);
    setHistory(loadHistory());
    if (!s.workerUrl || !s.accessToken) setSettingsOpen(true);
    checkHealth(s);
  }, [checkHealth]);

  const showBlob = useCallback((blob: Blob, format: "glb" | "fbx") => {
    setViewUrl((old) => {
      if (old?.startsWith("blob:")) URL.revokeObjectURL(old);
      return URL.createObjectURL(blob);
    });
    setViewFormat(format);
    setStats(null);
  }, []);

  async function openItem(item: HistoryItem) {
    setError(null);
    setCurrent(item);
    setOpts(item.options);
    setMode(item.options.finish === "white" ? "clay" : "textured");
    try {
      setStage("Carregando modelo");
      setBusy(true);
      showBlob(await fetchFile(settings, item.result.glbUrl), "glb");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setStage("");
    }
  }

  async function onGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!opts.description.trim() || busy) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const result: GenResult = await generate(settings, opts, {
        onProgress: (p) => setProgress(Math.min(99, p)),
        onStage: setStage,
        signal: ctrl.signal,
      });
      setStage("Carregando no visualizador");
      const blob = await fetchFile(settings, result.glbUrl, ctrl.signal);
      const item: HistoryItem = { id: result.taskId, createdAt: Date.now(), options: opts, result };
      setHistory(pushHistory(item));
      setCurrent(item);
      setMode(opts.finish === "white" ? "clay" : "textured");
      showBlob(blob, "glb");
      setProgress(100);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      setBusy(false);
      setStage("");
      abortRef.current = null;
    }
  }

  async function download(kind: "glb" | "fbx" | "obj") {
    if (!current) return;
    const { result, options } = current;
    const name = `${slug(options.description)}.${kind}`;
    setDownloading(kind);
    setError(null);
    try {
      let url = kind === "glb" ? result.glbUrl : kind === "fbx" ? result.fbxUrl : result.objUrl;
      if (kind === "fbx" && !url && result.provider === "tripo") {
        const ctrl = new AbortController();
        url = await tripoToFbx(settings, result, options, {
          onProgress: () => {},
          onStage: () => {},
          signal: ctrl.signal,
        });
        const updated = { ...current, result: { ...result, fbxUrl: url } };
        setCurrent(updated);
        setHistory(pushHistory(updated));
      }
      if (!url) throw new Error(`Formato .${kind.toUpperCase()} não disponível para este modelo`);
      saveBlob(await fetchFile(settings, url), name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloading(null);
    }
  }

  function openLocal(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCurrent(null);
    showBlob(file, file.name.toLowerCase().endsWith(".fbx") ? "fbx" : "glb");
    e.target.value = "";
  }

  const finalPrompt = useMemo(() => (opts.description.trim() ? buildPrompt(opts) : ""), [opts]);
  const connected = !!health;
  const isFigure = opts.category === "character";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-zinc-800/80 px-4 py-3 md:px-6">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-lg font-black">
            3D
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight md:text-lg">Gerador de Ativos 3D</h1>
            <p className="hidden text-xs text-zinc-500 sm:block">Texto → modelo 3D pronto para Unreal, Unity e Godot</p>
          </div>
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-1.5 text-sm hover:border-zinc-600"
        >
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-amber-400"}`} />
          {connected ? "Conectado" : "Configurar"}
        </button>
      </header>

      <main className="flex flex-1 flex-col gap-4 p-4 md:p-6 lg:flex-row">
        <form onSubmit={onGenerate} className="flex w-full flex-col gap-5 lg:w-[400px] lg:shrink-0">
          <div className="flex flex-col gap-5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <Field label="Motor de IA">
              <Segmented
                value={opts.provider}
                onChange={(v) => set("provider", v)}
                options={[
                  { id: "meshy", label: "Meshy", disabled: health ? !health.meshy : false },
                  { id: "tripo", label: "Tripo3D", disabled: health ? !health.tripo : false },
                ]}
              />
            </Field>

            <Field label="Tipo de ativo">
              <div className="grid grid-cols-3 gap-1.5">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    title={c.hint}
                    onClick={() => set("category", c.id)}
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

            <Field label="Descrição e especificações" hint={`${opts.description.length}/450`}>
              <textarea
                value={opts.description}
                maxLength={450}
                onChange={(e) => set("description", e.target.value)}
                rows={5}
                placeholder={
                  isFigure
                    ? "Ex.: guerreiro viking adulto, alto e musculoso, barba ruiva trançada, armadura de couro com placas de ferro, capa de pele, botas, machado nas costas"
                    : "Ex.: baú de tesouro medieval de madeira escura com reforços de ferro e cadeado dourado"
                }
                className="resize-y rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm outline-none placeholder:text-zinc-600 focus:border-indigo-500"
              />
              <p className="text-xs text-zinc-500">
                Detalhe idade, corpo, roupas, acessórios e proporções. Escrever em inglês costuma dar resultados melhores.
              </p>
            </Field>

            <Field label="Acabamento">
              <Segmented
                value={opts.finish}
                onChange={(v) => set("finish", v)}
                options={[
                  { id: "color", label: "Colorido (PBR)" },
                  { id: "white", label: "Só o modelo (branco)" },
                ]}
              />
            </Field>

            {opts.finish === "color" && (
              <Field label="Cores e materiais" hint="opcional">
                <input
                  value={opts.colorNotes}
                  maxLength={300}
                  onChange={(e) => set("colorNotes", e.target.value)}
                  placeholder="Ex.: armadura marrom gasta, detalhes dourados, capa vermelha"
                  className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm outline-none placeholder:text-zinc-600 focus:border-indigo-500"
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
                    <option value="a-pose">A-pose (padrão rig)</option>
                    <option value="t-pose">T-pose</option>
                  </select>
                </Field>
              )}
            </div>

            <details className="group rounded-lg border border-zinc-800 p-3">
              <summary className="cursor-pointer select-none text-sm font-medium text-zinc-300">Ajustes técnicos</summary>
              <div className="mt-4 flex flex-col gap-4">
                <Field label="Polígonos" hint={opts.polycount.toLocaleString("pt-BR")}>
                  <input
                    type="range"
                    min={1000}
                    max={300000}
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
                        className={`flex-1 rounded-md border px-2 py-1 text-xs ${
                          opts.polycount === p.value ? "border-indigo-500 text-white" : "border-zinc-800 text-zinc-400"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Topologia">
                  <Segmented
                    value={opts.topology}
                    onChange={(v) => set("topology", v)}
                    options={[
                      { id: "quad", label: "Quads (animação)" },
                      { id: "triangle", label: "Triângulos" },
                    ]}
                  />
                </Field>
                <button type="button" onClick={() => setShowPrompt((v) => !v)} className="text-left text-xs text-indigo-400">
                  {showPrompt ? "Ocultar" : "Ver"} prompt enviado à IA
                </button>
                {showPrompt && (
                  <p className="rounded-md bg-zinc-950 p-2 font-mono text-[11px] leading-relaxed text-zinc-400">
                    {finalPrompt || "Escreva a descrição primeiro."}
                  </p>
                )}
              </div>
            </details>

            {busy && abortRef.current ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="rounded-lg border border-zinc-700 px-4 py-2.5 font-semibold hover:bg-zinc-800"
              >
                Cancelar
              </button>
            ) : (
              <button
                disabled={busy || !opts.description.trim() || !connected}
                className="rounded-lg bg-gradient-to-r from-indigo-600 to-fuchsia-600 px-4 py-2.5 font-semibold shadow-lg shadow-indigo-900/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {connected ? "Gerar modelo 3D" : "Configure a conexão primeiro"}
              </button>
            )}
            {error && <p className="rounded-md bg-red-500/10 p-2 text-sm text-red-300">{error}</p>}
          </div>

          {history.length > 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <h2 className="mb-3 text-sm font-semibold text-zinc-300">Seus modelos</h2>
              <div className="grid grid-cols-4 gap-2">
                {history.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    title={h.options.description}
                    onClick={() => openItem(h)}
                    disabled={busy}
                    className={`aspect-square overflow-hidden rounded-lg border bg-zinc-950 ${
                      current?.id === h.id ? "border-indigo-500" : "border-zinc-800 hover:border-zinc-600"
                    }`}
                  >
                    {h.result.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={h.result.thumbnail} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-[10px] text-zinc-500">{h.options.description.slice(0, 24)}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </form>

        <section className="relative flex min-h-[60vh] flex-1 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-[#141417]">
          <div className="relative flex-1">
            <ModelViewer
              url={viewUrl}
              format={viewFormat}
              mode={mode}
              autoRotate={autoRotate}
              showGrid={showGrid}
              onStats={setStats}
            />

            {!viewUrl && !busy && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-zinc-500">
                <p className="text-lg text-zinc-300">Seu modelo aparece aqui</p>
                <p className="text-sm">Arraste para girar 360°, role para dar zoom, botão direito para mover.</p>
              </div>
            )}

            {busy && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-zinc-950/70 p-6 backdrop-blur-sm">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-zinc-700 border-t-indigo-500" />
                <p className="font-medium">{stage || "Processando"}</p>
                {progress > 0 && (
                  <div className="w-64 max-w-full">
                    <div className="h-1.5 overflow-hidden rounded bg-zinc-800">
                      <div className="h-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} />
                    </div>
                    <p className="mt-1 text-center text-xs text-zinc-400">{Math.round(progress)}% · costuma levar de 1 a 5 minutos</p>
                  </div>
                )}
              </div>
            )}

            <div className="absolute left-3 top-3 flex flex-wrap gap-1 rounded-lg bg-zinc-900/90 p-1 text-xs">
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
                  className={`rounded-md px-2.5 py-1 ${mode === id ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-white"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="absolute right-3 top-3 flex gap-1 rounded-lg bg-zinc-900/90 p-1 text-xs">
              <button onClick={() => setShowGrid((v) => !v)} className={`rounded-md px-2.5 py-1 ${showGrid ? "text-white" : "text-zinc-500"}`}>
                Grade
              </button>
              <button onClick={() => setAutoRotate((v) => !v)} className={`rounded-md px-2.5 py-1 ${autoRotate ? "text-white" : "text-zinc-500"}`}>
                Girar
              </button>
            </div>

            {stats && viewUrl && (
              <div className="absolute bottom-3 left-3 grid grid-cols-2 gap-x-4 gap-y-0.5 rounded-lg bg-zinc-900/90 px-3 py-2 font-mono text-[11px] text-zinc-400">
                <span>Triângulos</span>
                <span className="text-right text-zinc-200">{Math.round(stats.triangles).toLocaleString("pt-BR")}</span>
                <span>Vértices</span>
                <span className="text-right text-zinc-200">{stats.vertices.toLocaleString("pt-BR")}</span>
                <span>Materiais</span>
                <span className="text-right text-zinc-200">{stats.materials}</span>
                <span>Texturas</span>
                <span className="text-right text-zinc-200">{stats.textures}</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 p-3">
            {current ? (
              <>
                <span className="mr-auto truncate text-sm text-zinc-400">
                  {current.options.finish === "white" ? "Modelo branco" : "Colorido PBR"} · {current.result.provider === "tripo" ? "Tripo3D" : "Meshy"}
                </span>
                <button
                  onClick={() => download("fbx")}
                  disabled={!!downloading}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
                >
                  {downloading === "fbx" ? "Preparando..." : "Baixar .FBX"}
                  <span className="ml-1 hidden font-normal opacity-80 sm:inline">Unreal / Unity</span>
                </button>
                <button
                  onClick={() => download("glb")}
                  disabled={!!downloading}
                  className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold hover:bg-sky-500 disabled:opacity-50"
                >
                  {downloading === "glb" ? "Preparando..." : "Baixar .GLB"}
                  <span className="ml-1 hidden font-normal opacity-80 sm:inline">Godot / Web</span>
                </button>
                {current.result.objUrl && (
                  <button
                    onClick={() => download("obj")}
                    disabled={!!downloading}
                    className="rounded-lg border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50"
                  >
                    .OBJ
                  </button>
                )}
              </>
            ) : (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200">
                <span className="rounded-md border border-zinc-700 px-3 py-1.5">Abrir .GLB / .FBX do computador</span>
                <input type="file" accept=".glb,.gltf,.fbx" onChange={openLocal} className="hidden" />
              </label>
            )}
          </div>
        </section>
      </main>

      <SettingsDialog
        open={settingsOpen}
        initial={settings}
        onClose={() => setSettingsOpen(false)}
        onSaved={(s, h) => {
          setSettings(s);
          setHealth(h);
          if (h) setOpts((o) => (h[o.provider] ? o : { ...o, provider: h.meshy ? "meshy" : "tripo" }));
        }}
      />
    </div>
  );
}
