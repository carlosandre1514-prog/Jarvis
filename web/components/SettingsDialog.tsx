"use client";

import { useEffect, useState } from "react";
import { saveToken } from "@/lib/settings";

export default function SettingsDialog({
  open,
  token,
  onClose,
  onSaved,
}: {
  open: boolean;
  token: string;
  onClose: () => void;
  onSaved: (token: string) => void;
}) {
  const [value, setValue] = useState(token);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(token);
      setError(null);
    }
  }, [open, token]);

  if (!open) return null;

  function save(e: React.FormEvent) {
    e.preventDefault();
    const t = value.trim();
    if (t && !t.startsWith("hf_")) return setError('O token do Hugging Face começa com "hf_".');
    saveToken(t);
    onSaved(t);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl sm:rounded-2xl"
      >
        <div>
          <h2 className="text-lg font-bold">Mais gerações por dia (opcional)</h2>
          <p className="mt-1 text-sm text-zinc-400">
            O site usa a GPU grátis do Hugging Face. Sem login, ela dá poucas gerações por dia. Com um token de uma conta
            gratuita, a cota aumenta. Não precisa de cartão e não tem custo.
          </p>
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-300">
          <li>
            Crie uma conta grátis em{" "}
            <a className="text-indigo-400 underline" href="https://huggingface.co/join" target="_blank" rel="noreferrer">
              huggingface.co/join
            </a>
          </li>
          <li>
            Abra{" "}
            <a className="text-indigo-400 underline" href="https://huggingface.co/settings/tokens/new?tokenType=read" target="_blank" rel="noreferrer">
              Settings → Access Tokens → New token
            </a>
          </li>
          <li>Escolha o tipo &quot;Read&quot;, crie e copie o token</li>
          <li>Cole abaixo e salve</li>
        </ol>
        <label className="flex flex-col gap-1.5 text-sm">
          Token do Hugging Face
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="hf_..."
            autoComplete="off"
            className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 outline-none focus:border-indigo-500"
          />
        </label>
        <p className="text-xs text-zinc-500">Fica salvo só neste aparelho e é enviado apenas ao Hugging Face.</p>
        {error && <p className="rounded-md bg-red-500/10 p-2 text-sm text-red-300">{error}</p>}
        <div className="flex justify-end gap-2">
          {token && (
            <button
              type="button"
              onClick={() => {
                saveToken("");
                onSaved("");
                onClose();
              }}
              className="mr-auto rounded-lg px-3 py-2 text-sm text-red-400 hover:text-red-300"
            >
              Remover
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-white">
            Fechar
          </button>
          <button className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500">Salvar</button>
        </div>
      </form>
    </div>
  );
}
