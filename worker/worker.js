/**
 * Proxy seguro para o Gerador 3D (Cloudflare Worker).
 *
 * O site no GitHub Pages é estático: não pode guardar chaves de API sem expô-las.
 * Este Worker guarda as chaves como "secrets" e só atende quem enviar a senha de acesso.
 *
 * Variáveis (Settings > Variables and Secrets no painel do Cloudflare):
 *   ACCESS_TOKEN    (secret)  senha que você digita no site
 *   MESHY_API_KEY   (secret)  chave da Meshy   (opcional se usar só Tripo)
 *   TRIPO_API_KEY   (secret)  chave da Tripo3D (opcional se usar só Meshy)
 *   ALLOWED_ORIGIN  (texto)   ex.: https://SEU-USUARIO.github.io  (padrão: *)
 *
 * Rotas:
 *   GET  /health                       quais provedores estão configurados
 *   GET  /auth                         confere a senha de acesso
 *   POST /meshy/text-to-3d             cria tarefa na Meshy
 *   GET  /meshy/text-to-3d/:id         consulta tarefa na Meshy
 *   POST /tripo/task                   cria tarefa na Tripo3D
 *   GET  /tripo/task/:id               consulta tarefa na Tripo3D
 *   GET  /download?url=https://...     baixa o arquivo 3D gerado (contorna CORS)
 */

const MESHY = "https://api.meshy.ai/openapi/v2/text-to-3d";
const TRIPO = "https://api.tripo3d.ai/v2/openapi/task";

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, "");

      if (path === "/health") {
        return json(
          { ok: true, meshy: !!env.MESHY_API_KEY, tripo: !!env.TRIPO_API_KEY, needsToken: !!env.ACCESS_TOKEN },
          200,
          cors
        );
      }

      if (env.ACCESS_TOKEN && request.headers.get("X-Access-Token") !== env.ACCESS_TOKEN) {
        return json({ error: "Senha de acesso inválida" }, 401, cors);
      }

      if (path === "/auth") return json({ ok: true }, 200, cors);

      let m;
      if (path === "/meshy/text-to-3d" && request.method === "POST") {
        return forward(MESHY, request, env.MESHY_API_KEY, "Meshy", cors);
      }
      if ((m = path.match(/^\/meshy\/text-to-3d\/([\w-]+)$/)) && request.method === "GET") {
        return forward(`${MESHY}/${m[1]}`, request, env.MESHY_API_KEY, "Meshy", cors);
      }
      if (path === "/tripo/task" && request.method === "POST") {
        return forward(TRIPO, request, env.TRIPO_API_KEY, "Tripo3D", cors);
      }
      if ((m = path.match(/^\/tripo\/task\/([\w-]+)$/)) && request.method === "GET") {
        return forward(`${TRIPO}/${m[1]}`, request, env.TRIPO_API_KEY, "Tripo3D", cors);
      }
      if (path === "/download" && request.method === "GET") {
        return download(url.searchParams.get("url"), cors);
      }

      return json({ error: "Rota não encontrada" }, 404, cors);
    } catch (err) {
      return json({ error: String(err && err.message ? err.message : err) }, 500, cors);
    }
  },
};

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGIN || "*").split(",").map((s) => s.trim());
  const origin = request.headers.get("Origin") || "";
  const allow = allowed.includes("*") ? "*" : allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Access-Token",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

async function forward(target, request, apiKey, name, cors) {
  if (!apiKey) return json({ error: `Chave da ${name} não configurada no Worker` }, 400, cors);
  const init = {
    method: request.method,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  };
  if (request.method === "POST") init.body = await request.text();
  const res = await fetch(target, init);
  return new Response(res.body, {
    status: res.status,
    headers: { ...cors, "Content-Type": res.headers.get("Content-Type") || "application/json" },
  });
}

async function download(fileUrl, cors) {
  let target;
  try {
    target = new URL(fileUrl || "");
  } catch {
    return json({ error: "URL inválida" }, 400, cors);
  }
  if (target.protocol !== "https:") return json({ error: "Somente https" }, 400, cors);

  const res = await fetch(target.toString());
  if (!res.ok) return json({ error: `Falha ao baixar (${res.status})` }, res.status, cors);
  return new Response(res.body, {
    status: 200,
    headers: {
      ...cors,
      "Content-Type": res.headers.get("Content-Type") || "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
