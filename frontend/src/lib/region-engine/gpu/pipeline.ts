/**
 * 高度场 boot 流水线编排。
 *
 * WebGPU:细节放大 → 水力/热力侵蚀 → 河道刻蚀 → 湿度扩散 → 生物群系分类(全 TSL compute)
 *        → 一次性回读 CPU 镜像(供贴地探针/散布/水面)。
 * WebGL2:CPU 等价路径(跳过侵蚀)。
 * 最后 CPU 侧计算水面高度(河:刻蚀深度回填;湖:连通域找岸线水位)。
 */

import type { Renderer, StorageBufferAttribute } from "three/webgpu";
import { EROSION_ITERS } from "../const";
import type { DemGrid, RegionMasks, WorldFields } from "../types";
import { runBiomeClassify } from "./biome";
import {
  amplifyCpu,
  biomeCpu,
  carveCpu,
  moistureCpu,
} from "./cpu-fallback";
import { runErosion } from "./erosion";
import { runHeightAmplify } from "./heightAmplify";
import { runMoisture, runRiverCarve } from "./rivers";
import type { FloatBuffer } from "./tsl-types";

export const WATER_NONE = -1e4;

async function readBuffer(
  renderer: Renderer,
  buf: FloatBuffer,
  count: number,
): Promise<Float32Array> {
  const attr = buf.value as StorageBufferAttribute;
  const ab = await renderer.getArrayBufferAsync(attr);
  return new Float32Array(ab, 0, count);
}

/** 湿度源:河道 + 水体 + 湿地 */
function moistureSource(masks: RegionMasks): Float32Array {
  const n = masks.res * masks.res;
  const src = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    src[i] = Math.max(
      masks.riverProfile[i] as number,
      masks.water[i] as number,
      (masks.wetland[i] as number) * 0.7,
    );
  }
  return src;
}

/** 城/田/水抑制场(细节放大用) */
function suppressField(masks: RegionMasks): Float32Array {
  const n = masks.res * masks.res;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.max(
      masks.urban[i] as number,
      (masks.farmland[i] as number) * 0.85,
      masks.water[i] as number,
      masks.riverProfile[i] as number,
    );
  }
  return out;
}

/**
 * 水面高度:河 = 刻蚀后高度 + 80% 刻蚀深度(水填谷);
 * 湖 = 连通域内原始地面最低点 − 0.25(BFS 洪泛)。
 */
function computeWaterY(
  heights: Float32Array,
  carveDepth: Float32Array,
  demRel: Float32Array,
  masks: RegionMasks,
  res: number,
): Float32Array {
  const n = res * res;
  const waterY = new Float32Array(n).fill(WATER_NONE);

  for (let i = 0; i < n; i++) {
    const p = masks.riverProfile[i] as number;
    if (p > 0.03) {
      const y = (heights[i] as number) + (carveDepth[i] as number) * 0.8;
      // 只有水面高于河床才算有水
      if (y > (heights[i] as number) + 0.05) waterY[i] = y;
    }
  }

  // 湖泊连通域
  const visited = new Uint8Array(n);
  const queue = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if ((masks.water[s] as number) < 0.5 || visited[s]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    visited[s] = 1;
    const cells: number[] = [];
    let minBank = Infinity;
    while (head < tail) {
      const c = queue[head++] as number;
      cells.push(c);
      const bank = demRel[c] as number;
      if (bank < minBank) minBank = bank;
      const cx = c % res;
      const cy = (c / res) | 0;
      const neigh = [
        cx > 0 ? c - 1 : -1,
        cx < res - 1 ? c + 1 : -1,
        cy > 0 ? c - res : -1,
        cy < res - 1 ? c + res : -1,
      ];
      for (const nb of neigh) {
        if (nb >= 0 && !visited[nb] && (masks.water[nb] as number) >= 0.5) {
          visited[nb] = 1;
          queue[tail++] = nb;
        }
      }
    }
    const level = minBank - 0.25;
    for (const c of cells) {
      if (level > (heights[c] as number) + 0.05) {
        waterY[c] = Math.max(waterY[c] as number, level);
      }
    }
  }
  return waterY;
}

export async function runWorldPipeline(opts: {
  renderer: Renderer;
  /** WebGPU 后端可用(compute 路径) */
  gpuCompute: boolean;
  dem: DemGrid;
  masks: RegionMasks;
  seed: number;
  onProgress?: (v: number, detail?: string) => void;
}): Promise<WorldFields> {
  const { renderer, dem, masks, seed, onProgress } = opts;
  const res = dem.res;
  const n = res * res;
  const size = dem.size;

  const demRel = new Float32Array(n);
  for (let i = 0; i < n; i++) demRel[i] = (dem.heights[i] as number) - dem.minH;
  const suppress = suppressField(masks);
  const moistSrc = moistureSource(masks);

  let heights: Float32Array;
  let carveDepth: Float32Array;
  let moisture: Float32Array;
  let biomeF: Float32Array;
  let snow: Float32Array;
  let vegDensity: Float32Array;

  if (opts.gpuCompute) {
    onProgress?.(0.05, "amplify");
    const amp = await runHeightAmplify(renderer, demRel, suppress, res, size, seed);

    const ero = await runErosion(renderer, amp.height, amp.hardness, {
      res,
      texel: size / res,
      iters: EROSION_ITERS,
      onProgress: (done, total) =>
        onProgress?.(0.08 + (done / total) * 0.55, "erosion"),
    });

    onProgress?.(0.66, "rivers");
    const carve = await runRiverCarve(
      renderer,
      ero.eroded,
      masks.riverProfile,
      masks.riverHash,
      masks.water,
      res,
    );
    onProgress?.(0.72, "moisture");
    const moistBuf = await runMoisture(renderer, moistSrc, ero.water, res);
    onProgress?.(0.78, "biome");
    const bio = await runBiomeClassify(
      renderer,
      carve.height,
      moistBuf,
      {
        forest: masks.forest,
        farmland: masks.farmland,
        urban: masks.urban,
        sand: masks.sand,
        wetland: masks.wetland,
        scrub: masks.scrub,
        grass: masks.grass,
      },
      res,
      size,
      dem.minH,
      seed,
    );

    onProgress?.(0.86, "readback");
    heights = await readBuffer(renderer, carve.height, n);
    carveDepth = await readBuffer(renderer, carve.carveDepth, n);
    moisture = await readBuffer(renderer, moistBuf, n);
    biomeF = await readBuffer(renderer, bio.biomeId, n);
    snow = await readBuffer(renderer, bio.snow, n);
    vegDensity = await readBuffer(renderer, bio.vegDensity, n);
  } else {
    // WebGL2 降级:跳过侵蚀(见 docs/regional-terrain-engine-plan.md DEVIATIONS)
    onProgress?.(0.1, "amplify(cpu)");
    const amped = amplifyCpu(demRel, suppress, res, size, seed);
    onProgress?.(0.4, "rivers(cpu)");
    const carved = carveCpu(amped, masks);
    heights = carved.height;
    carveDepth = carved.carveDepth;
    onProgress?.(0.6, "moisture(cpu)");
    moisture = moistureCpu(moistSrc, res);
    onProgress?.(0.8, "biome(cpu)");
    const bio = biomeCpu(heights, moisture, masks, res, size, dem.minH, seed);
    biomeF = bio.biomeId;
    snow = bio.snow;
    vegDensity = bio.vegDensity;
  }

  onProgress?.(0.94, "water levels");
  const waterY = computeWaterY(heights, carveDepth, demRel, masks, res);

  const biome = new Uint8Array(n);
  for (let i = 0; i < n; i++) biome[i] = biomeF[i] as number;

  onProgress?.(1);
  return {
    res,
    size,
    seed,
    heights,
    waterY,
    moisture,
    biome,
    snow,
    vegDensity,
    baseAlt: dem.minH,
    masks,
  };
}
