import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronDir = path.resolve(__dirname, "electron");
const isProduction = process.env.NODE_ENV === "production";

/** 将 electron/*.ts 均作为入口，输出同名 .js（新增文件无需改配置） */
function getElectronRollupInput(): Record<string, string> {
  return Object.fromEntries(
    fs
      .readdirSync(electronDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => {
        const name = path.parse(entry.name).name;
        return [name, path.join(electronDir, entry.name)];
      }),
  );
}

export default defineConfig({
  publicDir: false,
  build: {
    ssr: true,
    outDir: "build/electron",
    emptyOutDir: true,
    minify: isProduction,
    sourcemap: !isProduction,
    target: "node22",
    rollupOptions: {
      input: getElectronRollupInput(),
      output: {
        format: "cjs",
        entryFileNames: "[name].js",
      },
      external: ["electron"],
    },
  },
});
