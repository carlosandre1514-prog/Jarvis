import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT || 4000),
  meshyKey: process.env.MESHY_API_KEY || "",
  tripoKey: process.env.TRIPO_API_KEY || "",
  blenderPath: process.env.BLENDER_PATH || "blender",
  tempDir: path.resolve(process.env.TEMP_DIR || path.join(here, "..", "temp")),
  blenderScript: path.resolve(here, "..", "..", "blender", "process_mesh.py"),
};
