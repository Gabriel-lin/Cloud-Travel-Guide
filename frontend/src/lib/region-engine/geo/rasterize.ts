/**
 * 矢量 → 网格遮罩光栅化。
 *
 * - 面要素(水体/森林/农田/城区/沙地/灌丛/湿地):OffscreenCanvas 2D 填充后读回。
 * - 河道折线:手工盘刷刻印 —— 沿线步进,写入河床剖面(1=中心)、单位流向、逐河哈希。
 */

import type { Coords, LandKind, OsmData, RegionMasks, RiverLine } from "../types";
import { hash01 } from "./overpass";

function maskFromPolys(rings: Coords[], res: number, size: number): Float32Array {
  const out = new Float32Array(res * res);
  if (rings.length === 0) return out;
  const canvas = new OffscreenCanvas(res, res);
  const ctx = canvas.getContext("2d");
  if (!ctx) return out;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, res, res);
  ctx.fillStyle = "#fff";
  const toPx = (v: number) => (v / size + 0.5) * res;
  for (const ring of rings) {
    ctx.beginPath();
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const px = toPx(ring[i * 2] as number);
      const py = toPx(ring[i * 2 + 1] as number);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
  const img = ctx.getImageData(0, 0, res, res).data;
  for (let i = 0; i < out.length; i++) {
    out[i] = (img[i * 4] as number) / 255;
  }
  return out;
}

function stampRivers(
  rivers: RiverLine[],
  res: number,
  size: number,
  profile: Float32Array,
  flowX: Float32Array,
  flowZ: Float32Array,
  riverHash: Float32Array,
): void {
  const texel = size / res;
  const toPx = (v: number) => (v / size + 0.5) * res;

  for (const river of rivers) {
    const rh = hash01(river.id);
    const halfW = river.width / 2;
    const rPx = Math.max(halfW / texel, 1.1);
    const n = river.pts.length / 2;
    for (let i = 0; i < n - 1; i++) {
      const x0 = river.pts[i * 2] as number;
      const z0 = river.pts[i * 2 + 1] as number;
      const x1 = river.pts[i * 2 + 2] as number;
      const z1 = river.pts[i * 2 + 3] as number;
      const dx = x1 - x0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      const dirX = dx / len;
      const dirZ = dz / len;
      const steps = Math.max(2, Math.ceil(len / (texel * 0.5)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const cx = toPx(x0 + dx * t);
        const cz = toPx(z0 + dz * t);
        const ir = Math.ceil(rPx);
        const px0 = Math.max(0, Math.floor(cx - ir));
        const px1 = Math.min(res - 1, Math.ceil(cx + ir));
        const pz0 = Math.max(0, Math.floor(cz - ir));
        const pz1 = Math.min(res - 1, Math.ceil(cz + ir));
        for (let pz = pz0; pz <= pz1; pz++) {
          for (let px = px0; px <= px1; px++) {
            const d = Math.hypot(px + 0.5 - cx, pz + 0.5 - cz);
            if (d > rPx) continue;
            const k = 1 - (d / rPx) * (d / rPx); // 抛物线河床剖面
            const idx = pz * res + px;
            if (k > (profile[idx] as number)) {
              profile[idx] = k;
              flowX[idx] = dirX;
              flowZ[idx] = dirZ;
              riverHash[idx] = rh;
            }
          }
        }
      }
    }
  }
}

export function rasterizeMasks(
  osm: OsmData,
  res: number,
  size: number,
): RegionMasks {
  const byKind = new Map<LandKind, Coords[]>();
  for (const poly of osm.land) {
    const arr = byKind.get(poly.kind) ?? [];
    arr.push(poly.ring);
    byKind.set(poly.kind, arr);
  }
  const get = (kind: LandKind) => maskFromPolys(byKind.get(kind) ?? [], res, size);

  const water = get("water");
  const forest = get("forest");
  const farmland = get("farmland");
  const urban = get("urban");
  const sand = get("sand");
  const scrubM = get("scrub");
  const grass = get("grass");
  const wetland = get("wetland");
  // 草地并入灌丛底密度(低强度)
  for (let i = 0; i < scrubM.length; i++) {
    scrubM[i] = Math.max(scrubM[i] as number, (grass[i] as number) * 0.5);
  }

  const profile = new Float32Array(res * res);
  const flowX = new Float32Array(res * res);
  const flowZ = new Float32Array(res * res);
  const riverHash = new Float32Array(res * res);
  stampRivers(osm.rivers, res, size, profile, flowX, flowZ, riverHash);

  return {
    res,
    size,
    water,
    riverProfile: profile,
    flowX,
    flowZ,
    riverHash,
    forest,
    farmland,
    urban,
    sand,
    scrub: scrubM,
    wetland,
  };
}
