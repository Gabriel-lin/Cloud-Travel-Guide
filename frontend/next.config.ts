import type { NextConfig } from "next";

const isElectronBuild = process.env.ELECTRON_BUILD === "true";

const nextConfig: NextConfig = {
  // Electron dev loads http://127.0.0.1:3000 — allow HMR / dev assets from that origin
  allowedDevOrigins: ["127.0.0.1"],
  ...(isElectronBuild
    ? {
        output: "export",
        distDir: "out",
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
