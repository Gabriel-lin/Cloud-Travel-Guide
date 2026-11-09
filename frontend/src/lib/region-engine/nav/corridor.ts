/**
 * 路线走廊:移走压在步道上的树 / 灌木 / 作物,并烘焙"到步道最近点的向量"纹理。
 *
 * 向量场在线段附近是线性的,硬件双线性插值后取长度即为精确距离
 * (直接存距离会在中线处插值成钝角,步道读出来又宽又糊)。草地据此踩出步道。
 */

import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  RGFormat,
  UnsignedByteType,
} from "three";
import { chunkIdOf, INSTANCE_STRIDE, type ScatterLayer, type ScatterResult } from "../veg/scatter";
import type { RegionTour } from "./types";

/** 步道向量纹理量程(米):|v| 超出视为远离步道 */
export const TRAIL_RANGE = 12;

type Seg = { ax: number; az: number; bx: number; bz: number };

function tourSegments(tour: RegionTour): Seg[] {
  const pts = tour.walk;
  const segs: Seg[] = [];
  const n = pts.length;
  const count = tour.kind === "o" ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
  }
  return segs;
}

function nearestOnSeg(s: Seg, x: number, z: number): { x: number; z: number } {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 1e-8 ? Math.min(1, Math.max(0, ((x - s.ax) * dx + (z - s.az) * dz) / len2)) : 0;
  return { x: s.ax + dx * t, z: s.az + dz * t };
}

/** 线段分桶:点到折线的最近距离查询 */
class SegmentGrid {
  private readonly buckets = new Map<number, Seg[]>();

  constructor(
    segs: Seg[],
    private readonly cell: number,
    pad: number,
  ) {
    for (const s of segs) {
      const x0 = Math.floor((Math.min(s.ax, s.bx) - pad) / cell);
      const x1 = Math.floor((Math.max(s.ax, s.bx) + pad) / cell);
      const z0 = Math.floor((Math.min(s.az, s.bz) - pad) / cell);
      const z1 = Math.floor((Math.max(s.az, s.bz) + pad) / cell);
      for (let bz = z0; bz <= z1; bz++) {
        for (let bx = x0; bx <= x1; bx++) {
          const k = this.key(bx, bz);
          const list = this.buckets.get(k);
          if (list) list.push(s);
          else this.buckets.set(k, [s]);
        }
      }
    }
  }

  private key(bx: number, bz: number): number {
    return (bz + 4096) * 8192 + (bx + 4096);
  }

  dist(x: number, z: number): number {
    const list = this.buckets.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!list) return Infinity;
    let best = Infinity;
    for (const s of list) {
      const q = nearestOnSeg(s, x, z);
      const d = (q.x - x) * (q.x - x) + (q.z - z) * (q.z - z);
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }
}

/** 过滤实例并重建 chunk 索引(实例本就按 chunk 连续,稳定过滤保持顺序) */
function filterLayer(
  layer: ScatterLayer,
  size: number,
  keep: (x: number, z: number, scale: number) => boolean,
): ScatterLayer {
  const src = layer.data;
  const kept: number[] = [];
  for (let i = 0; i < layer.count; i++) {
    const o = i * INSTANCE_STRIDE;
    if (keep(src[o] as number, src[o + 2] as number, src[o + 3] as number)) kept.push(i);
  }
  if (kept.length === layer.count) return layer;
  const data = new Float32Array(kept.length * INSTANCE_STRIDE);
  const chunkIndex = new Map<number, [number, number]>();
  for (let j = 0; j < kept.length; j++) {
    const so = kept[j]! * INSTANCE_STRIDE;
    data.set(src.subarray(so, so + INSTANCE_STRIDE), j * INSTANCE_STRIDE);
    const chunk = chunkIdOf(src[so] as number, src[so + 2] as number, size);
    const entry = chunkIndex.get(chunk);
    if (entry) entry[1]++;
    else chunkIndex.set(chunk, [j, 1]);
  }
  return { data, count: kept.length, chunkIndex };
}

/** 清出步道走廊:树按树干 + 下层冠幅,灌木按冠幅,作物留一条田埂 */
export function clearTourCorridor(scatter: ScatterResult, tour: RegionTour, size: number): void {
  const grid = new SegmentGrid(tourSegments(tour), 16, 6);
  for (const [id, layer] of scatter.trees) {
    scatter.trees.set(
      id,
      filterLayer(layer, size, (x, z, s) => grid.dist(x, z) >= 2.2 + 1.8 * s),
    );
  }
  scatter.shrubs = filterLayer(scatter.shrubs, size, (x, z, s) => grid.dist(x, z) >= 1.3 + 1.1 * s);
  scatter.crops = filterLayer(scatter.crops, size, (x, z) => grid.dist(x, z) >= 1.6);
}

function enc(v: number): number {
  const c = Math.min(Math.max(v, -TRAIL_RANGE), TRAIL_RANGE);
  return Math.round((c / (2 * TRAIL_RANGE) + 0.5) * 255);
}

/** RG8:到步道最近点的向量(格心起算),无步道处为 (+R,+R) */
export function buildTrailTexture(tour: RegionTour | null, res: number, size: number): DataTexture {
  const n = tour ? res : 1;
  const data = new Uint8Array(n * n * 2).fill(255);
  if (tour) {
    const texel = size / res;
    const best = new Float32Array(res * res).fill(Infinity);
    const r2max = TRAIL_RANGE * TRAIL_RANGE;
    for (const s of tourSegments(tour)) {
      const x0 = Math.max(0, Math.floor((Math.min(s.ax, s.bx) - TRAIL_RANGE) / texel + res / 2));
      const x1 = Math.min(res - 1, Math.ceil((Math.max(s.ax, s.bx) + TRAIL_RANGE) / texel + res / 2));
      const z0 = Math.max(0, Math.floor((Math.min(s.az, s.bz) - TRAIL_RANGE) / texel + res / 2));
      const z1 = Math.min(res - 1, Math.ceil((Math.max(s.az, s.bz) + TRAIL_RANGE) / texel + res / 2));
      for (let cz = z0; cz <= z1; cz++) {
        const z = ((cz + 0.5) / res - 0.5) * size;
        for (let cx = x0; cx <= x1; cx++) {
          const x = ((cx + 0.5) / res - 0.5) * size;
          const q = nearestOnSeg(s, x, z);
          const dx = q.x - x;
          const dz = q.z - z;
          const d2 = dx * dx + dz * dz;
          const i = cz * res + cx;
          if (d2 > r2max || d2 >= (best[i] as number)) continue;
          best[i] = d2;
          data[i * 2] = enc(dx);
          data[i * 2 + 1] = enc(dz);
        }
      }
    }
  }
  const tex = new DataTexture(data, n, n, RGFormat, UnsignedByteType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
