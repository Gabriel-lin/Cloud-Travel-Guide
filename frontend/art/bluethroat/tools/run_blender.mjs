// Rebuild the bluethroat headless in Blender, then verify the exported assets.
//   npm run art:bluethroat                          full rebuild + verify
//   npm run art:bluethroat -- --previews            also render build/previews/*.png
//   npm run art:bluethroat -- --steps s09_anim,s10_export --no-verify
// Blender 5.x: $BLENDER, else `blender` on PATH, else the usual install folders.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const art = resolve(here, "..");
const frontend = resolve(art, "../..");

function versionOf(path) {
  const m = /Blender[ _-]?(\d+)\.(\d+)/i.exec(path);
  return m ? Number(m[1]) * 1000 + Number(m[2]) : 0;
}

function findBlender() {
  const fromEnv = process.env.BLENDER || process.env.BLENDER_PATH;
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : null;
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["blender"], { encoding: "utf8" });
  const onPath = which.status === 0 ? which.stdout.split(/\r?\n/).find((l) => l.trim()) : null;
  if (onPath) return onPath.trim();
  const found = [];
  if (process.platform === "win32") {
    for (const drive of "CDEFGHIJ") {
      for (const base of [`${drive}:\\Program Files\\Blender Foundation`, `${drive}:\\Blender Foundation`]) {
        if (!existsSync(base)) continue;
        for (const dir of readdirSync(base)) {
          const exe = join(base, dir, "blender.exe");
          if (existsSync(exe)) found.push(exe);
        }
      }
    }
  } else if (process.platform === "darwin") {
    found.push("/Applications/Blender.app/Contents/MacOS/Blender");
  } else {
    found.push("/usr/bin/blender", "/usr/local/bin/blender", "/snap/bin/blender");
  }
  return found.filter((p) => existsSync(p)).sort((a, b) => versionOf(b) - versionOf(a))[0] ?? null;
}

const args = process.argv.slice(2);
const verify = !args.includes("--no-verify");
const buildArgs = args.filter((a) => a !== "--no-verify");

const blender = findBlender();
if (!blender) {
  console.error("Blender 5.x not found. Set BLENDER to the blender executable, e.g.\n  BLENDER=\"F:\\Blender Foundation\\Blender 5.1\\blender.exe\"");
  process.exit(1);
}
console.log(`[art] ${blender}`);
const build = spawnSync(
  blender,
  ["-b", "--factory-startup", "--python-exit-code", "1", "-P", join(art, "build.py"), "--", ...buildArgs],
  { stdio: "inherit", cwd: frontend },
);
if (build.status !== 0) {
  console.error(`[art] Blender build failed (exit ${build.status ?? build.signal})`);
  process.exit(build.status || 1);
}
if (verify) {
  const check = spawnSync(process.execPath, [join(here, "verify.mjs")], { stdio: "inherit", cwd: frontend });
  process.exit(check.status ?? 1);
}
