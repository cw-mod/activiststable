import type { NextConfig } from "next";

// GitHub Pages: static export only, hosted at https://cw-mod.github.io/activiststable/
const nextConfig: NextConfig = {
  output: "export",
  basePath: "/activiststable",
  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
