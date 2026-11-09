// Verify the exported bluethroat assets (no Blender needed):
//   npm run art:bluethroat:verify
// 1. Khronos glTF validator: no errors, no warnings.
// 2. The app's three.js loads it: rig, both clips with their metadata, poses that actually move.
// 3. The song file matches the WalkSing audio cue, and its credit is in public/audio/birds/attribution.json.
// 4. The app-side controller tests (src/lib/viewer) pass against this GLB.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import validator from "gltf-validator";
import { AnimationMixer, Box3, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const here = dirname(fileURLToPath(import.meta.url));
const art = resolve(here, "..");
const frontend = resolve(art, "../..");
const GLB = resolve(frontend, "public/models/bluethroat.glb");
const ATTRIBUTION = resolve(frontend, "public/audio/birds/attribution.json");
const CLIP_CUES = resolve(art, "build/clip_cues.json");
const CLIPS = ["WalkSing", "Fly"];
const BONES = 72;

const failures = [];
function check(ok, message) {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${message}`);
  if (!ok) failures.push(message);
}

function wavSeconds(file) {
  const channels = file.readUInt16LE(22);
  const rate = file.readUInt32LE(24);
  const bits = file.readUInt16LE(34);
  for (let at = 12; at + 8 <= file.length; ) {
    const size = file.readUInt32LE(at + 4);
    if (file.toString("ascii", at, at + 4) === "data") return size / (rate * channels * (bits / 8));
    at += 8 + size + (size % 2);
  }
  return 0;
}

console.log(`bluethroat assets: ${GLB}`);

// --- 1. Khronos validator
const bytes = readFileSync(GLB);
const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 30 });
const { numErrors, numWarnings, messages } = report.issues;
check(
  numErrors === 0 && numWarnings === 0,
  `glTF validator: ${numErrors} errors, ${numWarnings} warnings (${report.info.totalTriangleCount} triangles, ${(bytes.length / 1048576).toFixed(2)} MB)`,
);
for (const m of messages.filter((msg) => msg.severity <= 1)) console.log(`         ${m.code} ${m.pointer ?? ""} ${m.message}`);

// --- 2. three.js in Node: textures decode to tiny stand-ins (their pixels don't matter here)
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 4, height: 4, close() {} });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) =>
  String(url).startsWith("blob:") ? new Response(new Blob([new Uint8Array(4)])) : realFetch(url, opts);

const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
const skinned = [];
gltf.scene.traverse((o) => {
  if (o.isSkinnedMesh) skinned.push(o);
});
const bones = skinned[0]?.skeleton.bones.length ?? 0;
check(skinned.length > 0 && bones === BONES, `rig: ${skinned.length} skinned meshes on a ${bones}-bone skeleton`);

function birdSize() {
  gltf.scene.updateMatrixWorld(true);
  const box = new Box3();
  for (const m of skinned) {
    m.computeBoundingBox();
    box.union(m.boundingBox.clone().applyMatrix4(m.matrixWorld));
  }
  return box.getSize(new Vector3());
}

const mixer = new AnimationMixer(gltf.scene);
for (const name of CLIPS) {
  const clip = gltf.animations.find((c) => c.name === name);
  check(Boolean(clip), `${name}: ${clip ? `${clip.duration.toFixed(3)} s, ${clip.tracks.length} tracks` : "missing"}`);
  if (!clip) continue;
  check(clip.userData?.loop === true, `${name}: marked as a looping clip`);
  mixer.stopAllAction();
  mixer.clipAction(clip).reset().play();
  const sizes = [0, 0.2, 0.4, 0.6, 0.8].map((f) => {
    mixer.setTime(f * clip.duration);
    return birdSize();
  });
  const finite = sizes.every((s) => [s.x, s.y, s.z].every((v) => Number.isFinite(v) && v > 0.005 && v < 0.5));
  const spread = Math.max(...sizes.map((s) => s.x)) - Math.min(...sizes.map((s) => s.x));
  const height = Math.max(...sizes.map((s) => s.y)) - Math.min(...sizes.map((s) => s.y));
  check(finite && Math.max(spread, height) > 0.002, `${name}: poses play (size range x ${(spread * 1000).toFixed(1)} mm, y ${(height * 1000).toFixed(1)} mm)`);
}

// --- 3. song file + credit
const walk = gltf.animations.find((c) => c.name === "WalkSing");
const extras = walk?.userData ?? {};
const cue = (extras.cues ?? []).find((c) => c.type === "audio");
check(Boolean(cue), `WalkSing: audio cue ${cue ? `${cue.src} at ${cue.at} s` : "missing"}`);
if (cue && walk) {
  const markers = extras.markers ?? {};
  check(
    cue.at < markers.songStart && markers.songStart < markers.songEnd && markers.songEnd <= walk.duration,
    `WalkSing: song markers ${markers.songStart} -> ${markers.songEnd} s inside the ${walk.duration.toFixed(2)} s clip`,
  );
  const wavPath = resolve(frontend, "public", `.${cue.src}`);
  const wav = existsSync(wavPath) ? wavSeconds(readFileSync(wavPath)) : 0;
  check(Math.abs(wav - cue.duration) < 0.02, `song file: ${wav.toFixed(3)} s (cue says ${cue.duration} s)`);
  const credits = JSON.parse(readFileSync(ATTRIBUTION, "utf8")).clips ?? [];
  const credit = credits.find((c) => c.src === cue.src);
  check(Boolean(credit) && credit.xcId === extras.audio?.xcId, `song credit: ${credit ? `${credit.xcId} ${credit.recordist} (${credit.license})` : "missing in attribution.json"}`);
}
if (existsSync(CLIP_CUES)) {
  const built = JSON.parse(readFileSync(CLIP_CUES, "utf8"));
  const same = CLIPS.every((n) => JSON.stringify(built[n]) === JSON.stringify(gltf.animations.find((c) => c.name === n)?.userData));
  check(same, "clip metadata in the GLB matches build/clip_cues.json");
}

// --- 4. app-side controller against this GLB
const vitest = resolve(frontend, "node_modules/vitest/vitest.mjs");
const tests = spawnSync(process.execPath, [vitest, "run", "src/lib/viewer"], { cwd: frontend, stdio: "inherit" });
check(tests.status === 0, "app controller tests (src/lib/viewer) pass");

console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
