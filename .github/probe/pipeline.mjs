// Teste real do fluxo grátis: texto -> imagem (FLUX) -> 3D (Hunyuan3D-2 / TRELLIS)
import { Client, handle_file } from "@gradio/client";
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const which = process.argv[2];
const prompt =
  "full body 3D character, viking warrior with red braided beard and leather armor, standing in A-pose, " +
  "entire figure visible from head to toe, centered, plain white background, soft studio lighting, 3D render";

async function head(url) {
  const r = await fetch(url, { method: "HEAD" });
  return `${r.status} ${r.headers.get("content-type")} ${r.headers.get("content-length")} cors=${r.headers.get("access-control-allow-origin")}`;
}

try {
  log("FLUX conectando");
  const flux = await Client.connect("black-forest-labs/FLUX.1-schnell");
  const img = await flux.predict("/infer", { prompt, seed: 0, randomize_seed: true, width: 768, height: 1024, num_inference_steps: 4 });
  const image = img.data[0];
  log("FLUX ok:", JSON.stringify(image).slice(0, 300));
  log("imagem:", await head(image.url));

  if (which === "hunyuan-shape" || which === "hunyuan-all") {
    const hy = await Client.connect("tencent/Hunyuan3D-2");
    const ep = which === "hunyuan-shape" ? "/shape_generation" : "/generation_all";
    const sub = hy.submit(ep, {
      caption: "", image: handle_file(image.url), mv_image_front: null, mv_image_back: null, mv_image_left: null, mv_image_right: null,
      steps: 30, guidance_scale: 5, seed: 1234, octree_resolution: 256, check_box_rembg: true, num_chunks: 8000, randomize_seed: true,
    });
    for await (const m of sub) {
      if (m.type === "status") log("status", m.stage, m.queue ? `fila ${m.position}/${m.queue_size} eta ${m.eta}` : "", m.message || "", m.progress_data ? JSON.stringify(m.progress_data) : "");
      if (m.type === "data") {
        log("dados:", JSON.stringify(m.data).slice(0, 1500));
        for (const d of m.data) if (d && d.url) log("arquivo:", d.url, await head(d.url));
        break;
      }
    }
  }

  if (which === "trellis") {
    const tr = await Client.connect("trellis-community/TRELLIS");
    await tr.predict("/start_session", {}).catch((e) => log("start_session:", e.message));
    const pre = await tr.predict("/preprocess_image", { image: handle_file(image.url) });
    log("pre:", JSON.stringify(pre.data).slice(0, 300));
    const sub = tr.submit("/generate_and_extract_glb", {
      image: handle_file(pre.data[0].url), multiimages: [], seed: 0, ss_guidance_strength: 7.5, ss_sampling_steps: 12,
      slat_guidance_strength: 3, slat_sampling_steps: 12, multiimage_algo: "stochastic", mesh_simplify: 0.95, texture_size: 1024,
    });
    for await (const m of sub) {
      if (m.type === "status") log("status", m.stage, m.message || "");
      if (m.type === "data") {
        log("dados:", JSON.stringify(m.data).slice(0, 1500));
        for (const d of m.data) if (d && d.url) log("arquivo:", d.url, await head(d.url));
        break;
      }
    }
  }
} catch (e) {
  log("ERRO:", e?.message || JSON.stringify(e).slice(0, 800));
}
process.exit(0);
