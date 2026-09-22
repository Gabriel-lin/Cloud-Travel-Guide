/**
 * 鸟类声音系统:每群一个空间锚点,按种/栖息地/昼夜/风调度鸣声。
 *
 * 不逐鸟发声(2048 实例会打爆声部);以群心为 HRTF 源,密度只影响频次与复声。
 */

import type { BirdFlockEmitter } from "../../world/birdKinematics";
import { evalFlockCenter } from "../../world/birdKinematics";
import type { BirdSpeciesId } from "../../world/birdSpecies";
import { SoundSystem } from "../SoundSystem";
import type { SoundFrameContext, SoundHost, VocalKind } from "../types";
import { BIRD_CLIPS, type BirdClip } from "./manifest";
import {
  flockActivity,
  mulberry32,
  nextInterval,
  pickVocalKind,
  vocalPriority,
  vocalWeights,
} from "./policy";
import { BIRD_PROFILES } from "./profiles";

type FlockVoice = {
  emitter: BirdFlockEmitter;
  rng: () => number;
  nextAt: number;
  lastSrc: string | null;
  pos: { x: number; y: number; z: number };
};

const KIND_FALLBACK: VocalKind[] = ["call", "song", "flight", "alarm", "nocturnal"];

export class BirdSoundSystem extends SoundSystem {
  readonly id = "birds";
  readonly label = "鸟类鸣声";

  private readonly voices: FlockVoice[];
  private readonly clipsBySpecies: Map<BirdSpeciesId, BirdClip[]>;
  private preloadStarted = false;

  constructor(emitters: readonly BirdFlockEmitter[], clips: readonly BirdClip[] = BIRD_CLIPS) {
    super();
    this.clipsBySpecies = new Map();
    for (const clip of clips) {
      const list = this.clipsBySpecies.get(clip.speciesId);
      if (list) list.push(clip);
      else this.clipsBySpecies.set(clip.speciesId, [clip]);
    }
    this.voices = emitters.map((emitter) => ({
      emitter,
      rng: mulberry32((emitter.id + 1) * 104729 + 20260827),
      nextAt: 0.4 + (emitter.id % 7) * 0.35,
      lastSrc: null,
      pos: { x: emitter.kinematics.ox, y: emitter.kinematics.oy, z: emitter.kinematics.oz },
    }));
  }

  protected override onRegister(host: SoundHost): void {
    if (this.preloadStarted) return;
    this.preloadStarted = true;
    const urls = new Set<string>();
    for (const v of this.voices) {
      const clips = this.clipsBySpecies.get(v.emitter.speciesId);
      if (!clips) continue;
      for (const c of clips) urls.add(c.src);
    }
    void host.runtime.assets?.preload([...urls]);
  }

  protected override onUnregister(): void {
    this.host?.runtime.stopAll();
  }

  protected override onDisabled(): void {
    this.host?.runtime.stopAll();
  }

  protected override tick(ctx: SoundFrameContext): void {
    const runtime = this.host?.runtime;
    if (!runtime?.active || !runtime.assets) return;
    const cam = ctx.camera.position;

    for (const voice of this.voices) {
      const { emitter } = voice;
      evalFlockCenter(emitter.kinematics, ctx.time, voice.pos);
      if (ctx.time < voice.nextAt) continue;

      const profile = BIRD_PROFILES[emitter.speciesId];
      const dist = Math.hypot(voice.pos.x - cam.x, voice.pos.y - cam.y, voice.pos.z - cam.z);
      const activity = flockActivity(profile, emitter.count, dist, ctx.nightK, ctx.underwater);
      voice.nextAt = ctx.time + nextInterval(profile, activity, voice.rng);
      if (activity <= 0.04) continue;

      const weights = vocalWeights(profile, emitter.habitat, ctx);
      const kind = pickVocalKind(weights, voice.rng);
      if (!kind) continue;

      const clip = this.pickClip(emitter.speciesId, kind, voice);
      if (!clip) continue;
      const buffer = runtime.assets.get(clip.src);
      if (!buffer) {
        void runtime.assets.load(clip.src);
        continue;
      }

      const distGain = 1 - Math.min(dist / profile.maxDistance, 1);
      const crowd = Math.min(1.2, 0.7 + emitter.count * 0.012);
      const playDur = Math.min(buffer.duration, Math.max(1.1, Math.min(clip.duration, 5.8)));
      const maxStart = Math.max(0, buffer.duration - playDur);
      const offset = maxStart > 0.05 ? voice.rng() * maxStart * 0.85 : 0;

      runtime.playSpatial({
        buffer,
        x: voice.pos.x,
        y: voice.pos.y,
        z: voice.pos.z,
        gain: profile.gain * (0.55 + distGain * 0.55) * crowd * (0.85 + voice.rng() * 0.25),
        refDistance: profile.refDistance,
        maxDistance: profile.maxDistance,
        rolloff: profile.rolloff,
        bus: "birds",
        offset,
        duration: playDur,
        priority: vocalPriority(kind) + (dist < 28 ? 1 : 0),
      });
      voice.lastSrc = clip.src;

      const extra = Math.min(profile.polyphony - 1, Math.floor(activity * 3));
      for (let i = 0; i < extra; i++) {
        const more = this.pickClip(emitter.speciesId, kind, voice);
        const buf = more ? runtime.assets.get(more.src) : null;
        if (!more || !buf) break;
        const jitter = 0.12 + voice.rng() * 0.45;
        const spread = 1.2 + voice.rng() * 3.5;
        const yaw = voice.rng() * Math.PI * 2;
        runtime.playSpatial({
          buffer: buf,
          x: voice.pos.x + Math.cos(yaw) * spread,
          y: voice.pos.y + (voice.rng() - 0.5) * 1.4,
          z: voice.pos.z + Math.sin(yaw) * spread,
          gain: profile.gain * 0.45 * distGain,
          refDistance: profile.refDistance,
          maxDistance: profile.maxDistance * 0.9,
          rolloff: profile.rolloff,
          bus: "birds",
          offset: 0,
          duration: Math.min(buf.duration, 2.8 + voice.rng() * 2),
          priority: vocalPriority(kind) - 1,
        });
        voice.nextAt += jitter * 0.15;
      }
    }
  }

  private pickClip(speciesId: BirdSpeciesId, kind: VocalKind, voice: FlockVoice): BirdClip | null {
    const all = this.clipsBySpecies.get(speciesId);
    if (!all || all.length === 0) return null;
    const order: VocalKind[] = [kind, ...KIND_FALLBACK.filter((k) => k !== kind)];
    for (const k of order) {
      const pool = all.filter((c) => c.kind === k);
      if (pool.length === 0) continue;
      const avoid = pool.length > 1 ? pool.filter((c) => c.src !== voice.lastSrc) : pool;
      return avoid[Math.floor(voice.rng() * avoid.length)] ?? null;
    }
    const avoid = all.length > 1 ? all.filter((c) => c.src !== voice.lastSrc) : all;
    return avoid[Math.floor(voice.rng() * avoid.length)] ?? null;
  }
}
