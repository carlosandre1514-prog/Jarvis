export type Category = "character" | "creature" | "object" | "weapon" | "vehicle" | "building";
export type Finish = "color" | "white";
export type Style = "realistic" | "stylized" | "cartoon" | "lowpoly";
export type Pose = "a-pose" | "t-pose";

export interface GenOptions {
  category: Category;
  description: string;
  colorNotes: string;
  finish: Finish;
  style: Style;
  pose: Pose;
  /** triângulos alvo após a otimização no navegador */
  polycount: number;
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
  stylized: "stylized hand-painted game art style, clean readable shapes",
  cartoon: "cartoon style, exaggerated proportions, smooth shapes",
  lowpoly: "low poly, faceted, simple clean geometry",
};

const CATEGORY_TEXT: Record<Category, (o: GenOptions) => string> = {
  character: (o) =>
    `full body character, entire figure visible from head to toe including both feet, standing in ${
      o.pose === "t-pose" ? "T-pose with arms straight out horizontally" : "A-pose with arms angled down away from the body"
    }, legs slightly apart, front view, symmetrical, neutral expression`,
  creature: () => "full body creature, entire body visible including legs and tail, neutral standing pose, three-quarter view",
  object: () => "single isolated object, complete, three-quarter view",
  weapon: () => "single isolated item, complete, three-quarter view, game prop",
  vehicle: () => "complete vehicle, all wheels and parts visible, three-quarter view",
  building: () => "complete standalone building on a small base, three-quarter view",
};

/**
 * Prompt da imagem de referência (FLUX). O modelo 3D é reconstruído a partir dela,
 * então pedimos um único objeto inteiro, centralizado, em fundo branco liso e luz uniforme.
 */
export function buildImagePrompt(o: GenOptions): string {
  const desc = o.description.trim().replace(/\s+/g, " ");
  const colors = o.finish === "color" && o.colorNotes.trim() ? `colors and materials: ${o.colorNotes.trim()}` : "";
  return [
    `3D game asset render of ${desc}`,
    CATEGORY_TEXT[o.category](o),
    colors,
    STYLE_TEXT[o.style],
    "single subject centered in frame with margin around it, plain pure white background, soft even studio lighting, no cast shadows, no text, no ground, no other objects",
  ]
    .filter(Boolean)
    .join(", ");
}
