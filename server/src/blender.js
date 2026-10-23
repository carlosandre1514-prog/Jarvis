import { spawn } from "node:child_process";
import { config } from "./config.js";

/**
 * Executa o Blender em modo headless (--background) com process_mesh.py.
 * O script imprime uma linha "RESULT_JSON:{...}" com as estatísticas.
 */
export function runBlender(args, { onLog } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      config.blenderPath,
      ["--background", "--factory-startup", "--python", config.blenderScript, "--", ...args],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => {
      out += d;
      onLog?.(String(d));
    });
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", (e) =>
      reject(new Error(`Não foi possível executar o Blender (${config.blenderPath}): ${e.message}`))
    );
    proc.on("close", (code) => {
      const line = out.split("\n").find((l) => l.startsWith("RESULT_JSON:"));
      if (code !== 0 || !line) {
        const tail = (err || out).trim().split("\n").slice(-5).join("\n");
        return reject(new Error(`Blender falhou (código ${code}): ${tail}`));
      }
      resolve(JSON.parse(line.slice("RESULT_JSON:".length)));
    });
  });
}
