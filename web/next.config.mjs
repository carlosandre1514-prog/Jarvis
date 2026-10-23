// Site 100% estático para o GitHub Pages.
// BASE_PATH = "/<nome-do-repositório>" (o workflow preenche sozinho).
const basePath = process.env.BASE_PATH || "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
