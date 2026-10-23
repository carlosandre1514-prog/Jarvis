// Teste real: imagem fixa -> 3D (Hunyuan3D-2 colorido / TRELLIS), CORS e conteúdo do GLB
import { Client, handle_file } from "@gradio/client";
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const which = process.argv[2];
const IMG = "https://raw.githubusercontent.com/carlosandre1514-prog/Jarvis/ccr-5f814887-v5p016/.github/probe/test.png";
const ORIGIN = "https://carlosandre1514-prog.github.io";
const unwrap = (d) => (d && d.value && d.__type__ ? d.value : d);

async function inspect(url) {
  const r = await fetch(url, { headers: { Origin: ORIGIN } });
  const buf = new Uint8Array(await r.arrayBuffer());
  let info = `${r.status} bytes=${buf.length} acao=${r.headers.get("access-control-allow-origin")}`;
  if (buf[0] === 0x67 && buf[1] === 0x6c) {
    const len = new DataView(buf.buffer).getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(buf.slice(20, 20 + len)));
    info += ` meshes=${json.meshes?.length} materials=${json.materials?.length} images=${json.images?.length} textures=${json.textures?.length}`;
    info += ` mat0=${JSON.stringify(json.materials?.[0]).slice(0, 300)}`;
    info += ` attrs=${JSON.stringify(json.meshes?.[0]?.primitives?.[0]?.attributes)}`;
  }
  return info;
}

async function run(space, ep, args) {
  const c = await Client.connect(space, { events: ["data", "status", "log"] });
  const sub = c.submit(ep, args);
  for await (const m of sub) {
    log("msg", m.type, JSON.stringify(m).slice(0, 400));
    if (m.type === "data") {
      const data = m.data.map(unwrap);
      log("dados:", JSON.stringify(data).slice(0, 1200));
      for (const d of data) if (d && d.url) log("arquivo:", d.orig_name, await inspect(d.url));
      return data;
    }
  }
  log("iterador terminou sem dados");
}

try {
  if (which === "flux-cors") {
    const flux = await Client.connect("black-forest-labs/FLUX.1-schnell");
    const r = await flux.predict("/infer", { prompt: "red apple, white background", seed: 1, randomize_seed: false, width: 512, height: 512, num_inference_steps: 4 });
    log("flux:", await inspect(unwrap(r.data[0]).url));
  }
  if (which === "hunyuan-all") {
    await run("tencent/Hunyuan3D-2", "/generation_all", {
      caption: "", image: handle_file(IMG), mv_image_front: null, mv_image_back: null, mv_image_left: null, mv_image_right: null,
      steps: 30, guidance_scale: 5, seed: 1234, octree_resolution: 256, check_box_rembg: true, num_chunks: 8000, randomize_seed: true,
    });
  }
  if (which === "hunyuan21-all") {
    await run("tencent/Hunyuan3D-2.1", "/generation_all", {
      image: handle_file(IMG), mv_image_front: null, mv_image_back: null, mv_image_left: null, mv_image_right: null,
      steps: 30, guidance_scale: 5, seed: 1234, octree_resolution: 256, check_box_rembg: true, num_chunks: 8000, randomize_seed: true,
    });
  }
  if (which === "trellis") {
    const c = await Client.connect("trellis-community/TRELLIS");
    try { await c.predict("/start_session", {}); log("sessao ok"); } catch (e) { log("start_session:", e?.message); }
    const pre = await c.predict("/preprocess_image", { image: handle_file(IMG) });
    const img = unwrap(pre.data[0]);
    log("pre:", JSON.stringify(img).slice(0, 200));
    const sub = c.submit("/generate_and_extract_glb", {
      image: handle_file(img.url), multiimages: [], seed: 0, ss_guidance_strength: 7.5, ss_sampling_steps: 12,
      slat_guidance_strength: 3, slat_sampling_steps: 12, multiimage_algo: "stochastic", mesh_simplify: 0.95, texture_size: 1024,
    });
    for await (const m of sub) {
      if (m.type === "status") log("status", m.stage, m.message || "");
      if (m.type === "data") {
        const data = m.data.map(unwrap);
        log("dados:", JSON.stringify(data).slice(0, 1200));
        for (const d of data) if (d && d.url) log("arquivo:", d.orig_name, await inspect(d.url));
        break;
      }
    }
  }
} catch (e) {
  log("ERRO:", e?.message || JSON.stringify(e).slice(0, 800));
}
process.exit(0);
