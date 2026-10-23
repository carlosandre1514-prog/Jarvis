const API_URL = process.env.API_URL || "http://localhost:4000";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Encaminha /api/* e /files/* para o backend Express.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_URL}/api/:path*` },
      { source: "/files/:path*", destination: `${API_URL}/files/:path*` },
    ];
  },
};

export default nextConfig;
