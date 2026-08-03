/**
 * Dev Electron runner: wait for Next + main/preload build, then start Electron.
 * Restarts Electron when build/electron/*.js changes (main process IPC updates).
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getDevServerWaitTarget } from "./load-env.mjs";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.join(frontendRoot, "build", "electron");

let electronChild = null;
let restartTimer = null;

function startElectron() {
  if (electronChild) {
    electronChild.kill();
    electronChild = null;
  }

  electronChild = spawn("electron", ["."], {
    cwd: frontendRoot,
    stdio: "inherit",
    shell: true,
    env: process.env,
  });

  electronChild.on("exit", (code, signal) => {
    if (signal) return;
    if (code !== null && code !== 0) {
      process.exit(code);
    }
  });
}

function scheduleRestart(reason) {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    console.log(`[electron] restarting (${reason})…`);
    startElectron();
  }, 400);
}

function watchElectronBuild() {
  fs.watch(buildDir, { recursive: true }, (_event, filename) => {
    if (!filename || filename.endsWith(".map")) return;
    if (!/\.(js|cjs|mjs)$/.test(filename)) return;
    // Preload changes require a renderer reload; avoid killing OAuth mid-flight.
    if (filename.endsWith("preload.cjs")) return;
    scheduleRestart(filename);
  });
}

const devServerWaitTarget = getDevServerWaitTarget();

console.log(
  `[electron] waiting for ${devServerWaitTarget} and build/electron/*.js …`,
);

execFileSync(
  "npx",
  [
    "wait-on",
    devServerWaitTarget,
    "build/electron/preload.cjs",
    "build/electron/main.js",
  ],
  { cwd: frontendRoot, stdio: "inherit", shell: true },
);

startElectron();
watchElectronBuild();

process.on("SIGINT", () => {
  if (electronChild) electronChild.kill();
  process.exit(0);
});
