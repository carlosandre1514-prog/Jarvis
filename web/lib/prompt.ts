export type Category = "character" | "creature" | "object" | "weapon" | "vehicle" | "building";
export type Finish = "color" | "white";
export type Style = "realistic" | "stylized" | "cartoon" | "lowpoly";
export type Pose = "a-pose" | "t-pose";
export type Topology = "quad" | "triangle";
export type Provider = "meshy" | "tripo";

export interface GenOptions {
  provider: Provider;
  category: Category;
  description: string;
  colorNotes: string;
  finish: Finish;
  style: Style;
  pose: Pose;
  polycount: number;
  topology: Topology;
}

export const CATEGORIES: { id: Category; label: string; hint: string }[] = [
  { id: "character", label: "Personagem", hint: "Corpo inteiro, da cabeça aos pés" },
  { id: "creature", label: "Criatura", hint: "Monstros, animais, bosses" },
  { id: "object", label: "Objeto", hint: "Props, móveis, itens" },
  { id: "weapon", label: "Arma / Item", hint: "Espadas, armas, equipamentos" },
  { id: "vehicle", label: "Veículo", hint: "Carros, naves, barcos" },
  { id: "building", label: "Construção", hint: "Casas, torres, cenário" },
];

export const STYLES: { id: Style; label: string }[] = [
  { id: "realistic", label: "Realista" },
  { id: "stylized", label: "Estilizado (game art)" },
  { id: "cartoon", label: "Cartoon" },
  { id: "lowpoly", label: "Low poly" },
];

const STYLE_TEXT: Record<Style, string> = {
  realistic: "realistic, highly detailed, physically based materials",
  stylized: "stylized hand-painted game art style, clean shapes",
  cartoon: "cartoon style, exaggerated proportions, smooth shapes",
  lowpoly: "low poly, faceted, simple clean geometry",
};

const CATEGORY_TEXT: Record<Category, (o: GenOptions) => string> = {
  character: (o) =>
    `full body character, entire figure visible from head to toe, standing in ${o.pose === "t-pose" ? "T-pose" : "A-pose"}, ` +
    "arms and legs separated from the body, feet on the ground, front facing, symmetrical",
  creature: () => "full body creature, entire body visible including legs and tail, neutral standing pose",
  object: () => "single isolated object, centered, complete",
  weapon: () => "single isolated item, complete, centered, game prop",
  vehicle: () => "complete vehicle, all wheels and parts visible, isolated",
  building: () => "complete standalone building, isolated, solid base",
};

/** Limite de caracteres de prompt das APIs (Meshy: 600). */
const MAX_PROMPT = 600;

/** Monta o prompt final: as especificações do usuário + modificadores técnicos para game assets. */
export function buildPrompt(o: GenOptions): string {
  const extras = [
    CATEGORY_TEXT[o.category](o),
    STYLE_TEXT[o.style],
    o.finish === "white" ? "untextured clean sculpt, plain white material" : "",
    "game-ready 3D asset",
  ]
    .filter(Boolean)
    .join(", ");
  const room = MAX_PROMPT - extras.length - 2;
  const desc = o.description.trim().replace(/\s+/g, " ").slice(0, Math.max(100, room));
  return `${desc}, ${extras}`.slice(0, MAX_PROMPT);
}

/** O que não queremos no modelo (corpo cortado, várias figuras, chão etc.). */
export function buildNegativePrompt(o: GenOptions): string {
  const base = "low quality, blurry, multiple objects, ground plane, background, text, watermark";
  return o.category === "character" || o.category === "creature"
    ? `${base}, cropped body, missing legs, missing feet, bust only, half body, sitting`
    : base;
}

/** Prompt de textura (cores/materiais) quando o modelo é colorido. */
export function buildTexturePrompt(o: GenOptions): string {
  const notes = o.colorNotes.trim();
  return notes ? `${notes}, ${STYLE_TEXT[o.style]}`.slice(0, MAX_PROMPT) : "";
}
