/**
 * 把分型骨架加密成 walk / fly 两条三维折线。
 *
 * walk 贴地。河边用粗骨架 + 近常值岸距,再抽稀、拉直、圆角,少折线;
 * 建筑/植被以全局外推为主,不逐棵绕。其他路绕开实体后同样拉直圆角。
 * fly 同一 XZ(O 型略放大)抬到 45–80 m,并避开建筑足迹。
 */

import { CatmullRomCurve3, Vector3 } from "three";
import { rasterizeRings } from "../geo/rasterize";
import { sampleCpu, sampleWaterCpu } from "../render/fields";
import type { BuildingFoot, RiverLine, WorldFields } from "../types";
import { INSTANCE_STRIDE, type ScatterLayer, type ScatterResult } from "../veg/scatter";
import { classifyRegion } from "./classify";
import type { RegionTour, TourClassification } from "./types";

const FLY_CLEAR = 1.4;
const SLOPE_MAX = 0.45;
/** 当作实体陡崖:超过则绕行,不沿坡面直穿 */
const CLIFF_SLOPE = 1.05;
const MARGIN = 140;
const CLEAR_M = 6;
/** 弦中点地形高出两端线性插值多少米,视为穿山 */
const HILL_CHORD_M = 4.2;
const A_STAR_PAD = 180;
const A_STAR_CAP = 14_000;
/** 河边路径离水缘的干岸距离(米) */
const SHORE_STANDOFF = 16;
/** 步行折线贴地抬高,丝带再叠一点,避免陷入地表 */
const GROUND_LIFT = 0.08;
/** 全局抽稀:小于此偏离的弯折视为噪声 */
const RDP_EPS = 22;
const RIVER_SPINE_EPS = 32;

type Xz = { x: number; z: number };

type Sampler = {
  res: number;
  size: number;
  half: number;
  texel: number;
  height: (x: number, z: number) => number;
  water: (x: number, z: number) => number;
  slope: (x: number, z: number) => number;
  urban: (x: number, z: number) => number;
  /** 步行实体:建筑 / 植被 / 水 / 陡崖 */
  walkSolid: (x: number, z: number) => boolean;
  /** 仅建筑足迹(河边贴岸时用来绕楼,不把水面当障碍) */
  builtSolid: (x: number, z: number) => boolean;
  /** 树木 / 灌木冠幅 */
  plantSolid: (x: number, z: number) => boolean;
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
): {
  walk: Uint8Array;
  fly: Uint8Array;
  plant: Uint8Array;
} {
  const { res, size, heights, waterY } = fields;
  const n = res * res;
  const rings = buildings.map((b) => b.ring);
  const built = dilateMask(rasterizeRings(rings, res, size), res, Math.max(1, Math.round(CLEAR_M / (size / res))));
  const plant = stampPlants(scatter, res, size);
  const walk = new Uint8Array(n);
  const fly = new Uint8Array(n);
  const texel = size / res;
  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      const i = z * res + x;
      const h = heights[i] as number;
      const w = waterY[i] as number;
      const hx = x < res - 1 ? (heights[i + 1] as number) : h;
      const hz = z < res - 1 ? (heights[i + res] as number) : h;
      const slope = Math.hypot(hx - h, hz - h) / texel;
      const wetCell = Number.isFinite(w) && w > h + 0.05;
      const bld = built[i] === 1;
      const veg = plant[i] === 1;
      const cliff = slope > CLIFF_SLOPE;
      fly[i] = bld ? 1 : 0;
      walk[i] = bld || veg || wetCell || cliff ? 1 : 0;
    }
  }
  return { walk, fly, plant };
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
    builtSolid: (x, z) => sampleSolid(solids.fly, x, z, res, size),
    plantSolid: (x, z) => sampleSolid(solids.plant, x, z, res, size),
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

function wet(s: Sampler, x: number, z: number): boolean {
  const g = s.height(x, z);
  const w = s.water(x, z);
  return Number.isFinite(w) && w > g + 0.05;
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

function bankLookScore(s: Sampler, x: number, z: number): number {
  if (wet(s, x, z)) return -900;
  if (s.builtSolid(x, z)) return -400;
  if (s.slope(x, z) > CLIFF_SLOPE) return -350;
  let v = 0;
  if (s.plantSolid(x, z)) v -= 28;
  v -= Math.max(0, s.slope(x, z) - SLOPE_MAX) * 80;
  if (s.urban(x, z) > 0.55) v -= 18;
  return v;
}

function pickBankSign(spine: Xz[], s: Sampler): number {
  let left = 0;
  let right = 0;
  const d = 40;
  const stride = Math.max(1, (spine.length / 14) | 0);
  for (let i = 0; i < spine.length; i += stride) {
    const p = spine[i]!;
    const nL = landNormal(spine, i, 1);
    const nR = landNormal(spine, i, -1);
    left += bankLookScore(s, p.x + nL.x * d, p.z + nL.z * d);
    right += bankLookScore(s, p.x + nR.x * d, p.z + nR.z * d);
  }
  return left >= right ? 1 : -1;
}

function smoothPolyline(pts: Xz[], passes: number, loop = false): Xz[] {
  if (pts.length < 3 || passes <= 0) return pts.map((p) => ({ ...p }));
  let cur = pts.map((p) => ({ ...p }));
  for (let p = 0; p < passes; p++) {
    const next = cur.map((q) => ({ ...q }));
    const n = cur.length;
    const start = loop ? 0 : 1;
    const end = loop ? n : n - 1;
    for (let i = start; i < end; i++) {
      const a = cur[(i - 1 + n) % n]!;
      const b = cur[i]!;
      const c = cur[(i + 1) % n]!;
      next[i] = { x: b.x * 0.5 + (a.x + c.x) * 0.25, z: b.z * 0.5 + (a.z + c.z) * 0.25 };
    }
    cur = next;
  }
  return cur;
}

function smoothedNormals(spine: Xz[], sign: number): Xz[] {
  const out = spine.map((_, i) => landNormal(spine, i, sign));
  for (let pass = 0; pass < 6; pass++) {
    const next = out.map((n) => ({ ...n }));
    for (let i = 1; i < out.length - 1; i++) {
      const a = out[i - 1]!;
      const b = out[i]!;
      const c = out[i + 1]!;
      const x = a.x + b.x + c.x;
      const z = a.z + b.z + c.z;
      const len = Math.hypot(x, z) || 1;
      next[i] = { x: x / len, z: z / len };
    }
    for (let i = 0; i < out.length; i++) out[i] = next[i]!;
  }
  return out;
}

function firstDryDist(p: Xz, n: Xz, s: Sampler, step: number): number {
  let d = 0;
  let dryRun = 0;
  let firstDry = 0;
  while (d <= 120) {
    if (!wet(s, p.x + n.x * d, p.z + n.z * d)) {
      if (dryRun === 0) firstDry = d;
      dryRun++;
      if (dryRun >= 2) return firstDry;
    } else {
      dryRun = 0;
    }
    d += step;
  }
  return firstDry;
}

function median(ds: Float64Array): number {
  const b = Array.from(ds).sort((a, c) => a - c);
  return b[b.length >> 1] as number;
}

function boxSmooth(ds: Float64Array, passes: number): void {
  const n = ds.length;
  if (n < 3) return;
  const tmp = new Float64Array(n);
  for (let p = 0; p < passes; p++) {
    tmp[0] = ds[0] as number;
    tmp[n - 1] = ds[n - 1] as number;
    for (let i = 1; i < n - 1; i++) {
      tmp[i] = (ds[i - 1] as number) * 0.25 + (ds[i] as number) * 0.5 + (ds[i + 1] as number) * 0.25;
    }
    ds.set(tmp);
  }
}

function dilate1d(ds: Float64Array, radius: number): void {
  const n = ds.length;
  if (n === 0 || radius <= 0) return;
  const src = new Float64Array(ds);
  for (let i = 0; i < n; i++) {
    let m = src[i] as number;
    for (let k = 1; k <= radius; k++) {
      if (i - k >= 0) m = Math.max(m, src[i - k] as number);
      if (i + k < n) m = Math.max(m, src[i + k] as number);
    }
    ds[i] = m;
  }
}

function percentile(ds: Float64Array, p: number): number {
  if (ds.length === 0) return 0;
  const b = Array.from(ds).sort((a, c) => a - c);
  const i = Math.min(b.length - 1, Math.max(0, Math.round(p * (b.length - 1))));
  return b[i] as number;
}

function distPointSeg(p: Xz, a: Xz, b: Xz): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-8) return Math.hypot(p.x - a.x, p.z - a.z);
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

function rdpSimplify(pts: Xz[], eps: number, blocked: (a: Xz, b: Xz) => boolean): Xz[] {
  if (pts.length < 3) return pts.map((p) => ({ ...p }));
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const rec = (i0: number, i1: number): void => {
    if (i1 <= i0 + 1) return;
    let maxD = -1;
    let maxI = i0 + 1;
    const a = pts[i0]!;
    const b = pts[i1]!;
    for (let i = i0 + 1; i < i1; i++) {
      const d = distPointSeg(pts[i]!, a, b);
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > eps || blocked(a, b)) {
      keep[maxI] = 1;
      rec(i0, maxI);
      rec(maxI, i1);
    }
  };
  rec(0, pts.length - 1);
  const out: Xz[] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push({ ...pts[i]! });
  return out.length >= 2 ? out : pts.map((p) => ({ ...p }));
}

function chaikin(pts: Xz[], passes: number, loop: boolean): Xz[] {
  if (pts.length < 3 || passes <= 0) return pts.map((p) => ({ ...p }));
  let cur = pts.map((p) => ({ ...p }));
  for (let p = 0; p < passes; p++) {
    const next: Xz[] = [];
    const n = cur.length;
    const last = loop ? n : n - 1;
    if (!loop) next.push({ ...cur[0]! });
    for (let i = 0; i < last; i++) {
      const a = cur[i]!;
      const b = cur[(i + 1) % n]!;
      next.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    if (!loop) next.push({ ...cur[n - 1]! });
    cur = next;
  }
  return cur;
}

function riverHard(s: Sampler, x: number, z: number): boolean {
  return wet(s, x, z) || s.builtSolid(x, z);
}

/**
 * 贴岸:粗骨架平行偏移。岸距近常值,植被用全局外推,禁止逐点折绕。
 */
function followRiverBank(s: Sampler, spineIn: Xz[], bankHint: number): Xz[] {
  let spine = rdpSimplify(spineIn, RIVER_SPINE_EPS, () => false);
  spine = resampleOpen(spine, 24);
  if (spine.length < 3) spine = spineIn.map((p) => ({ ...p }));
  spine = smoothPolyline(spine, 8);
  const sign = pickBankSign(spine, s);
  const nrm = smoothedNormals(spine, sign);
  const step = Math.max(s.texel * 0.5, 1.5);
  const minD = Math.max(SHORE_STANDOFF, Math.min(Math.max(bankHint, 8) * 0.4, 14));
  const base = new Float64Array(spine.length);
  const extra = new Float64Array(spine.length);
  for (let i = 0; i < spine.length; i++) {
    const p = spine[i]!;
    const n = nrm[i]!;
    let d = firstDryDist(p, n, s, step) + SHORE_STANDOFF;
    d = Math.min(Math.max(d, minD), 100);
    base[i] = d;
    let e = 0;
    while (
      e < 36 &&
      (s.builtSolid(p.x + n.x * (d + e), p.z + n.z * (d + e)) ||
        s.plantSolid(p.x + n.x * (d + e), p.z + n.z * (d + e)))
    ) {
      e += step;
    }
    extra[i] = e;
  }
  boxSmooth(base, 10);
  const gExtra = percentile(extra, 0.6);
  const resid = new Float64Array(spine.length);
  for (let i = 0; i < extra.length; i++) {
    resid[i] = Math.min(Math.max((extra[i] as number) - gExtra, 0), 10);
  }
  dilate1d(resid, 2);
  boxSmooth(resid, 8);
  const ds = new Float64Array(spine.length);
  for (let i = 0; i < ds.length; i++) {
    ds[i] = (base[i] as number) + gExtra + (resid[i] as number);
  }
  const med = Math.max(median(ds), minD);
  for (let i = 0; i < ds.length; i++) {
    ds[i] = Math.min(Math.max(ds[i] as number, med * 0.9), med * 1.12);
  }
  boxSmooth(ds, 5);

  const place = (): Xz[] => {
    const out: Xz[] = [];
    for (let i = 0; i < spine.length; i++) {
      const p = spine[i]!;
      const n = nrm[i]!;
      const d = ds[i] as number;
      out.push(clampXZ({ x: p.x + n.x * d, z: p.z + n.z * d }, s.half));
    }
    return out;
  };

  let out = place();
  for (let iter = 0; iter < 3; iter++) {
    const bump = new Float64Array(ds.length);
    let hits = 0;
    for (let i = 0; i < out.length; i++) {
      const q = out[i]!;
      if (riverHard(s, q.x, q.z)) {
        bump[i] = 6;
        hits++;
      }
    }
    if (hits === 0) break;
    dilate1d(bump, 2);
    boxSmooth(bump, 4);
    for (let i = 0; i < ds.length; i++) ds[i] = (ds[i] as number) + (bump[i] as number);
    out = place();
  }

  const hard = (x: number, z: number) => riverHard(s, x, z);
  let xz = stringPull(s, out, hard, false);
  xz = rdpSimplify(xz, RDP_EPS, (a, b) => solidBetween(s, a, b, hard, false));
  if (xz.length < 2) xz = out;
  return denseCurve(xz, false);
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

function denseCurve(ctrl: Xz[], closed: boolean): Xz[] {
  if (ctrl.length < 2) return ctrl.map((p) => ({ ...p }));
  let pts = ctrl;
  if (pts.length === 2) {
    const a = pts[0]!;
    const b = pts[1]!;
    pts = [a, { x: (a.x + b.x) * 0.5, z: (a.z + b.z) * 0.5 }, b];
  }
  const vecs = pts.map((p) => new Vector3(p.x, 0, p.z));
  const curve = new CatmullRomCurve3(vecs, closed, "centripetal");
  const len = Math.max(curve.getLength(), 1);
  const n = Math.min(Math.max(closed ? 72 : 36, Math.round(len / 14)), 640);
  return curve.getSpacedPoints(n).map((v) => ({ x: v.x, z: v.z }));
}

function maxGroundNear(s: Sampler, x: number, z: number, radius: number): number {
  let m = s.height(x, z);
  const w = s.water(x, z);
  if (Number.isFinite(w)) m = Math.max(m, w);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const hx = x + Math.cos(a) * radius;
    const hz = z + Math.sin(a) * radius;
    m = Math.max(m, s.height(hx, hz));
    const ww = s.water(hx, hz);
    if (Number.isFinite(ww)) m = Math.max(m, ww);
  }
  return m;
}

function walkY(s: Sampler, x: number, z: number): number {
  const g = s.height(x, z);
  const w = s.water(x, z);
  const floor = Number.isFinite(w) && w > g ? w : g;
  return floor + GROUND_LIFT;
}

function flyY(s: Sampler, x: number, z: number): number {
  const sl = Math.min(Math.max(s.slope(x, z), 0), 1);
  const base = maxGroundNear(s, x, z, 56);
  const clear = 45 + 35 * sl;
  return Math.max(base + clear, s.height(x, z) + FLY_CLEAR);
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

function naturalize(s: Sampler, pts: Xz[], loop: boolean, solid: SolidFn, checkHill: boolean): Xz[] {
  if (pts.length < 3) return pts.map((p) => ({ ...p }));
  let xz = stringPull(s, pts, solid, checkHill);
  xz = rdpSimplify(xz, RDP_EPS, (a, b) => solidBetween(s, a, b, solid, checkHill));
  if (xz.length < 2) xz = pts.map((p) => ({ ...p }));
  xz = chaikin(xz, 2, loop);
  xz = denseCurve(xz, loop);
  return smoothPolyline(xz, 2, loop);
}

function simplify(s: Sampler, pts: Xz[], _loop: boolean, solid: SolidFn, checkHill: boolean): Xz[] {
  return stringPull(s, pts, solid, checkHill);
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
  return simplify(s, out.length >= 2 ? out : nudged, loop, solid, checkHill);
}

export function generateTour(
  fields: WorldFields,
  rivers: RiverLine[],
  buildings: BuildingFoot[] = [],
  scatter: ScatterResult | null = null,
): RegionTour {
  const s = makeSampler(fields, buildings, scatter);
  const cls = classifyRegion(fields, rivers);
  let xz: Xz[];
  let loop = cls.kind === "o";

  if (cls.kind === "o") {
    xz = ellipseRing(cls, 24, 1);
    const rMin = Math.min(cls.radiusX, cls.radiusZ) * 0.72;
    const rMax = Math.max(cls.radiusX, cls.radiusZ) * 1.28;
    xz = relaxLoop(xz, s, cls.anchor, rMin, rMax);
    xz = steerClear(s, xz, true, s.walkSolid, true);
    xz = naturalize(s, xz, true, s.walkSolid, true);
  } else if (cls.feature === "river" && cls.spine.length >= 3) {
    xz = followRiverBank(s, cls.spine, cls.bank);
  } else if (cls.spine.length >= 3) {
    xz = cls.spine.map((p) => clampXZ(p, s.half));
    xz = relaxOpen(xz, s);
    xz = resampleOpen(xz, 26);
    xz = steerClear(s, xz, false, s.walkSolid, true);
    xz = naturalize(s, xz, false, s.walkSolid, true);
  } else {
    xz = fallbackS(s);
    xz = relaxOpen(xz, s);
    xz = steerClear(s, xz, false, s.walkSolid, true);
    xz = naturalize(s, xz, false, s.walkSolid, true);
  }

  if (xz.length < 4) {
    xz = fallbackS(s);
    loop = false;
    xz = steerClear(s, xz, false, s.walkSolid, true);
    xz = naturalize(s, xz, false, s.walkSolid, true);
  }

  const walk: Vector3[] = [];
  const fly: Vector3[] = [];
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
    const fc = nudgeOff(s, rawFly, s.flySolid);
    walk.push(new Vector3(wc.x, walkY(s, wc.x, wc.z), wc.z));
    fly.push(new Vector3(fc.x, flyY(s, fc.x, fc.z), fc.z));
  }

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
