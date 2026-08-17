/**
 * 矢量 → 网格遮罩光栅化。
 *
 * - 面要素(水体/森林/农田/城区/沙地/灌丛/湿地):OffscreenCanvas 2D 填充后读回。
 * - 河道折线:手工盘刷刻印 —— 沿线步进,写入河床剖面(1=中心,含岸坡肩部缓坡)、
 *   单位流向(后处理平滑 + 外扩)、逐河刻深(米,随河宽缩放)。
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

/** 水缘处的剖面值:k > 该值属于河床(有水),之下为岸坡肩部(无水缓坡) */
const SHOULDER_K = 0.32;

function stampRivers(
  rivers: RiverLine[],
  res: number,
  size: number,
  profile: Float32Array,
  flowX: Float32Array,
  flowZ: Float32Array,
  riverDepth: Float32Array,
): void {
  const texel = size / res;
  const toPx = (v: number) => (v / size + 0.5) * res;

  for (const river of rivers) {
    const rh = hash01(river.id);
    // 刻深随河宽缩放:窄溪 ~0.6-1.7 m,大河 3.6-10 m,不再把小溪刻成峡谷
    const widthK = Math.min(Math.max(Math.pow(river.width / 30, 0.8), 0.3), 1.8);
    const depthM = (2 + rh * 3.5) * widthK;
    const halfW = river.width / 2;
    // 核心(水面)半宽 + 肩部缓坡:岸线不再是折痕,而是平滑没入地形
    const rCore = Math.max(halfW / texel, 1.4);
    const rTot = rCore * 2.1;
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
        const ir = Math.ceil(rTot);
        const px0 = Math.max(0, Math.floor(cx - ir));
        const px1 = Math.min(res - 1, Math.ceil(cx + ir));
        const pz0 = Math.max(0, Math.floor(cz - ir));
        const pz1 = Math.min(res - 1, Math.ceil(cz + ir));
        for (let pz = pz0; pz <= pz1; pz++) {
          for (let px = px0; px <= px1; px++) {
            const d = Math.hypot(px + 0.5 - cx, pz + 0.5 - cz);
            if (d > rTot) continue;
            let k: number;
            if (d <= rCore) {
              // 河床:抛物线,中心 1 → 水缘 SHOULDER_K
              const u = d / rCore;
              k = 1 - (1 - SHOULDER_K) * u * u;
            } else {
              // 岸坡肩部:SHOULDER_K → 0 平滑过渡(smoothstep)
              const u = (d - rCore) / (rTot - rCore);
              k = SHOULDER_K * (1 - u * u * (3 - 2 * u));
            }
            const idx = pz * res + px;
            if (k > (profile[idx] as number)) {
              profile[idx] = k;
              flowX[idx] = dirX;
              flowZ[idx] = dirZ;
              riverDepth[idx] = depthM;
            }
          }
        }
      }
    }
  }
}

/**
 * 流向场后处理:
 * 1. 河道内 3×3 均值平滑 ×2 —— 折线段交接处的方向硬跳变会让波纹突然拐弯;
 * 2. Jacobi 外扩 ×5 —— 把流向传播到岸线外(水面网格与苔藓带比河道 stamp 更宽)。
 */
function refineFlowField(
  flowX: Float32Array,
  flowZ: Float32Array,
  res: number,
): void {
  const n = res * res;
  const tmpX = new Float32Array(n);
  const tmpZ = new Float32Array(n);

  const pass = (dilate: boolean): void => {
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        const i = y * res + x;
        const selfX = flowX[i] as number;
        const selfZ = flowZ[i] as number;
        const selfMag = Math.hypot(selfX, selfZ);
        if (dilate && selfMag > 1e-4) {
          // 外扩轮只填空 texel
          tmpX[i] = selfX;
          tmpZ[i] = selfZ;
          continue;
        }
        let ax = 0;
        let az = 0;
        let cnt = 0;
        for (let oz = -1; oz <= 1; oz++) {
          for (let ox = -1; ox <= 1; ox++) {
            const cx = Math.min(Math.max(x + ox, 0), res - 1);
            const cz = Math.min(Math.max(y + oz, 0), res - 1);
            const j = cz * res + cx;
            const vx = flowX[j] as number;
            const vz = flowZ[j] as number;
            if (Math.hypot(vx, vz) > 1e-4) {
              ax += vx;
              az += vz;
              cnt++;
            }
          }
        }
        if (cnt === 0 || (!dilate && selfMag <= 1e-4)) {
          // 平滑轮不外扩;空邻域保持为 0
          tmpX[i] = dilate ? 0 : selfX;
          tmpZ[i] = dilate ? 0 : selfZ;
          continue;
        }
        const mag = Math.hypot(ax, az);
        if (mag > 1e-4) {
          tmpX[i] = ax / mag;
          tmpZ[i] = az / mag;
        } else {
          tmpX[i] = selfX;
          tmpZ[i] = selfZ;
        }
      }
    }
    flowX.set(tmpX);
    flowZ.set(tmpZ);
  };

  pass(false);
  pass(false);
  for (let r = 0; r < 5; r++) pass(true);
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
  // 草地兼作灌丛底密度(低强度);grass 本身独立输出驱动草毯
  for (let i = 0; i < scrubM.length; i++) {
    scrubM[i] = Math.max(scrubM[i] as number, (grass[i] as number) * 0.5);
  }

  const profile = new Float32Array(res * res);
  const flowX = new Float32Array(res * res);
  const flowZ = new Float32Array(res * res);
  const riverDepth = new Float32Array(res * res);
  stampRivers(osm.rivers, res, size, profile, flowX, flowZ, riverDepth);
  refineFlowField(flowX, flowZ, res);

  return {
    res,
    size,
    water,
    riverProfile: profile,
    flowX,
    flowZ,
    riverDepth,
    forest,
    farmland,
    urban,
    sand,
    scrub: scrubM,
    wetland,
    grass,
  };
}

/**
 * 湖盆 0..1:岸边 → 0,向湖心平滑升到 1。
 * 切比雪夫+对角 Chamfer 距离,约 14 texel(~55 m) 达到满深 ——
 * 小塘保持浅碟,大湖心才有真正的深槽。
 */
export function buildLakeBowl(water: Float32Array, res: number): Float32Array {
  const n = res * res;
  const dist = new Float32Array(n);
  const INF = 1e5;
  for (let i = 0; i < n; i++) dist[i] = (water[i] as number) >= 0.5 ? INF : 0;

  const relax = (x: number, y: number, ox: number, oy: number, step: number, i: number) => {
    const nx = x + ox;
    const ny = y + oy;
    if (nx < 0 || ny < 0 || nx >= res || ny >= res) return;
    const d = (dist[ny * res + nx] as number) + step;
    if (d < (dist[i] as number)) dist[i] = d;
  };

  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const i = y * res + x;
      if ((dist[i] as number) === 0) continue;
      relax(x, y, -1, 0, 1, i);
      relax(x, y, 0, -1, 1, i);
      relax(x, y, -1, -1, 1.414, i);
      relax(x, y, 1, -1, 1.414, i);
    }
  }
  for (let y = res - 1; y >= 0; y--) {
    for (let x = res - 1; x >= 0; x--) {
      const i = y * res + x;
      if ((dist[i] as number) === 0) continue;
      relax(x, y, 1, 0, 1, i);
      relax(x, y, 0, 1, 1, i);
      relax(x, y, 1, 1, 1.414, i);
      relax(x, y, -1, 1, 1.414, i);
    }
  }

  const bowl = new Float32Array(n);
  const reach = 14;
  for (let i = 0; i < n; i++) {
    if ((water[i] as number) < 0.5) {
      bowl[i] = 0;
      continue;
    }
    const t = Math.min((dist[i] as number) / reach, 1);
    bowl[i] = t * t * (3 - 2 * t);
  }
  return bowl;
}
