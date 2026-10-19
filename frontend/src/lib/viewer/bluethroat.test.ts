import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Object3D } from "three";
import { describe, expect, it } from "vitest";

import { GltfModelLoader } from "../loaders/GltfModelLoader";

import { BLUETHROAT_MODEL, BLUETHROAT_SONG, loadBluethroat } from "./bluethroat";
import type { CueAudioSink, CueVoice } from "./ClipPlayer";
import type { AudioCue } from "./clipMeta";

// vitest runs from frontend/ (jsdom's import.meta.url is not a file: URL)
const GLB = path.resolve(process.cwd(), "public/models/bluethroat.glb");
const WAV = path.resolve(process.cwd(), "public/audio/birds/bluethroat/song-01.wav");
const DT = 1 / 30;

/** jsdom 解不了贴图:去掉图片/纹理引用,几何、蒙皮和动画原样保留。 */
function withoutTextures(file: Buffer): ArrayBuffer {
  const jsonLen = file.readUInt32LE(12);
  const json = JSON.parse(file.subarray(20, 20 + jsonLen).toString("utf8")) as Record<string, unknown>;
  const drop = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    for (const key of Object.keys(rec)) {
      if (key.endsWith("Texture")) delete rec[key];
      else drop(rec[key]);
    }
  };
  drop(json.materials);
  delete json.images;
  delete json.textures;
  delete json.samplers;
  const text = Buffer.from(JSON.stringify(json), "utf8");
  const chunk = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const bin = file.subarray(20 + jsonLen);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + chunk.length + bin.length, 8);
  head.writeUInt32LE(chunk.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  const out = Buffer.concat([head, chunk, bin]);
  // copy into this realm's ArrayBuffer: Node's Buffer memory fails jsdom's `instanceof ArrayBuffer`
  const ab = new ArrayBuffer(out.byteLength);
  new Uint8Array(ab).set(out);
  return ab;
}

function wavSeconds(file: Buffer): number {
  const channels = file.readUInt16LE(22);
  const rate = file.readUInt32LE(24);
  const bits = file.readUInt16LE(34);
  let at = 12;
  while (at + 8 <= file.length) {
    const id = file.toString("ascii", at, at + 4);
    const size = file.readUInt32LE(at + 4);
    if (id === "data") return size / (rate * channels * (bits / 8));
    at += 8 + size + (size % 2);
  }
  return 0;
}

class RecordingSink implements CueAudioSink {
  readonly starts: { cue: AudioCue; offset: number; at: number }[] = [];
  private readonly live: { voice: CueVoice & { stopped: boolean }; pos: number; len: number }[] = [];
  clock = 0;

  start(cue: AudioCue, offset: number): CueVoice | null {
    const entry = { pos: offset, len: cue.duration ?? 10, voice: null as unknown as CueVoice & { stopped: boolean } };
    entry.voice = {
      stopped: false,
      stop() {
        this.stopped = true;
      },
      position: () => (entry.voice.stopped || entry.pos >= entry.len ? null : entry.pos),
    };
    this.live.push(entry);
    this.starts.push({ cue, offset, at: this.clock });
    return entry.voice;
  }

  tick(dt: number): void {
    this.clock += dt;
    for (const e of this.live) if (!e.voice.stopped) e.pos += dt;
  }

  get playing(): number {
    return this.live.filter((e) => e.voice.position() !== null).length;
  }
}

function bone(root: Object3D, name: string): Object3D {
  const found = root.getObjectByName(name);
  if (!found) throw new Error(`bone ${name} not found`);
  return found;
}

describe("bluethroat.glb", () => {
  it(
    "loads through the project's glTF loader with both clips, their audio cue and the song file",
    async () => {
      const sink = new RecordingSink();
      const loader = new GltfModelLoader({ dracoDecoderPath: null, ktx2TranscoderPath: null, meshopt: false });
      const { model, player } = await loadBluethroat(loader, {
        src: withoutTextures(readFileSync(GLB)),
        load: { format: "glb" },
        audio: sink,
      });

      expect(player.names).toEqual(expect.arrayContaining([...BLUETHROAT_MODEL.clips]));
      expect(player.duration("WalkSing")).toBeCloseTo(7.0, 1);
      expect(player.duration("Fly")).toBeCloseTo(2.633, 2);

      const walk = player.meta("WalkSing");
      const fly = player.meta("Fly");
      expect(walk?.loop).toBe(true);
      expect(fly?.loop).toBe(true);
      expect(fly?.cues).toHaveLength(0);
      const cue = walk?.cues[0];
      expect(cue?.src).toBe(BLUETHROAT_SONG.src);
      expect(walk?.audio?.xcId).toBe(BLUETHROAT_SONG.xcId);
      expect(walk?.audio?.recordist).toBe(BLUETHROAT_SONG.recordist);
      const songStart = walk?.markers.songStart ?? NaN;
      expect(songStart).toBeGreaterThan(walk?.markers.walkEnd ?? Infinity);
      expect(cue?.at).toBeLessThan(songStart);

      expect(existsSync(WAV)).toBe(true);
      expect(wavSeconds(readFileSync(WAV))).toBeCloseTo(cue?.duration ?? 0, 2);

      const jaw = bone(model.object, "jaw");
      player.command("idle");
      expect(player.current).toBe("WalkSing");
      const restJaw = jaw.quaternion.clone();
      let widest = 0;
      let widestAt = 0;
      while (player.time < (walk?.markers.songEnd ?? 0) && sink.clock < 10) {
        player.update(DT);
        sink.tick(DT);
        const open = jaw.quaternion.angleTo(restJaw);
        if (open > widest) {
          widest = open;
          widestAt = player.time;
        }
      }
      expect(sink.starts).toHaveLength(1);
      expect(sink.starts[0]!.offset).toBeLessThan(DT + 1e-6);
      expect(sink.starts[0]!.at).toBeCloseTo(cue?.at ?? 0, 1);
      expect(widest).toBeGreaterThan((10 * Math.PI) / 180);
      expect(widestAt).toBeGreaterThan(songStart);

      player.command("Fly");
      expect(player.current).toBe("Fly");
      expect(sink.playing).toBe(0);
      player.dispose();
      model.dispose();
    },
    60_000,
  );
});
