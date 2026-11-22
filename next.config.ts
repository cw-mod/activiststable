import type { NextConfig } from "next";

// pages  → GitHub Pages static export at /activiststable
// server → Node standalone for https://activists.miew.ru/
const isPages = process.env.DEPLOY_TARGET === "pages";

const nextConfig: NextConfig = {
  output: isPages ? "export" : "standalone",
  ...(isPages ? { basePath: "/activiststable" } : {}),
  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
