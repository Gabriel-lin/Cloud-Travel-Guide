/**
 * 把分型骨架加密成 walk / fly 两条三维折线。
 *
 * 水面判定与渲染同源(外扩水位与地形相交处都算水),离水远近用有符号距离场。
 * 河边:走廊内代价网格 A*(两岸各跑一次取低代价;贴岸带 ≈20 m,近水/水面/
 *       建筑/陡崖重罚,植被轻罚)→ 视线拉直 → 弹性带平滑 + 约束投影,永不入水。
 * 湖边:湖心放射到目标岸距成环,同一弹性带收尾。
 * 其他:骨架绕开实体、弦不过山脊,再交给弹性带(离水 ≥ 8 m)。
 * fly 同一 XZ(O 型略放大),避开建筑足迹;高度按整条航线定:周边地表 + 净空为下限,
 * 短下凹填平、限坡爬降 —— 无障碍处保持同一高度,不随地形逐点起伏。
 */

import { Vector3 } from "three";
import { rasterizeRings } from "../geo/rasterize";
import { sampleCpu, sampleWaterCpu } from "../render/fields";
import type { BuildingFoot, RiverLine, WorldFields } from "../types";
import { INSTANCE_STRIDE, type ScatterLayer, type ScatterResult } from "../veg/scatter";
import { classifyRegion } from "./classify";
import {
  bankRoute,
  buildNavField,
  lakeRing,
  navCell,
  relaxBand,
  resamplePath,
  type BandOpts,
  type NavField,
} from "./navField";
import type { RegionTour, TourClassification } from "./types";

/** 航线净空:高出两侧 FLY_LATERAL 内最高地表/水面的米数 */
const FLY_CLEAR_M = 55;
const FLY_LATERAL = 70;
/** 短于此长度的下凹直接填平,保持同一高度 */
const FLY_HOLD_M = 420;
/** 爬升 / 下降坡度上限 */
const FLY_GRADE = 0.12;
const SLOPE_MAX = 0.45;
/** 当作实体陡崖:超过则绕行,不沿坡面直穿 */
const CLIFF_SLOPE = 1.05;
const MARGIN = 140;
const CLEAR_M = 6;
/** 弦中点地形高出两端线性插值多少米,视为穿山 */
const HILL_CHORD_M = 4.2;
const A_STAR_PAD = 180;
const A_STAR_CAP = 14_000;
/** 贴岸带:目标 / 最近 / 最远离水距离(米,自可见水缘起算) */
const BANK_TARGET = 20;
const BANK_MIN = 10;
const BANK_MAX = 46;
/** 非水边路线离水最近距离 */
const DRY_MIN = 8;
/** 短于此长度的路线视为退化(塌成一点/一小段),换下一种生成方式 */
const MIN_TOUR_M = 300;
/** 步行折线贴地抬高,丝带再叠一点,避免陷入地表 */
const GROUND_LIFT = 0.08;

type Xz = { x: number; z: number };

type Sampler = {
  res: number;
  size: number;
  half: number;
  texel: number;
  nav: NavField;
  height: (x: number, z: number) => number;
  water: (x: number, z: number) => number;
  slope: (x: number, z: number) => number;
  urban: (x: number, z: number) => number;
  /** 步行实体:建筑避让带 / 可见水面 / 陡崖 */
  walkSolid: (x: number, z: number) => boolean;
  /** 飞行实体:建筑体积 */
  flySolid: (x: number, z: number) => boolean;
};

function xzToCell(x: number, z: number, res: number, size: number): [number, number] {
  const cx = Math.min(Math.max(Math.floor((x / size + 0.5) * res), 0), res - 1);
  const cz = Math.min(Math.max(Math.floor((z / size + 0.5) * res), 0), res - 1);
  return [cx, cz];
}

function cellToXz(cx: number, cz: number, res: number, size: number): Xz {
  return {
    x: ((cx + 0.5) / res - 0.5) * size,
    z: ((cz + 0.5) / res - 0.5) * size,
  };
}

function cellHit(grid: Uint8Array, res: number, cx: number, cz: number): boolean {
  if (cx < 0 || cz < 0 || cx >= res || cz >= res) return true;
  return (grid[cz * res + cx] as number) !== 0;
}

function sampleSolid(grid: Uint8Array, x: number, z: number, res: number, size: number): boolean {
  const [cx, cz] = xzToCell(x, z, res, size);
  return cellHit(grid, res, cx, cz);
}

function dilateMask(src: Float32Array, res: number, passes: number): Uint8Array {
  const n = res * res;
  let cur = new Uint8Array(n);
  for (let i = 0; i < n; i++) cur[i] = (src[i] as number) > 0.4 ? 1 : 0;
  if (passes <= 0) return cur;
  let next = new Uint8Array(n);
  for (let p = 0; p < passes; p++) {
    next.set(cur);
    for (let z = 1; z < res - 1; z++) {
      for (let x = 1; x < res - 1; x++) {
        const i = z * res + x;
        if (cur[i]) continue;
        if (cur[i - 1] || cur[i + 1] || cur[i - res] || cur[i + res]) next[i] = 1;
      }
    }
    const tmp = cur;
    cur = next;
    next = tmp;
  }
  return cur;
}

function stampDisk(grid: Uint8Array, res: number, size: number, x: number, z: number, radius: number): void {
  const texel = size / res;
  const [cx, cz] = xzToCell(x, z, res, size);
  const r = Math.max(1, Math.ceil(radius / texel));
  const r2 = r * r;
  for (let dz = -r; dz <= r; dz++) {
    const zz = cz + dz;
    if (zz < 0 || zz >= res) continue;
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz > r2) continue;
      const xx = cx + dx;
      if (xx < 0 || xx >= res) continue;
      grid[zz * res + xx] = 1;
    }
  }
}

function stampLayer(grid: Uint8Array, layer: ScatterLayer, res: number, size: number, rK: number, r0: number): void {
  for (let i = 0; i < layer.count; i++) {
    const o = i * INSTANCE_STRIDE;
    stampDisk(grid, res, size, layer.data[o] as number, layer.data[o + 2] as number, r0 + rK * (layer.data[o + 3] as number));
  }
}

function stampPlants(scatter: ScatterResult | null, res: number, size: number): Uint8Array {
  const grid = new Uint8Array(res * res);
  if (!scatter) return grid;
  for (const layer of scatter.trees.values()) stampLayer(grid, layer, res, size, 3.2, 1.6);
  stampLayer(grid, scatter.shrubs, res, size, 1.8, 1.1);
  return grid;
}

function bakeSolids(
  fields: WorldFields,
  buildings: BuildingFoot[],
  scatter: ScatterResult | null,
): { walk: Uint8Array; fly: Uint8Array; nav: NavField } {
  const { res, size } = fields;
  const n = res * res;
  const raster = rasterizeRings(
    buildings.map((b) => b.ring),
    res,
    size,
  );
  const foot = dilateMask(raster, res, 0);
  const built = dilateMask(raster, res, Math.max(1, Math.round(CLEAR_M / (size / res))));
  const plant = stampPlants(scatter, res, size);
  const nav = buildNavField(fields, foot, built, plant, CLIFF_SLOPE);
  const walk = new Uint8Array(n);
  const fly = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const bld = built[i] === 1;
    fly[i] = bld ? 1 : 0;
    walk[i] = bld || nav.water[i] === 1 || nav.cliff[i] === 1 ? 1 : 0;
  }
  return { walk, fly, nav };
}

function makeSampler(
  fields: WorldFields,
  buildings: BuildingFoot[],
  scatter: ScatterResult | null,
): Sampler {
  const { res, size, heights, waterY, masks } = fields;
  const texel = size / res;
  const solids = bakeSolids(fields, buildings, scatter);
  return {
    res,
    size,
    half: size / 2,
    texel,
    nav: solids.nav,
    height: (x, z) => sampleCpu(heights, x, z, res, size),
    water: (x, z) => sampleWaterCpu(waterY, x, z, res, size),
    slope: (x, z) => {
      const h = sampleCpu(heights, x, z, res, size);
      return (
        Math.hypot(
          sampleCpu(heights, x + texel, z, res, size) - h,
          sampleCpu(heights, x, z + texel, res, size) - h,
        ) / texel
      );
    },
    urban: (x, z) => sampleCpu(masks.urban, x, z, res, size),
    walkSolid: (x, z) => sampleSolid(solids.walk, x, z, res, size),
    flySolid: (x, z) => sampleSolid(solids.fly, x, z, res, size),
  };
}

function clampXZ(p: Xz, half: number): Xz {
  const lim = half - MARGIN;
  return {
    x: Math.min(Math.max(p.x, -lim), lim),
    z: Math.min(Math.max(p.z, -lim), lim),
  };
}

/** 可见水面(与渲染一致,含低岸被外扩水位淹没的部分) */
function wet(s: Sampler, x: number, z: number): boolean {
  return s.nav.water[navCell(s.nav, x, z)] === 1;
}

function score(s: Sampler, x: number, z: number): number {
  const lim = s.half - MARGIN;
  if (Math.abs(x) > lim || Math.abs(z) > lim) return -400;
  if (s.walkSolid(x, z)) return -900;
  let v = 0;
  if (wet(s, x, z)) v -= 90;
  v -= Math.max(0, s.slope(x, z) - SLOPE_MAX) * 80;
  if (s.urban(x, z) > 0.55) v -= 18;
  return v;
}

function tangentAt(pts: Xz[], i: number): Xz {
  const a = pts[Math.max(i - 1, 0)]!;
  const b = pts[Math.min(i + 1, pts.length - 1)]!;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return { x: 1, z: 0 };
  return { x: dx / len, z: dz / len };
}

function landNormal(spine: Xz[], i: number, sign: number): Xz {
  const t = tangentAt(spine, i);
  return { x: -t.z * sign, z: t.x * sign };
}

function resampleOpen(pts: Xz[], spacing: number): Xz[] {
  if (pts.length < 2) return pts.map((p) => ({ ...p }));
  const seg = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    total += Math.hypot(b.x - a.x, b.z - a.z);
    seg.push(total);
  }
  if (total < spacing) return [pts[0]!, pts[pts.length - 1]!];
  const n = Math.min(Math.max(4, Math.round(total / spacing)), 900);
  const out: Xz[] = [];
  for (let k = 0; k <= n; k++) {
    const d = (k / n) * total;
    let i = 1;
    while (i < seg.length && (seg[i] as number) < d) i++;
    const d1 = seg[i] as number;
    const d0 = seg[i - 1] as number;
    const a = pts[i - 1]!;
    const b = pts[Math.min(i, pts.length - 1)]!;
    const t = d1 - d0 > 1e-6 ? (d - d0) / (d1 - d0) : 0;
    out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  }
  return out;
}

/** 河岸 A* 失败时的退路:河心整体平移到较干一侧,再交给弹性带收进贴岸带 */
function offsetRiverSpine(s: Sampler, spine: Xz[], offset: number): Xz[] {
  const pts = resampleOpen(spine, 20);
  let best = pts;
  let bestDry = -1;
  for (const side of [1, -1]) {
    const cand = pts.map((p, i) => {
      const n = landNormal(pts, i, side);
      return clampXZ({ x: p.x + n.x * offset, z: p.z + n.z * offset }, s.half);
    });
    let dry = 0;
    for (const q of cand) if (!s.walkSolid(q.x, q.z)) dry++;
    if (dry > bestDry) {
      bestDry = dry;
      best = cand;
    }
  }
  return best;
}

function ellipseRing(cls: TourClassification, count: number, scale: number): Xz[] {
  const { anchor, radiusX, radiusZ, yaw } = cls;
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const out: Xz[] = [];
  for (let i = 0; i < count; i++) {
    const u = (i / count) * Math.PI * 2;
    const lx = Math.cos(u) * radiusX * scale;
    const lz = Math.sin(u) * radiusZ * scale;
    out.push({
      x: anchor.x + lx * c - lz * sn,
      z: anchor.z + lx * sn + lz * c,
    });
  }
  return out;
}

function relaxOpen(pts: Xz[], s: Sampler): Xz[] {
  const next = pts.map((p) => ({ ...p }));
  const e = 14;
  for (let iter = 0; iter < 8; iter++) {
    for (let i = 0; i < next.length; i++) {
      const p = next[i]!;
      const gx = score(s, p.x + e, p.z) - score(s, p.x - e, p.z);
      const gz = score(s, p.x, p.z + e) - score(s, p.x, p.z - e);
      const mag = Math.hypot(gx, gz) || 1;
      const step = Math.min(12, mag * 0.012);
      p.x += (gx / mag) * step;
      p.z += (gz / mag) * step;
      const c = clampXZ(p, s.half);
      p.x = c.x;
      p.z = c.z;
    }
    for (let i = 1; i < next.length - 1; i++) {
      const a = next[i - 1]!;
      const b = next[i]!;
      const c = next[i + 1]!;
      const nx = b.x * 0.62 + (a.x + c.x) * 0.19;
      const nz = b.z * 0.62 + (a.z + c.z) * 0.19;
      if (!s.walkSolid(nx, nz)) {
        b.x = nx;
        b.z = nz;
      }
    }
  }
  return next;
}

function relaxLoop(pts: Xz[], s: Sampler, anchor: Xz, rMin: number, rMax: number): Xz[] {
  const next = pts.map((p) => ({ ...p }));
  for (let iter = 0; iter < 8; iter++) {
    for (const p of next) {
      const vx = p.x - anchor.x;
      const vz = p.z - anchor.z;
      let r = Math.hypot(vx, vz) || 1;
      const bad = s.walkSolid(p.x, p.z) || s.slope(p.x, p.z) > SLOPE_MAX;
      if (bad) r += 22;
      r = Math.min(Math.max(r, rMin), rMax);
      const ux = vx / (Math.hypot(vx, vz) || 1);
      const uz = vz / (Math.hypot(vx, vz) || 1);
      p.x = anchor.x + ux * r;
      p.z = anchor.z + uz * r;
      const c = clampXZ(p, s.half);
      p.x = c.x;
      p.z = c.z;
    }
  }
  return next;
}

/** 航线安全下限:两圈 16 个采样点 + 中心的最高地表/水面 + 净空 */
function flyFloor(s: Sampler, x: number, z: number): number {
  let m = -Infinity;
  const take = (px: number, pz: number): void => {
    m = Math.max(m, s.height(px, pz));
    const w = s.water(px, pz);
    if (Number.isFinite(w)) m = Math.max(m, w);
  };
  take(x, z);
  for (const [r, phase] of [
    [FLY_LATERAL * 0.5, 0],
    [FLY_LATERAL, Math.PI / 8],
  ] as const) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + phase;
      take(x + Math.cos(a) * r, z + Math.sin(a) * r);
    }
  }
  return m + FLY_CLEAR_M;
}

function slidingExtreme(src: Float64Array, half: number, loop: boolean, pickMax: boolean): Float64Array {
  const n = src.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let v = src[i] as number;
    for (let k = -half; k <= half; k++) {
      let j = i + k;
      if (loop) j = ((j % n) + n) % n;
      else if (j < 0 || j >= n) continue;
      const u = src[j] as number;
      v = pickMax ? Math.max(v, u) : Math.min(v, u);
    }
    out[i] = v;
  }
  return out;
}

/**
 * 平飞高度剖面:下限先做闭运算(窄于 FLY_HOLD_M 的下凹填平),
 * 再限坡(只抬不压:提前爬升、缓慢回落),坡道与平台交界抹圆后保底。
 */
function flatAltitude(floorArr: number[], pts: Xz[], loop: boolean): Float64Array {
  const n = floorArr.length;
  const floor = Float64Array.from(floorArr);
  if (n < 3) return floor;
  let total = 0;
  for (let i = 1; i < n; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z);
  const step = Math.max(total / (n - 1), 0.5);
  const half = Math.max(1, Math.round(FLY_HOLD_M / 2 / step));
  const y = slidingExtreme(slidingExtreme(floor, half, loop, true), half, loop, false);
  const dy = FLY_GRADE * step;
  const limitGrade = (): void => {
    for (let pass = 0; pass < (loop ? 2 : 1); pass++) {
      for (let i = 1; i < n; i++) y[i] = Math.max(y[i] as number, (y[i - 1] as number) - dy);
      if (loop) y[0] = Math.max(y[0] as number, (y[n - 1] as number) - dy);
      for (let i = n - 2; i >= 0; i--) y[i] = Math.max(y[i] as number, (y[i + 1] as number) - dy);
      if (loop) y[n - 1] = Math.max(y[n - 1] as number, (y[0] as number) - dy);
    }
  };
  limitGrade();
  const tmp = new Float64Array(n);
  for (let pass = 0; pass < 8; pass++) {
    for (let i = 0; i < n; i++) {
      const a = loop ? (y[(i - 1 + n) % n] as number) : (y[Math.max(i - 1, 0)] as number);
      const c = loop ? (y[(i + 1) % n] as number) : (y[Math.min(i + 1, n - 1)] as number);
      tmp[i] = (y[i] as number) * 0.5 + (a + c) * 0.25;
    }
    y.set(tmp);
  }
  for (let i = 0; i < n; i++) y[i] = Math.max(y[i] as number, floor[i] as number);
  limitGrade();
  return y;
}

/** 贴地;不得不涉水时(支流渡口)贴可见水面 */
function walkY(s: Sampler, x: number, z: number): number {
  const g = s.height(x, z);
  const lv = s.nav.level[navCell(s.nav, x, z)] as number;
  return (lv > g ? lv : g) + GROUND_LIFT;
}

function fallbackS(s: Sampler): Xz[] {
  const out: Xz[] = [];
  const span = Math.min(s.half - MARGIN, 1600);
  for (let i = 0; i <= 20; i++) {
    const u = i / 20;
    out.push({
      x: (u - 0.5) * 2 * span * 0.7,
      z: Math.sin(u * Math.PI * 2) * 220,
    });
  }
  return out;
}

function usable(pts: Xz[] | null, loop: boolean): pts is Xz[] {
  if (!pts || pts.length < 4) return false;
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z);
  }
  if (loop) len += Math.hypot(pts[0]!.x - pts[pts.length - 1]!.x, pts[0]!.z - pts[pts.length - 1]!.z);
  return len >= MIN_TOUR_M;
}

function arcTable(pts: Vector3[], loop: boolean): { cumul: number[]; length: number } {
  const cumul = new Array<number>(pts.length);
  cumul[0] = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    cumul[i] = (cumul[i - 1] as number) + Math.hypot(b.x - a.x, b.z - a.z);
  }
  const last = cumul[pts.length - 1] as number;
  const close =
    loop && pts.length > 2
      ? Math.hypot(pts[0]!.x - pts[pts.length - 1]!.x, pts[0]!.z - pts[pts.length - 1]!.z)
      : 0;
  return { cumul, length: last + close };
}

type SolidFn = (x: number, z: number) => boolean;

function hillChord(s: Sampler, a: Xz, b: Xz, t: number, x: number, z: number): boolean {
  const h0 = s.height(a.x, a.z);
  const h1 = s.height(b.x, b.z);
  return s.height(x, z) > h0 + (h1 - h0) * t + HILL_CHORD_M;
}

function solidBetween(s: Sampler, a: Xz, b: Xz, solid: SolidFn, checkHill: boolean): boolean {
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(2, Math.ceil(dist / Math.max(s.texel * 0.85, 3)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    if (solid(x, z)) return true;
    if (checkHill && hillChord(s, a, b, t, x, z)) return true;
  }
  return false;
}

function nudgeOff(s: Sampler, p: Xz, solid: SolidFn): Xz {
  const c0 = clampXZ(p, s.half);
  if (!solid(c0.x, c0.z)) return c0;
  const maxR = 90;
  for (let r = s.texel; r <= maxR; r += s.texel) {
    const n = Math.max(8, Math.round((Math.PI * 2 * r) / s.texel));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const q = clampXZ({ x: c0.x + Math.cos(a) * r, z: c0.z + Math.sin(a) * r }, s.half);
      if (!solid(q.x, q.z)) return q;
    }
  }
  return c0;
}

function lateralDetour(s: Sampler, a: Xz, b: Xz, solid: SolidFn, checkHill: boolean): Xz | null {
  const mx = (a.x + b.x) * 0.5;
  const mz = (a.z + b.z) * 0.5;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const lx = -dz / len;
  const lz = dx / len;
  const spans = [10, 18, 28, 42, 64, 90];
  for (const r of spans) {
    for (const sign of [1, -1]) {
      const q = clampXZ({ x: mx + lx * sign * r, z: mz + lz * sign * r }, s.half);
      if (solid(q.x, q.z)) continue;
      if (solidBetween(s, a, q, solid, checkHill)) continue;
      if (solidBetween(s, q, b, solid, checkHill)) continue;
      return q;
    }
  }
  return null;
}

type HeapItem = { f: number; id: number };

function heapPush(h: HeapItem[], item: HeapItem): void {
  h.push(item);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p]!.f <= h[i]!.f) break;
    const t = h[p]!;
    h[p] = h[i]!;
    h[i] = t;
    i = p;
  }
}

function heapPop(h: HeapItem[]): HeapItem | undefined {
  const n = h.length;
  if (n === 0) return undefined;
  const top = h[0]!;
  const last = h.pop()!;
  if (n === 1) return top;
  h[0] = last;
  let i = 0;
  for (;;) {
    const l = i * 2 + 1;
    const r = l + 1;
    let s = i;
    if (l < h.length && h[l]!.f < h[s]!.f) s = l;
    if (r < h.length && h[r]!.f < h[s]!.f) s = r;
    if (s === i) break;
    const t = h[i]!;
    h[i] = h[s]!;
    h[s] = t;
    i = s;
  }
  return top;
}

function astarDetour(s: Sampler, a: Xz, b: Xz, solid: SolidFn, pad: number): Xz[] | null {
  const { res, size } = s;
  const [sx, sz] = xzToCell(a.x, a.z, res, size);
  const [gx, gz] = xzToCell(b.x, b.z, res, size);
  const padC = Math.ceil(pad / s.texel);
  const x0 = Math.max(0, Math.min(sx, gx) - padC);
  const z0 = Math.max(0, Math.min(sz, gz) - padC);
  const x1 = Math.min(res - 1, Math.max(sx, gx) + padC);
  const z1 = Math.min(res - 1, Math.max(sz, gz) + padC);
  const w = x1 - x0 + 1;
  const hgt = z1 - z0 + 1;
  const n = w * hgt;
  const idx = (cx: number, cz: number) => (cz - z0) * w + (cx - x0);
  const gScore = new Float32Array(n);
  gScore.fill(1e9);
  const prev = new Int32Array(n);
  prev.fill(-1);
  const closed = new Uint8Array(n);
  const start = idx(sx, sz);
  const goal = idx(gx, gz);
  if (start < 0 || start >= n || goal < 0 || goal >= n) return null;
  gScore[start] = 0;
  const open: HeapItem[] = [];
  const hCost = (cx: number, cz: number) => {
    const dx = Math.abs(cx - gx);
    const dz = Math.abs(cz - gz);
    return Math.max(dx, dz) + Math.min(dx, dz) * 0.414;
  };
  heapPush(open, { f: hCost(sx, sz), id: start });
  const dirs = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, 1.414],
    [1, -1, 1.414],
    [-1, 1, 1.414],
    [-1, -1, 1.414],
  ];
  let visited = 0;
  while (open.length > 0 && visited < A_STAR_CAP) {
    const cur = heapPop(open);
    if (!cur) break;
    if (closed[cur.id]) continue;
    closed[cur.id] = 1;
    visited++;
    if (cur.id === goal) {
      const cells: Xz[] = [];
      let at = goal;
      while (at >= 0) {
        const cx = x0 + (at % w);
        const cz = z0 + Math.floor(at / w);
        cells.push(cellToXz(cx, cz, res, size));
        at = prev[at] as number;
      }
      cells.reverse();
      return cells.length >= 2 ? cells : null;
    }
    const cx = x0 + (cur.id % w);
    const cz = z0 + Math.floor(cur.id / w);
    for (const d of dirs) {
      const nx = cx + (d[0] as number);
      const nz = cz + (d[1] as number);
      if (nx < x0 || nz < z0 || nx > x1 || nz > z1) continue;
      const ni = idx(nx, nz);
      if (closed[ni]) continue;
      const isGoal = ni === goal;
      if ((d[0] as number) !== 0 && (d[1] as number) !== 0) {
        const sideA = cellToXz(cx + (d[0] as number), cz, res, size);
        const sideB = cellToXz(cx, cz + (d[1] as number), res, size);
        if (solid(sideA.x, sideA.z) || solid(sideB.x, sideB.z)) continue;
      }
      const world = cellToXz(nx, nz, res, size);
      if (!isGoal && solid(world.x, world.z)) continue;
      const step = d[2] as number;
      const ng = (gScore[cur.id] as number) + step;
      if (ng >= (gScore[ni] as number)) continue;
      gScore[ni] = ng;
      prev[ni] = cur.id;
      heapPush(open, { f: ng + hCost(nx, nz), id: ni });
    }
  }
  return null;
}

function stringPull(s: Sampler, pts: Xz[], solid: SolidFn, checkHill: boolean): Xz[] {
  if (pts.length < 3) return pts.map((p) => ({ ...p }));
  const n = pts.length;
  const out: Xz[] = [{ ...pts[0]! }];
  let a = 0;
  while (a < n - 1) {
    let furthest = a + 1;
    for (let j = a + 2; j < n; j++) {
      if (solidBetween(s, pts[a]!, pts[j]!, solid, checkHill)) break;
      furthest = j;
    }
    out.push({ ...pts[furthest]! });
    a = furthest;
  }
  return out;
}

function steerClear(s: Sampler, pts: Xz[], loop: boolean, solid: SolidFn, checkHill: boolean): Xz[] {
  if (pts.length < 2) return pts.map((p) => nudgeOff(s, p, solid));
  const nudged = pts.map((p) => nudgeOff(s, p, solid));
  const out: Xz[] = [];
  const n = nudged.length;
  const count = loop ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = nudged[i]!;
    const b = nudged[(i + 1) % n]!;
    if (i === 0) out.push(a);
    if (!solidBetween(s, a, b, solid, checkHill)) {
      if (!loop || i < n - 1) out.push(b);
      continue;
    }
    const mid = lateralDetour(s, a, b, solid, checkHill);
    if (mid) {
      out.push(mid);
      if (!loop || i < n - 1) out.push(b);
      continue;
    }
    const path = astarDetour(s, a, b, solid, A_STAR_PAD) ?? astarDetour(s, a, b, solid, A_STAR_PAD * 1.7);
    if (path && path.length > 2) {
      const pulled = stringPull(s, path, solid, checkHill);
      for (let k = 1; k < pulled.length - 1; k++) out.push(nudgeOff(s, pulled[k]!, solid));
      if (!loop || i < n - 1) out.push(b);
    } else if (!loop || i < n - 1) {
      out.push(b);
    }
  }
  if (!loop) {
    const last = nudged[n - 1]!;
    const tail = out[out.length - 1]!;
    if (!tail || tail.x !== last.x || tail.z !== last.z) out.push(last);
  }
  return stringPull(s, out.length >= 2 ? out : nudged, solid, checkHill);
}

export function generateTour(
  fields: WorldFields,
  rivers: RiverLine[],
  buildings: BuildingFoot[] = [],
  scatter: ScatterResult | null = null,
): RegionTour {
  const s = makeSampler(fields, buildings, scatter);
  const cls = classifyRegion(fields, rivers);
  const lim = s.half - MARGIN;
  const bankBand: BandOpts = { minStand: BANK_MIN, maxStand: BANK_MAX, iters: 60, lim };
  const dryBand: BandOpts = { minStand: DRY_MIN, maxStand: null, iters: 50, lim };
  let xz: Xz[] | null = null;
  let loop = cls.kind === "o";

  if (cls.kind === "o") {
    if (cls.feature === "lake") {
      const ring = lakeRing(s.nav, cls.anchor, Math.max(cls.radiusX, cls.radiusZ) * 1.6 + 120, {
        target: BANK_TARGET,
        lim,
      });
      const banked = ring ? relaxBand(s.nav, ring, true, bankBand) : null;
      if (usable(banked, true)) xz = banked;
    }
    if (!xz) {
      let ring = ellipseRing(cls, 24, 1);
      const rMin = Math.min(cls.radiusX, cls.radiusZ) * 0.72;
      const rMax = Math.max(cls.radiusX, cls.radiusZ) * 1.28;
      ring = relaxLoop(ring, s, cls.anchor, rMin, rMax);
      ring = resamplePath(ring, 26, true);
      ring = steerClear(s, ring, true, s.walkSolid, true);
      xz = relaxBand(s.nav, ring, true, dryBand);
    }
  } else if (cls.feature === "river" && cls.spine.length >= 3) {
    xz = bankRoute(s.nav, cls.spine, {
      target: BANK_TARGET,
      minStand: BANK_MIN,
      maxStand: BANK_MAX,
      lim,
      bankHint: cls.bank,
    });
    if (!usable(xz, false)) {
      xz = relaxBand(s.nav, offsetRiverSpine(s, cls.spine, cls.bank + BANK_TARGET), false, bankBand);
    }
  } else {
    let open = cls.spine.length >= 3 ? cls.spine.map((p) => clampXZ(p, s.half)) : fallbackS(s);
    open = relaxOpen(open, s);
    open = resampleOpen(open, 26);
    open = steerClear(s, open, false, s.walkSolid, true);
    xz = relaxBand(s.nav, open, false, dryBand);
  }

  if (!usable(xz, loop)) {
    const open = steerClear(s, resampleOpen(fallbackS(s), 26), false, s.walkSolid, true);
    xz = relaxBand(s.nav, open, false, dryBand);
    loop = false;
  }

  const walk: Vector3[] = [];
  const flyXz: Xz[] = [];
  const flyScale = loop ? 1.12 : 1;
  for (const p of xz) {
    const wc = clampXZ(p, s.half);
    const rawFly = loop
      ? clampXZ(
          {
            x: cls.anchor.x + (p.x - cls.anchor.x) * flyScale,
            z: cls.anchor.z + (p.z - cls.anchor.z) * flyScale,
          },
          s.half,
        )
      : wc;
    walk.push(new Vector3(wc.x, walkY(s, wc.x, wc.z), wc.z));
    flyXz.push(nudgeOff(s, rawFly, s.flySolid));
  }
  const alt = flatAltitude(
    flyXz.map((q) => flyFloor(s, q.x, q.z)),
    flyXz,
    loop,
  );
  const fly = flyXz.map((q, i) => new Vector3(q.x, alt[i] as number, q.z));

  const { cumul, length } = arcTable(walk, loop);
  return {
    kind: loop ? "o" : "s",
    feature: cls.feature,
    walk,
    fly,
    length: Math.max(length, 1),
    cumul,
  };
}
