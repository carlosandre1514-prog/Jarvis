import { config } from "../config.js";
import * as meshy from "./meshy.js";
import * as tripo from "./tripo.js";

// "demo" não chama IA: o Blender cria um modelo de exemplo, útil para testar o pipeline sem chave.
export const providers = {
  meshy: { label: "Meshy", available: () => !!config.meshyKey, generate: meshy.generate },
  tripo: { label: "Tripo3D", available: () => !!config.tripoKey, generate: tripo.generate },
  demo: { label: "Demo (sem IA, testa o pipeline)", available: () => true, generate: null },
};
