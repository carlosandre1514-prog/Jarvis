"use client";

export interface Settings {
  workerUrl: string;
  accessToken: string;
}

const KEY = "gerador3d.settings";

/** URL do Worker definida no build (variável WORKER_URL do repositório), se houver. */
export const DEFAULT_WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || "";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Settings>;
      return { workerUrl: s.workerUrl || DEFAULT_WORKER_URL, accessToken: s.accessToken || "" };
    }
  } catch {
    /* storage indisponível */
  }
  return { workerUrl: DEFAULT_WORKER_URL, accessToken: "" };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage indisponível */
  }
}
