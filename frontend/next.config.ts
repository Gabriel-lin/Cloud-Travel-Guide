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
};

export default nextConfig;
