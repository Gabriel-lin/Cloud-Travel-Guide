import type { Vector3 } from "three";

import type { GroundProbe } from "../camera/WalkFlyRig";
import { CHUNK_SIZE } from "../const";
import { sampleCpu, sampleWaterCpu } from "../render/fields";
import type { WorldFields } from "../types";
import { INSTANCE_STRIDE, type ScatterLayer, type ScatterResult } from "../veg/scatter";
import type { TreeSpeciesId } from "../veg/species";

import {
  catalogForTreeSpecies,
  catalogShrub,
} from "./catalog";
import type { PickedEntity } from "./types";

/** 沿视线点选树冠/灌丛的近似包络(再乘 instance.scale) */
const VEG_HIT = {
  forest: { r: 5.4, h: 16 },
  bamboo: { r: 4.2, h: 12 },
  shrub: { r: 2.8, h: 3.5 },
} as const;

/** 点到地表时允许的根部邻域,比树冠包络更紧,避免点草地误拾取 */
const VEG_GROUND_R = {
  forest: 3.6,
  bamboo: 3.1,
  shrub: 2.0,
} as const;

type VegKind = keyof typeof VEG_HIT;

/**
 * 一次高度场行进:先测树冠包络,射线落地后再用更紧的根部半径。
 * 有树冠命中则不再用地表邻域,避免灌木抢走已点中的树。
 */
export function queryVegetation(opts: {
  origin: Vector3;
  dir: Vector3;
  fields: WorldFields;
  scatter: ScatterResult;
  groundProbe: GroundProbe;
}): PickedEntity | null {
  const { origin, dir, fields, scatter, groundProbe } = opts;
  const { res, size, heights, waterY } = fields;
  const maxT = Math.min(size * 0.5, 200);
  let bestScore = 1;
  let best: PickedEntity | null = null;
  let t = 1.1;

  while (t < maxT) {
    const x = origin.x + dir.x * t;
    const y = origin.y + dir.y * t;
    const z = origin.z + dir.z * t;
    if (Math.abs(x) > size / 2 || Math.abs(z) > size / 2) {
      t += 10;
      continue;
    }
    const g = sampleCpu(heights, x, z, res, size);
    const w = sampleWaterCpu(waterY, x, z, res, size);
    const surface = Number.isFinite(w) ? Math.max(g, w) : g;

    const hit = bestVegAt(scatter, size, x, y, z, true, bestScore);
    if (hit) {
      bestScore = hit.score;
      best = hit.entity;
    }
    if (y <= surface + 0.35) {
      if (!best) {
        const gy = groundProbe(x, z).ground + 0.8;
        best = bestVegAt(scatter, size, x, gy, z, false, 1)?.entity ?? null;
      }
      break;
    }
    const gap = y - surface;
    t += Math.min(Math.max(gap * 0.32, 1.5), 7);
  }
  return best;
}

function bestVegAt(
  scatter: ScatterResult,
  size: number,
  x: number,
  y: number,
  z: number,
  alongRay: boolean,
  maxScore: number,
): { score: number; entity: PickedEntity } | null {
  let bestScore = maxScore;
  let best: PickedEntity | null = null;

  for (const [species, layer] of scatter.trees) {
    const kind: VegKind = species === "bamboo" ? "bamboo" : "forest";
    const hit = hitLayer(layer, size, x, y, z, kind, alongRay, bestScore);
    if (!hit) continue;
    const entry = catalogForTreeSpecies(species as TreeSpeciesId);
    if (!entry) continue;
    bestScore = hit.score;
    best = {
      catalogId: entry.id,
      kind: entry.kind,
      titleKey: entry.titleKey,
      model: entry.model,
      instanceKey: `veg:${species}:${hit.index}`,
    };
  }

  const shrubHit = hitLayer(scatter.shrubs, size, x, y, z, "shrub", alongRay, bestScore);
  if (shrubHit) {
    const entry = catalogShrub();
    if (entry) {
      bestScore = shrubHit.score;
      best = {
        catalogId: entry.id,
        kind: "shrub",
        titleKey: entry.titleKey,
        model: entry.model,
        instanceKey: `veg:shrub:${shrubHit.index}`,
      };
    }
  }

  return best ? { score: bestScore, entity: best } : null;
}

function hitLayer(
  layer: ScatterLayer,
  size: number,
  x: number,
  y: number,
  z: number,
  kind: VegKind,
  alongRay: boolean,
  maxScore: number,
): { score: number; index: number } | null {
  const env = VEG_HIT[kind];
  const searchR = (alongRay ? env.r * 1.55 : VEG_GROUND_R[kind]) * 1.6;
  const near = nearestInLayer(layer, size, x, z, searchR * searchR);
  if (!near) return null;
  const o = near.index * INSTANCE_STRIDE;
  const iy = layer.data[o + 1] as number;
  const scale = Math.max(layer.data[o + 3] as number, 0.45);
  const radius = (alongRay ? env.r : VEG_GROUND_R[kind]) * scale;
  const height = env.h * scale;
  if (near.d2 > radius * radius) return null;
  if (alongRay && (y < iy - 0.45 || y > iy + height + 0.7)) return null;
  const score = near.d2 / (radius * radius);
  if (score >= maxScore) return null;
  return { score, index: near.index };
}

export function nearestInLayer(
  layer: ScatterLayer,
  size: number,
  x: number,
  z: number,
  maxD2: number,
): { d2: number; index: number } | null {
  if (layer.count === 0) return null;
  const chunksX = Math.ceil(size / CHUNK_SIZE);
  const r = Math.sqrt(maxD2);
  const c0x = Math.max(Math.floor((x - r + size / 2) / CHUNK_SIZE), 0);
  const c1x = Math.min(Math.floor((x + r + size / 2) / CHUNK_SIZE), chunksX - 1);
  const c0z = Math.max(Math.floor((z - r + size / 2) / CHUNK_SIZE), 0);
  const c1z = Math.min(Math.floor((z + r + size / 2) / CHUNK_SIZE), chunksX - 1);
  let bestD = maxD2;
  let bestI = -1;
  for (let gz = c0z; gz <= c1z; gz++) {
    for (let gx = c0x; gx <= c1x; gx++) {
      const range = layer.chunkIndex.get(gz * chunksX + gx);
      if (!range) continue;
      const [start, count] = range;
      for (let i = start; i < start + count; i++) {
        const o = i * INSTANCE_STRIDE;
        const dx = (layer.data[o] as number) - x;
        const dz = (layer.data[o + 2] as number) - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD) {
          bestD = d2;
          bestI = i;
        }
      }
    }
  }
  return bestI < 0 ? null : { d2: bestD, index: bestI };
}
