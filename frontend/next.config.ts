import type { NextConfig } from "next";

const isElectronBuild = process.env.ELECTRON_BUILD === "true";

const nextConfig: NextConfig = {
  ...(isElectronBuild
    ? {
        output: "export",
        distDir: "out",
        images: { unoptimized: true },
      }
    : {}),
  // Electron 通过 window.require 在客户端加载，无需 webpack externals
  turbopack: {},
};

export default nextConfig;
