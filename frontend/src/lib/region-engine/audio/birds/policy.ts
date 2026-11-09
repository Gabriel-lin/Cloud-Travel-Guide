import type { Habitat } from "../../world/birdSpecies";
import type { SoundFrameContext, VocalKind } from "../types";
import type { BirdAcousticProfile } from "./profiles";

const KINDS: VocalKind[] = ["song", "call", "flight", "alarm", "nocturnal"];

const HABITAT_VOCAL: Record<Habitat, Partial<Record<VocalKind, number>>> = {
  urban: { song: 0.85, call: 1.15, flight: 0.9, alarm: 1.1, nocturnal: 0.7 },
  farmland: { song: 1.15, call: 1.0, flight: 1.0, alarm: 0.9, nocturnal: 0.8 },
  forest: { song: 0.95, call: 0.9, flight: 0.7, alarm: 0.85, nocturnal: 1.25 },
  meadow: { song: 1.2, call: 0.95, flight: 1.05, alarm: 0.8, nocturnal: 0.85 },
  wetland: { song: 0.7, call: 1.15, flight: 1.1, alarm: 0.9, nocturnal: 0.75 },
  water: { song: 0.45, call: 1.2, flight: 1.25, alarm: 0.85, nocturnal: 0.6 },
  coast: { song: 0.5, call: 1.15, flight: 1.3, alarm: 1.0, nocturnal: 0.55 },
  alpine: { song: 0.65, call: 0.85, flight: 0.9, alarm: 0.7, nocturnal: 1.1 },
};

export type VocalWeights = Record<VocalKind, number>;

/** 按昼夜/风/栖息地/夜行性调制各鸣声型权重。 */
export function vocalWeights(
  profile: BirdAcousticProfile,
  habitat: Habitat,
  ctx: Pick<SoundFrameContext, "nightK" | "wind" | "underwater">,
): VocalWeights {
  const hab = HABITAT_VOCAL[habitat];
  const night = ctx.nightK;
  const wind = ctx.wind;
  const out = {} as VocalWeights;
  for (const kind of KINDS) {
    let w = profile.vocals[kind] * (hab[kind] ?? 1);
    if (profile.nocturnal) {
      const nightBoost = 0.18 + night * 0.95;
      w *= kind === "nocturnal" || kind === "song" ? nightBoost : 0.35 + night * 0.5;
    } else {
      w *= 1 - night * (kind === "nocturnal" ? 0.2 : 0.92);
      if (kind === "call" || kind === "flight") w += profile.vocals[kind] * night * 0.08;
    }
    if (kind === "song") w *= 1 - wind * 0.72;
    if (kind === "alarm") w *= 0.55 + wind * 0.9;
    if (kind === "flight") w *= 0.85 + wind * 0.25;
    if (ctx.underwater) w = 0;
    out[kind] = Math.max(0, w);
  }
  return out;
}

export function pickVocalKind(weights: VocalWeights, rng: () => number): VocalKind | null {
  let sum = 0;
  for (const kind of KINDS) sum += weights[kind];
  if (sum <= 1e-6) return null;
  let r = rng() * sum;
  for (const kind of KINDS) {
    r -= weights[kind];
    if (r <= 0) return kind;
  }
  return "call";
}

export function vocalPriority(kind: VocalKind): number {
  switch (kind) {
    case "alarm":
      return 4;
    case "nocturnal":
      return 3;
    case "song":
      return 2;
    case "flight":
      return 1;
    default:
      return 1;
  }
}

/**
 * 活动度 0..1:距离衰减 + 种群密度 + 昼夜总闸。
 * 再乘进发声间隔。
 */
export function flockActivity(
  profile: BirdAcousticProfile,
  count: number,
  dist: number,
  nightK: number,
  underwater: boolean,
): number {
  if (underwater) return 0;
  if (dist > profile.maxDistance) return 0;
  const near = 1 - Math.min(dist / profile.maxDistance, 1);
  const distK = near * near;
  const crowd = Math.min(1.35, 0.55 + Math.log2(2 + count) * 0.22);
  const circadian = profile.nocturnal ? 0.16 + nightK * 0.9 : 1 - nightK * 0.88;
  return Math.min(1, distK * crowd * Math.max(0, circadian));
}

export function nextInterval(
  profile: BirdAcousticProfile,
  activity: number,
  rng: () => number,
): number {
  if (activity <= 0.02) return profile.cadence[1] * (4 + rng() * 4);
  const [a, b] = profile.cadence;
  const span = b - a;
  const raw = a + rng() * span;
  return raw / Math.max(activity, 0.08);
}

export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
