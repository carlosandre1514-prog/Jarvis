"use client";

import type { GenOptions } from "./prompt";
import type { GenResult } from "./providers";

export interface HistoryItem {
  id: string;
  createdAt: number;
  options: GenOptions;
  result: GenResult;
}

const KEY = "gerador3d.history";
const MAX = 24;

export function loadHistory(): HistoryItem[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

/** Adiciona (ou atualiza) um item no topo do histórico e devolve a lista nova. */
export function pushHistory(item: HistoryItem): HistoryItem[] {
  const list = [item, ...loadHistory().filter((h) => h.id !== item.id)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage indisponível */
  }
  return list;
}
