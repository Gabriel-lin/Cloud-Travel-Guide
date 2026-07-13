/**
 * 聚簇泊松散布(确定性哈希,LAAS `Scatter.ts` 的 CPU 等价实现)。
 *
 * 每层(树/灌木/农作物)在抖动子网格上逐格判定:
 *   接受率 = 生物群系密度 × 坡度/水面/城区衰减 × 父簇场(26 m 粗格光竞争聚簇)。
 * 每实例 10 个通道全部由 pcg 哈希导出 —— 位置抖动/种类/变体/缩放/朝向/倾斜/
 * 相位/色相,零克隆、可复现;两端(WebGPU/WebGL2)结果一致。
 */

import { BIOME, CHUNK_SIZE } from "../const";
import { sampleCpu, sampleWaterCpu } from "../render/fields";
import type { WorldFields } from "../types";
import type { TreeSpeciesId } from "./species";

export const INSTANCE_STRIDE = 10; // x y z scale yaw leanX leanZ phase hue variant

export type ScatterLayer = {
  data: Float32Array;
  count: number;
  /** chunkId → [startInstance, count](实例按 chunk 连续排列) */
  chunkIndex: Map<number, [number, number]>;
};

export type ScatterResult = {
  trees: Map<TreeSpeciesId, ScatterLayer>;
  shrubs: ScatterLayer;
  crops: ScatterLayer;
  /** 萤火虫聚集点 [x,y,z,weight]×N(水边 + 植被加权) */
  fireflySpots: Float32Array;
};

/** pcg2d:2D 整数格 → [0,1) 多通道 */
function cellHash(cx: number, cy: number, salt: number): () => number {
  let state = (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663) ^ Math.imul(salt, 83492791)) >>> 0;
  return () => {
    state = (Math.imul(state, 747796405) + 2891336453) >>> 0;
    const word = Math.imul(state >>> ((state >>> 28) + 4) ^ state, 277803737) >>> 0;
    // XOR 结果是有符号 32 位,必须 >>>0 回无符号再归一化,否则可能返回负数
    return (((word >>> 22) ^ word) >>> 0) / 4294967296;
  };
}

type Rec = {
  chunk: number;
  x: number;
  y: number;
  z: number;
  scale: number;
  yaw: number;
  leanX: number;
  leanZ: number;
  phase: number;
  hue: number;
  variant: number;
};

function packLayer(recs: Rec[], size: number): ScatterLayer {
  const chunksX = Math.ceil(size / CHUNK_SIZE);
  void chunksX;
  recs.sort((a, b) => a.chunk - b.chunk);
  const data = new Float32Array(recs.length * INSTANCE_STRIDE);
  const chunkIndex = new Map<number, [number, number]>();
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i] as Rec;
    const o = i * INSTANCE_STRIDE;
    data[o] = r.x;
    data[o + 1] = r.y;
    data[o + 2] = r.z;
    data[o + 3] = r.scale;
    data[o + 4] = r.yaw;
    data[o + 5] = r.leanX;
    data[o + 6] = r.leanZ;
    data[o + 7] = r.phase;
    data[o + 8] = r.hue;
    data[o + 9] = r.variant;
    const entry = chunkIndex.get(r.chunk);
    if (entry) entry[1]++;
    else chunkIndex.set(r.chunk, [i, 1]);
  }
  return { data, count: recs.length, chunkIndex };
}

export function chunkIdOf(x: number, z: number, size: number): number {
  const chunksX = Math.ceil(size / CHUNK_SIZE);
  const cx = Math.min(Math.max(Math.floor((x + size / 2) / CHUNK_SIZE), 0), chunksX - 1);
  const cz = Math.min(Math.max(Math.floor((z + size / 2) / CHUNK_SIZE), 0), chunksX - 1);
  return cz * chunksX + cx;
}

export function scatterWorld(world: WorldFields): ScatterResult {
  const { res, size, seed, masks } = world;
  const sample = (arr: Float32Array, x: number, z: number) =>
    sampleCpu(arr, x, z, res, size);
  const idxOf = (x: number, z: number) => {
    const px = Math.min(Math.max(Math.round((x / size + 0.5) * res), 0), res - 1);
    const pz = Math.min(Math.max(Math.round((z / size + 0.5) * res), 0), res - 1);
    return pz * res + px;
  };
  const groundAt = (x: number, z: number) => sample(world.heights, x, z);
  const inWater = (x: number, z: number) => {
    const w = sampleWaterCpu(world.waterY, x, z, res, size);
    return w > groundAt(x, z) - 0.05;
  };
  const slopeAt = (x: number, z: number) => {
    const e = size / res;
    const h = groundAt(x, z);
    return Math.hypot(groundAt(x + e, z) - h, groundAt(x, z + e) - h) / e;
  };
  /** 父簇场:26 m 粗格,62% 出簇 + 3×3 扩散(光竞争聚簇) */
  const clusterK = (x: number, z: number, salt: number): number => {
    const cs = 26;
    let best = 0;
    const cx0 = Math.floor((x + size / 2) / cs);
    const cz0 = Math.floor((z + size / 2) / cs);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const h = cellHash(cx0 + dx, cz0 + dz, salt + seed);
        if (h() < 0.62) {
          const px = (cx0 + dx + h()) * cs - size / 2;
          const pz = (cz0 + dz + h()) * cs - size / 2;
          const d = Math.hypot(px - x, pz - z) / cs;
          best = Math.max(best, 1 - d * 0.7);
        }
      }
    }
    return 0.22 + best * 0.9;
  };

  // ---------- 树 ----------
  const treeRecs = new Map<TreeSpeciesId, Rec[]>();
  const pushTree = (id: TreeSpeciesId, r: Rec) => {
    const arr = treeRecs.get(id) ?? [];
    arr.push(r);
    treeRecs.set(id, arr);
  };
  const stepT = 5.2;
  const half = size / 2;
  const cells = Math.floor(size / stepT);
  for (let gz = 0; gz < cells; gz++) {
    for (let gx = 0; gx < cells; gx++) {
      const h = cellHash(gx, gz, 11 + seed);
      const x = -half + (gx + h()) * stepT;
      const z = -half + (gz + h()) * stepT;
      const i = idxOf(x, z);
      const biome = world.biome[i] as number;
      const veg = world.vegDensity[i] as number;
      const urban = masks.urban[i] as number;
      const riverP = masks.riverProfile[i] as number;

      // 基础密度
      let density = 0;
      if (biome === BIOME.forest) density = 0.55 + veg * 0.35;
      else if (biome === BIOME.rainforest) density = 0.85;
      else if (biome === BIOME.meadow) density = 0.05;
      else if (biome === BIOME.farmland) density = 0.015;
      else if (biome === BIOME.urban) density = 0.02;
      else if (biome === BIOME.wetland) density = 0.12;
      else if (biome === BIOME.alpine) density = 0.03;
      else if (biome === BIOME.desert) density = 0.01;
      // 河岸柳树走廊
      const bankK = riverP > 0.001 && riverP < 0.45 ? 0.5 : 0;
      density = Math.max(density, bankK * 0.35);
      if (density <= 0.003) continue;
      density *= clusterK(x, z, 31);
      if (h() > density) continue;
      if (inWater(x, z)) continue;
      const slope = slopeAt(x, z);
      if (slope > 1.1) continue;
      if ((world.snow[i] as number) > 0.75) continue;
      if (urban > 0.5 && h() > 0.25) continue; // 城区只留稀疏行道树

      // 种类:生物群系 × 湿度 × 海拔
      const altAbs = groundAt(x, z) + world.baseAlt;
      const moist = world.moisture[i] as number;
      let id: TreeSpeciesId;
      const pick = h();
      if (biome === BIOME.desert) id = "saxaul";
      else if (biome === BIOME.alpine || altAbs > 3100) id = "alpineFir";
      else if (bankK > 0 && pick < 0.55) id = "willow";
      else if (altAbs > 1800 || pick < 0.18) id = "conifer";
      else if (moist > 0.35 && pick < 0.5) id = "bamboo";
      else id = "broadleaf";

      pushTree(id, {
        chunk: chunkIdOf(x, z, size),
        x,
        y: groundAt(x, z) - 0.12,
        z,
        scale: 0.7 + Math.pow(h(), 1.6) * 0.75,
        yaw: h() * Math.PI * 2,
        leanX: (h() - 0.5) * 0.1 + slope * 0.05,
        leanZ: (h() - 0.5) * 0.1,
        phase: h(),
        hue: h(),
        variant: Math.floor(h() * 4),
      });
    }
  }

  // ---------- 灌木 ----------
  const shrubRecs: Rec[] = [];
  const stepS = 3.4;
  const cellsS = Math.floor(size / stepS);
  for (let gz = 0; gz < cellsS; gz++) {
    for (let gx = 0; gx < cellsS; gx++) {
      const h = cellHash(gx, gz, 57 + seed);
      const x = -half + (gx + h()) * stepS;
      const z = -half + (gz + h()) * stepS;
      const i = idxOf(x, z);
      const biome = world.biome[i] as number;
      const scrub = masks.scrub[i] as number;
      let density = scrub * 0.5;
      if (biome === BIOME.forest || biome === BIOME.rainforest) density += 0.2; // 林下灌层
      else if (biome === BIOME.meadow) density += 0.06;
      else if (biome === BIOME.wetland) density += 0.15;
      else if (biome === BIOME.desert) density += 0.03;
      if ((masks.riverProfile[i] as number) > 0.001) density += 0.2; // 河岸灌丛
      if (biome === BIOME.urban || biome === BIOME.farmland) density *= 0.15;
      if (density <= 0.01) continue;
      density *= clusterK(x, z, 77);
      if (h() > density) continue;
      if (inWater(x, z) || slopeAt(x, z) > 1.3) continue;
      if ((world.snow[i] as number) > 0.7) continue;
      shrubRecs.push({
        chunk: chunkIdOf(x, z, size),
        x,
        y: groundAt(x, z) - 0.05,
        z,
        scale: 0.6 + h() * 0.9,
        yaw: h() * Math.PI * 2,
        leanX: (h() - 0.5) * 0.16,
        leanZ: (h() - 0.5) * 0.16,
        phase: h(),
        hue: h(),
        variant: Math.floor(h() * 4),
      });
    }
  }

  // ---------- 农作物(近景装饰层) ----------
  const cropRecs: Rec[] = [];
  const stepC = 6.5;
  const cellsC = Math.floor(size / stepC);
  for (let gz = 0; gz < cellsC; gz++) {
    for (let gx = 0; gx < cellsC; gx++) {
      const h = cellHash(gx, gz, 93 + seed);
      const x = -half + (gx + h()) * stepC;
      const z = -half + (gz + h()) * stepC;
      const i = idxOf(x, z);
      if ((masks.farmland[i] as number) < 0.5) continue;
      if (h() > 0.75) continue;
      if (inWater(x, z)) continue;
      cropRecs.push({
        chunk: chunkIdOf(x, z, size),
        x,
        y: groundAt(x, z),
        z,
        scale: 0.5 + h() * 0.5,
        yaw: h() * Math.PI * 2,
        leanX: 0,
        leanZ: 0,
        phase: h(),
        hue: h(),
        variant: Math.floor(h() * 4),
      });
    }
  }

  // ---------- 萤火虫聚集点 ----------
  const spots: { x: number; y: number; z: number; w: number }[] = [];
  const stepF = 48;
  const cellsF = Math.floor(size / stepF);
  for (let gz = 0; gz < cellsF; gz++) {
    for (let gx = 0; gx < cellsF; gx++) {
      const h = cellHash(gx, gz, 131 + seed);
      const x = -half + (gx + h()) * stepF;
      const z = -half + (gz + h()) * stepF;
      const i = idxOf(x, z);
      const w =
        (world.moisture[i] as number) *
        ((world.vegDensity[i] as number) + 0.3) *
        (1 - (masks.urban[i] as number) * 0.85);
      if (w < 0.12) continue;
      spots.push({ x, y: groundAt(x, z), z, w });
    }
  }
  spots.sort((a, b) => b.w - a.w);
  spots.length = Math.min(spots.length, 80);
  const fireflySpots = new Float32Array(spots.length * 4);
  spots.forEach((s, i) => {
    fireflySpots[i * 4] = s.x;
    fireflySpots[i * 4 + 1] = s.y;
    fireflySpots[i * 4 + 2] = s.z;
    fireflySpots[i * 4 + 3] = s.w;
  });

  const trees = new Map<TreeSpeciesId, ScatterLayer>();
  for (const [id, recs] of treeRecs) trees.set(id, packLayer(recs, size));
  return {
    trees,
    shrubs: packLayer(shrubRecs, size),
    crops: packLayer(cropRecs, size),
    fireflySpots,
  };
}
