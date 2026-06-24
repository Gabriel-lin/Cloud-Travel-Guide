import type { NextConfig } from "next";

import { resolvePublicEnv } from "./src/config/resolve-env";

const isElectronBuild = process.env.ELECTRON_BUILD === "true";
const devEnv = resolvePublicEnv(process.env.NODE_ENV ?? "development", __dirname);
const devServerHost = new URL(devEnv.ELECTRON_DEV_SERVER_URL).hostname;

const nextConfig: NextConfig = {
  // Electron dev loads Next from ELECTRON_DEV_SERVER_URL — allow HMR from that origin
  allowedDevOrigins: [devServerHost === "localhost" ? "127.0.0.1" : devServerHost],
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
