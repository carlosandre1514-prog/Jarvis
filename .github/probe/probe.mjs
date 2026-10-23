import { Client } from "@gradio/client";
const api = (p) => fetch("https://huggingface.co/api/" + p).then((r) => r.json());

const onlyList = process.argv.length <= 2;
if (onlyList) console.log("=== Spaces 3D populares ===");
if (onlyList) for (const q of ["3d", "trellis", "hunyuan3d", "text-to-3d", "image-to-3d"]) {
  const list = await api(`spaces?search=${q}&sort=likes&direction=-1&limit=15&full=true`);
  for (const s of list) console.log(q.padEnd(12), String(s.likes).padStart(5), s.id, s.runtime?.stage ?? "", s.runtime?.hardware?.current ?? "", s.sdk);
}

const targets = process.argv.slice(2);
for (const id of targets) {
  console.log(`\n=== ${id} ===`);
  try {
    const info = await api(`spaces/${id}?full=true`);
    console.log("stage:", info.runtime?.stage, "hw:", info.runtime?.hardware?.current, "sdk:", info.sdk, info.sdkVersion);
    const c = await Client.connect(id);
    const v = await c.view_api();
    for (const [name, ep] of Object.entries(v.named_endpoints)) {
      console.log(" endpoint", name);
      for (const p of ep.parameters) console.log("   in ", p.parameter_name, "|", p.python_type?.type, "| default:", JSON.stringify(p.parameter_default)?.slice(0, 60));
      for (const r of ep.returns) console.log("   out", r.label, "|", r.python_type?.type, "|", r.component);
    }
  } catch (e) {
    console.log("ERRO:", e.message);
  }
}
process.exit(0); // o cliente Gradio mantém conexões abertas
