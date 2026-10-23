"use client";

const KEY = "gerador3d.hfToken";

/** Token grátis do Hugging Face (opcional): aumenta a cota diária de GPU. Fica só neste aparelho. */
export function loadToken(): string {
  try {
    return localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}

export function saveToken(token: string) {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage indisponível */
  }
}
