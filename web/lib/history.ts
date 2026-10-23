"use client";

import type { GenOptions } from "./prompt";

/** Modelo salvo no próprio aparelho (IndexedDB), porque os links do Hugging Face são temporários. */
export interface HistoryItem {
  id: string;
  createdAt: number;
  options: GenOptions;
  engine: string;
  triangles: number;
  thumbnail: Blob | null;
  glb: Blob;
}

const DB = "gerador3d";
const STORE = "modelos";
const MAX = 12;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

export async function loadHistory(): Promise<HistoryItem[]> {
  try {
    const all = await tx<HistoryItem[]>("readonly", (s) => s.getAll() as IDBRequest<HistoryItem[]>);
    return all.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export async function saveHistory(item: HistoryItem): Promise<HistoryItem[]> {
  try {
    await tx("readwrite", (s) => s.put(item));
    const all = await loadHistory();
    for (const old of all.slice(MAX)) await tx("readwrite", (s) => s.delete(old.id));
    return all.slice(0, MAX);
  } catch {
    return [item];
  }
}

export async function deleteHistory(id: string): Promise<HistoryItem[]> {
  try {
    await tx("readwrite", (s) => s.delete(id));
  } catch {
    /* sem armazenamento */
  }
  return loadHistory();
}
