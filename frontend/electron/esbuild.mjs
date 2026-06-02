import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const watch = process.argv.includes("--watch");
const isProduction = process.env.NODE_ENV === "production";

const sharedOptions = {
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  sourcemap: true,
  minify: isProduction,
  external: ["electron"],
  logLevel: "info",
};

const mainBuild = {
  ...sharedOptions,
  entryPoints: [path.join(rootDir, "electron/src/main.ts")],
  outfile: path.join(rootDir, "build/electron/main.js"),
};

if (watch) {
  const ctx = await esbuild.context(mainBuild);
  await ctx.watch();
  console.log("[electron] watching build/electron/main.js");
} else {
  await esbuild.build(mainBuild);
  console.log("[electron] built build/electron/main.js");
}
