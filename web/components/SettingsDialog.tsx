"use client";

import { useEffect, useState } from "react";
import { callWorker } from "@/lib/providers";
import { saveSettings, type Settings } from "@/lib/settings";

type Health = { meshy: boolean; tripo: boolean };

export default function SettingsDialog({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: Settings;
  onClose: () => void;
  onSaved: (s: Settings, h: Health | null) => void;
}) {
  const [form, setForm] = useState(initial);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(initial);
      setStatus(null);
    }
  }, [open, initial]);

  if (!open) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const s = { workerUrl: form.workerUrl.trim().replace(/\/+$/, ""), accessToken: form.accessToken.trim() };
    setTesting(true);
    setStatus(null);
    try {
      const h = await callWorker<Health & { needsToken: boolean }>(s, "/health");
      await callWorker(s, "/auth"); // /health é público; /auth confirma a senha
      const engines = [h.meshy && "Meshy", h.tripo && "Tripo3D"].filter(Boolean).join(" e ");
      if (!engines) throw new Error("Worker sem nenhuma chave de API configurada.");
      saveSettings(s);
      onSaved(s, h);
      setStatus({ ok: true, text: `Conectado! Motores disponíveis: ${engines}.` });
      setTimeout(onClose, 900);
    } catch (err) {
      setStatus({ ok: false, text: (err as Error).message || "Não foi possível conectar ao Worker." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl"
      >
        <div>
          <h2 className="text-lg font-bold">Conexão</h2>
          <p className="text-sm text-zinc-400">
            As chaves das IAs ficam guardadas no seu Worker do Cloudflare, nunca no site. Aqui você só informa o endereço e a
            senha. Fica salvo neste navegador.
          </p>
        </div>
        <label className="flex flex-col gap-1.5 text-sm">
          Endereço do Worker
          <input
            value={form.workerUrl}
            onChange={(e) => setForm({ ...form, workerUrl: e.target.value })}
            placeholder="https://gerador-3d-proxy.SEU-NOME.workers.dev"
            className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 outline-none focus:border-indigo-500"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          Senha de acesso (ACCESS_TOKEN)
          <input
            type="password"
            value={form.accessToken}
            onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
            className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 outline-none focus:border-indigo-500"
          />
        </label>
        {status && (
          <p className={`rounded-md p-2 text-sm ${status.ok ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"}`}>
            {status.text}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-white">
            Fechar
          </button>
          <button
            disabled={testing || !form.workerUrl.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
          >
            {testing ? "Testando..." : "Salvar e testar"}
          </button>
        </div>
      </form>
    </div>
  );
}
