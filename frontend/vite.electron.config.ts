import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, defineConfig, type Plugin } from "vite";

import { resolvePublicEnv, toProcessEnvDefine } from "./src/config/resolve-env";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronDir = path.resolve(__dirname, "electron");
const isProduction = process.env.NODE_ENV === "production";

function createAppEnvDefine(mode: string): Record<string, string> {
  return toProcessEnvDefine(resolvePublicEnv(mode, __dirname));
}

/**
 * 将 electron/*.ts 均作为入口，输出同名 .js（新增文件无需改配置）。
 * preload.ts 除外：sandbox 化的 preload 不能 require 相对路径的共享 chunk，
 * 由 vite.preload.config.ts 单独打成自包含单文件。
 */
function getElectronRollupInput(): Record<string, string> {
  return Object.fromEntries(
    fs
      .readdirSync(electronDir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith(".ts") &&
          entry.name !== "preload.ts",
      )
      .map((entry) => {
        const name = path.parse(entry.name).name;
        return [name, path.join(electronDir, entry.name)];
      }),
  );
}

/**
 * 主进程构建完成后单独打包 preload。
 * preload 运行在 sandbox 中只能 require("electron")，不能加载相对路径的
 * 共享 chunk，因此不能作为多入口之一（rollup 会抽公共 chunk），
 * 必须嵌套一次单入口构建，打成自包含单文件。
 */
function buildPreloadPlugin(appEnvDefine: Record<string, string>): Plugin {
  return {
    name: "build-preload",
    buildStart() {
      // preload.ts 不在主入口里，手动加入 watch，使其改动也触发重建
      this.addWatchFile(path.join(electronDir, "preload.ts"));
    },
    async closeBundle() {
      await build({
        configFile: false,
        publicDir: false,
        logLevel: "warn",
        define: appEnvDefine,
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "src"),
          },
        },
        build: {
          ssr: true,
          outDir: "build/electron",
          emptyOutDir: false,
          minify: isProduction,
          sourcemap: !isProduction,
          target: "node22",
          // 嵌套构建不继承外层 --watch，只做一次性打包
          watch: undefined,
          rollupOptions: {
            input: path.join(electronDir, "preload.ts"),
            output: {
              format: "cjs",
              entryFileNames: "preload.js",
              inlineDynamicImports: true,
            },
            external: ["electron"],
          },
        },
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const appEnvDefine = createAppEnvDefine(mode);

  return {
    plugins: [buildPreloadPlugin(appEnvDefine)],
    define: appEnvDefine,
    publicDir: false,
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    build: {
      ssr: true,
      outDir: "build/electron",
      /** 开发时与 preload watch 并行写同一目录，避免互相清空 */
      emptyOutDir: isProduction,
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
  };
});
