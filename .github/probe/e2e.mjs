// Teste ponta a ponta do site real (build estático) num Chromium de verdade, com a IA grátis real.
import { chromium } from "playwright";
const mode = process.argv[2]; // white | color
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const shot = async (p, name) => {
  const b = await p.screenshot({ type: "jpeg", quality: 45 });
  console.log(`SHOT ${name} ${b.toString("base64")}`);
};

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && errs.push("console: " + m.text().slice(0, 300)));
try {
  await page.goto(process.env.SITE_URL || "http://localhost:5050/Jarvis/");
  await page.fill("textarea", "viking warrior, adult man, braided red beard, leather armor with iron plates, fur cape, leather boots, axe on his back");
  if (mode === "white") await page.click("button:has-text('Só o modelo (branco)')");
  else await page.fill("input[placeholder*='couro']", "brown leather, silver iron, red cape");
  if (mode === "upload") await page.setInputFiles("input[accept='image/*']", "test.png");
  else await page.click("button:has-text('Gerar imagem de referência')");
  await page.waitForFunction(() => !!document.querySelector("img[alt='Imagem de referência']") || document.body.innerText.includes("cota"), null, { timeout: 180000 });
  log("imagem pronta");
  await page.waitForTimeout(1500);
  const ref = page.locator("img[alt='Imagem de referência']");
  if (await ref.count()) {
    const b = await ref.screenshot({ type: "jpeg", quality: 50 });
    console.log(`SHOT ref-${mode} ${b.toString("base64")}`);
  }
  await page.click("button:has-text('Transformar em 3D')");
  const t3 = Date.now();
  let last = "";
  for (;;) {
    const txt = await page.locator("body").innerText();
    if (txt.includes("Baixar .FBX")) break;
    const err = await page.locator(".text-red-300").allInnerTexts();
    if (err.length) throw new Error("erro no site: " + err.join(" | "));
    const stage = txt.split("\n").filter((l) => /Esculpindo|Na fila|Baixando|Otimizando|Ligando|motor/.test(l)).join(" / ");
    if (stage !== last) log("etapa:", stage);
    last = stage;
    if (Date.now() - t3 > 9 * 60000) throw new Error("tempo esgotado");
    await page.waitForTimeout(2000);
  }
  log(`3D pronto em ${((Date.now() - t3) / 1000).toFixed(0)}s`);
  await page.waitForTimeout(4000);
  await page.locator("section").last().scrollIntoViewIfNeeded();
  await shot(page, `modelo-${mode}`);
  log("stats:", (await page.locator(".font-mono").allInnerTexts()).join(" ").replace(/\s+/g, " "));
  for (const kind of ["GLB", "FBX"]) {
    const dl = page.waitForEvent("download", { timeout: 60000 });
    await page.click(`button:has-text('Baixar .${kind}')`);
    const d = await dl;
    const path = `/tmp/${mode}.${kind.toLowerCase()}`;
    await d.saveAs(path);
    const { statSync } = await import("node:fs");
    log(`download ${d.suggestedFilename()} ${statSync(path).size} bytes`);
  }
  await page.click("button:has-text('Argila')");
  await page.waitForTimeout(1500);
  await shot(page, `argila-${mode}`);
} catch (e) {
  log("FALHOU:", e.message);
  await shot(page, `falha-${mode}`).catch(() => {});
}
log("erros do navegador:", JSON.stringify(errs).slice(0, 1500));
await browser.close();
process.exit(0);
