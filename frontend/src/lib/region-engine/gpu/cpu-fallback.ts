/**
 * WebGL2 降级路径:侵蚀跳过(DEM 自带真实侵蚀地貌),
 * 细节放大 / 河道刻蚀 / 湿度扩散 / 生物群系分类用 CPU 等价实现(同一套参数)。
 */

import { BIOME } from "../const";
import type { RegionMasks } from "../types";

/** 确定性 value-noise fbm(与 TSL 路径参数对齐,实现不同但统计一致) */
export function makeFbm(seed: number) {
  const hash = (x: number, y: number): number => {
    let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const noise = (x: number, y: number): number => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
  };
  return (x: number, y: number, octaves: number): number => {
    let sum = 0;
    let amp = 0.5;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += (noise(x * f, y * f) * 2 - 1) * amp;
      f *= 2;
      amp *= 0.5;
    }
    return sum;
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0: number, e1: number, v: number) => {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

export function amplifyCpu(
  demRel: Float32Array,
  suppress: Float32Array,
  res: number,
  size: number,
  seed: number,
): Float32Array {
  const fbm = makeFbm(seed);
  const texel = size / res;
  const out = new Float32Array(res * res);
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const i = y * res + x;
      const xl = Math.max(x - 1, 0);
      const xr = Math.min(x + 1, res - 1);
      const yd = Math.max(y - 1, 0);
      const yu = Math.min(y + 1, res - 1);
      const gx = ((demRel[y * res + xr] as number) - (demRel[y * res + xl] as number)) / (2 * texel);
      const gy = ((demRel[yu * res + x] as number) - (demRel[yd * res + x] as number)) / (2 * texel);
      const slopeK = clamp01(Math.hypot(gx, gy) * 4);
      const wx = (x / res - 0.5) * size;
      const wz = (y / res - 0.5) * size;
      const macro = fbm(wx / 250, wz / 250, 4);
      const meso = fbm(wx / 60 + 31.7, wz / 60 + 17.3, 4);
      const amp = (0.8 + slopeK * 9) * (1 - 0.92 * clamp01(suppress[i] as number));
      out[i] = (demRel[i] as number) + (macro * 0.55 + meso * 0.3) * amp;
    }
  }
  return out;
}

export function carveCpu(
  height: Float32Array,
  masks: RegionMasks,
): { height: Float32Array; carveDepth: Float32Array } {
  const n = height.length;
  const out = new Float32Array(n);
  const depth = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = clamp01(masks.riverProfile[i] as number);
    const riverDepth = Math.pow(p, 1.25) * (2 + (masks.riverHash[i] as number) * 3.5);
    const lakeDepth = clamp01(masks.water[i] as number) * 2.8;
    const d = Math.max(riverDepth, lakeDepth);
    depth[i] = d;
    out[i] = (height[i] as number) - d;
  }
  return { height: out, carveDepth: depth };
}

export function moistureCpu(source: Float32Array, res: number): Float32Array {
  const R = 6;
  let a = new Float32Array(source.length);
  for (let i = 0; i < source.length; i++) a[i] = clamp01((source[i] as number) * 1.4);
  let b = new Float32Array(source.length);
  const blur = (src: Float32Array, dst: Float32Array, horizontal: boolean) => {
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        let acc = 0;
        for (let o = -R; o <= R; o++) {
          const cx = horizontal ? Math.min(Math.max(x + o, 0), res - 1) : x;
          const cy = horizontal ? y : Math.min(Math.max(y + o, 0), res - 1);
          acc += src[cy * res + cx] as number;
        }
        dst[y * res + x] = acc / (2 * R + 1);
      }
    }
  };
  for (let round = 0; round < 2; round++) {
    blur(a, b, true);
    blur(b, a, false);
  }
  void b;
  return a;
}

export function biomeCpu(
  height: Float32Array,
  moisture: Float32Array,
  masks: RegionMasks,
  res: number,
  size: number,
  baseAlt: number,
  seed: number,
): { biomeId: Float32Array; snow: Float32Array; vegDensity: Float32Array } {
  const fbm = makeFbm(seed + 97);
  const texel = size / res;
  const n = res * res;
  const biomeId = new Float32Array(n);
  const snow = new Float32Array(n);
  const veg = new Float32Array(n);
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const i = y * res + x;
      const h = height[i] as number;
      const hR = height[y * res + Math.min(x + 1, res - 1)] as number;
      const hU = height[Math.min(y + 1, res - 1) * res + x] as number;
      const slope = Math.hypot(hR - h, hU - h) / texel;
      const wx = (x / res - 0.5) * size;
      const wz = (y / res - 0.5) * size;
      const jitter = fbm(wx / 180, wz / 180, 3);
      const altAbs = h + baseAlt;
      const temp = 24 - altAbs * 0.0065 + jitter * 1.5;
      const moist = clamp01(moisture[i] as number);

      const snowK = clamp01(
        Math.pow(smooth(2.5, -3.5, temp) * (smooth(1.4, 0.5, slope) * 0.75 + 0.25), 0.8),
      );
      snow[i] = snowK;

      const edge = jitter * 0.22;
      const fFor = clamp01((masks.forest[i] as number) + edge);
      const fFarm = clamp01((masks.farmland[i] as number) + edge * 0.4);
      const fUrban = clamp01(masks.urban[i] as number);
      const fSand = clamp01((masks.sand[i] as number) + edge * 0.5);
      const fWet = clamp01(masks.wetland[i] as number);
      const fScrub = clamp01(masks.scrub[i] as number);

      const arid = smooth(0.12, 0.03, moist) * smooth(14, 24, temp);
      const desertK = clamp01(fSand + arid * 0.8);
      const rainK = fFor * smooth(0.5, 0.8, moist) * smooth(14, 20, temp);
      const alpineK = smooth(3400, 3900, altAbs);

      let id: number = BIOME.meadow;
      let v = 0.14 + jitter * 0.06;
      if (alpineK > 0.5) {
        id = BIOME.alpine;
        v = clamp01(0.06 - snowK * 0.05);
      }
      if (fFor > 0.42) {
        id = BIOME.forest;
        v = 0.75 + fFor * 0.25;
      }
      if (rainK > 0.4) {
        id = BIOME.rainforest;
        v = 1;
      }
      if (desertK > 0.5) {
        id = BIOME.desert;
        v = 0.03;
      }
      if (fWet > 0.45) {
        id = BIOME.wetland;
        v = 0.4;
      }
      if (fFarm > 0.45) {
        id = BIOME.farmland;
        v = 0.2;
      }
      if (fUrban > 0.45) {
        id = BIOME.urban;
        v = 0.05;
      }
      v = clamp01(v + fScrub * 0.3);
      v *= 1 - snowK * 0.9;
      biomeId[i] = id;
      veg[i] = v;
    }
  }
  return { biomeId, snow, vegDensity: veg };
}
