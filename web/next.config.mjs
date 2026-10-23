// Site 100% estático para o GitHub Pages.
// BASE_PATH = "/<nome-do-repositório>" (ex.: /Jarvis).
const basePath = process.env.BASE_PATH || "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  webpack: (config, { webpack, isServer }) => {
    // @gltf-transform/core importa "node:fs" etc. para o modo Node; no navegador não são usados.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
        resource.request = resource.request.replace(/^node:/, "");
      })
    );
    if (!isServer) {
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, url: false, crypto: false };
    }
    return config;
  },
};

export default nextConfig;
