import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Baixa uma URL para um arquivo local. */
export async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Falha ao baixar modelo (${res.status})`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
}

/** Faz uma requisição JSON e lança erro com a mensagem da API quando falha. */
export async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data.message || data.error || data.raw || res.statusText;
    throw new Error(`API respondeu ${res.status}: ${msg}`);
  }
  return data;
}
