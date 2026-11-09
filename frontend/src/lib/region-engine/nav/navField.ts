/**
 * 导航场:与渲染同源的可见水面 + 建筑足迹的有符号距离场,
 * 河岸代价网格 A*(双岸择优)与弹性带平滑(约束投影)。
 *
 * 可见水面 = 原始水位高出地面 ∪ 外扩水位(与 waterExtTex 同参)高出地面,再外扩 1 格:
 * 水面网格在岸下延伸,低岸处看得见的水比 waterY 宽 3~4 格,只认 waterY 会把路修进水里。
 */

import { WATER_NONE } from "../gpu/pipeline";
import { dilateWaterY } from "../render/fields";
import type { WorldFields } from "../types";

export type Xz = { x: number; z: number };

export type NavField = {
  res: number;
  size: number;
  texel: number;
  /** 可见水面(含 1 格外扩) */
  water: Uint8Array;
  /** 可见水位(米);非水格为 WATER_NONE */
  level: Float32Array;
  /** 到可见水面的有符号距离(米,岸上为正) */
  sdWater: Float32Array;
  /** 建筑足迹(未外扩) */
  foot: Uint8Array;
  /** 到建筑足迹的有符号距离(米,外部为正) */
  sdFoot: Float32Array;
  /** 建筑避让带(足迹外扩) */
  built: Uint8Array;
  /** 树冠 / 灌丛 */
  plant: Uint8Array;
  slope: Float32Array;
  cliff: Uint8Array;
};

export type BandOpts = {
  /** 离可见水面的最近距离 */
  minStand: number;
  /** 超过则往水边回拉(贴岸路线);null = 不回拉 */
  maxStand: number | null;
  iters: number;
  /** |x|、|z| 上限 */
  lim: number;
};

export type BankOpts = {
  target: number;
  minStand: number;
  maxStand: number;
  lim: number;
  /** 河宽一半 + 余量(米) */
  bankHint: number;
};

const EDT_INF = 1e20;
const SQRT2 = Math.SQRT2;
/** 弹性带工作间距 / 输出间距(米) */
const BAND_STEP = 3;
const OUT_STEP = 4;

// ---------------------------------------------------------------------------
// 距离场
// ---------------------------------------------------------------------------

/** 1D 平方距离变换(Felzenszwalb–Huttenlocher 下包络) */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -EDT_INF;
  z[1] = EDT_INF;
  for (let q = 1; q < n; q++) {
    const fq = (f[q] as number) + q * q;
    let vk = v[k] as number;
    let s = (fq - ((f[vk] as number) + vk * vk)) / (2 * (q - vk));
    while (s <= (z[k] as number)) {
      k--;
      vk = v[k] as number;
      s = (fq - ((f[vk] as number) + vk * vk)) / (2 * (q - vk));
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = EDT_INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while ((z[k + 1] as number) < q) k++;
    const vk = v[k] as number;
    const dq = q - vk;
    d[q] = dq * dq + (f[vk] as number);
  }
}

/** 到最近种子格的欧氏距离(米);无种子时为极大值 */
function edt2d(seed: Uint8Array, res: number, texel: number): Float32Array {
  const f = new Float64Array(res);
  const d = new Float64Array(res);
  const v = new Int32Array(res);
  const z = new Float64Array(res + 1);
  const cols = new Float64Array(res * res);
  for (let x = 0; x < res; x++) {
    for (let y = 0; y < res; y++) f[y] = seed[y * res + x] ? 0 : EDT_INF;
    edt1d(f, res, d, v, z);
    for (let y = 0; y < res; y++) cols[y * res + x] = d[y] as number;
  }
  const out = new Float32Array(res * res);
  for (let y = 0; y < res; y++) {
    const row = y * res;
    for (let x = 0; x < res; x++) f[x] = cols[row + x] as number;
    edt1d(f, res, d, v, z);
    for (let x = 0; x < res; x++) out[row + x] = Math.sqrt(d[x] as number) * texel;
  }
  return out;
}

/** 有符号距离:掩码外为正、内为负,零点落在格边界上 */
function signedDistance(mask: Uint8Array, res: number, texel: number): Float32Array {
  let any = false;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      any = true;
      break;
    }
  }
  const out = edt2d(mask, res, texel);
  if (!any) return out;
  const inv = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1;
  const inside = edt2d(inv, res, texel);
  const half = texel * 0.5;
  for (let i = 0; i < mask.length; i++) {
    out[i] = mask[i] ? -((inside[i] as number) - half) : (out[i] as number) - half;
  }
  return out;
}

function dilate8(src: Uint8Array, res: number): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      let hit = 0;
      for (let dz = -1; dz <= 1 && !hit; dz++) {
        const zz = z + dz;
        if (zz < 0 || zz >= res) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= res) continue;
          if (src[zz * res + xx]) {
            hit = 1;
            break;
          }
        }
      }
      out[z * res + x] = hit;
    }
  }
  return out;
}

export function buildNavField(
  fields: WorldFields,
  foot: Uint8Array,
  built: Uint8Array,
  plant: Uint8Array,
  cliffSlope: number,
): NavField {
  const { res, size, heights, waterY } = fields;
  const texel = size / res;
  const n = res * res;
  const ext = dilateWaterY(waterY, res, 4);
  const thresh = WATER_NONE * 0.5;
  const raw = new Uint8Array(n);
  const level = new Float32Array(n).fill(WATER_NONE);
  for (let i = 0; i < n; i++) {
    const h = heights[i] as number;
    const w = waterY[i] as number;
    const e = ext[i] as number;
    if (w > thresh && w > h + 0.02) {
      raw[i] = 1;
      level[i] = w;
    } else if (e > thresh && e > h - 0.08) {
      raw[i] = 1;
      level[i] = e;
    }
  }
  const water = dilate8(raw, res);

  const slope = new Float32Array(n);
  const cliff = new Uint8Array(n);
  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      const i = z * res + x;
      const hl = heights[z * res + Math.max(x - 1, 0)] as number;
      const hr = heights[z * res + Math.min(x + 1, res - 1)] as number;
      const hd = heights[Math.max(z - 1, 0) * res + x] as number;
      const hu = heights[Math.min(z + 1, res - 1) * res + x] as number;
      const sl = Math.hypot(hr - hl, hu - hd) / (2 * texel);
      slope[i] = sl;
      cliff[i] = sl > cliffSlope ? 1 : 0;
    }
  }

  return {
    res,
    size,
    texel,
    water,
    level,
    sdWater: signedDistance(water, res, texel),
    foot,
    sdFoot: signedDistance(foot, res, texel),
    built,
    plant,
    slope,
    cliff,
  };
}

// ---------------------------------------------------------------------------
// 采样
// ---------------------------------------------------------------------------

export function navCell(nav: NavField, x: number, z: number): number {
  const { res, size } = nav;
  const cx = Math.min(Math.max(Math.floor((x / size + 0.5) * res), 0), res - 1);
  const cz = Math.min(Math.max(Math.floor((z / size + 0.5) * res), 0), res - 1);
  return cz * res + cx;
}

function navCenter(nav: NavField, i: number): Xz {
  const { res, size } = nav;
  return {
    x: (((i % res) + 0.5) / res - 0.5) * size,
    z: ((((i / res) | 0) + 0.5) / res - 0.5) * size,
  };
}

/** 格心双线性 */
export function navSample(nav: NavField, f: Float32Array, x: number, z: number): number {
  const { res, size } = nav;
  const px = Math.min(Math.max((x / size + 0.5) * res - 0.5, 0), res - 1.001);
  const pz = Math.min(Math.max((z / size + 0.5) * res - 0.5, 0), res - 1.001);
  const x0 = Math.floor(px);
  const z0 = Math.floor(pz);
  const fx = px - x0;
  const fz = pz - z0;
  const i = z0 * res + x0;
  const a = f[i] as number;
  const b = f[i + 1] as number;
  const c = f[i + res] as number;
  const d = f[i + res + 1] as number;
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}

/** 单位梯度;脊线(两侧等距)上梯度塌缩时返回 null */
function navGrad(nav: NavField, f: Float32Array, x: number, z: number): Xz | null {
  const e = nav.texel;
  const gx = navSample(nav, f, x + e, z) - navSample(nav, f, x - e, z);
  const gz = navSample(nav, f, x, z + e) - navSample(nav, f, x, z - e);
  const len = Math.hypot(gx, gz);
  if (len < 0.3 * e) return null;
  return { x: gx / len, z: gz / len };
}

// ---------------------------------------------------------------------------
// 折线工具
// ---------------------------------------------------------------------------

export function resamplePath(pts: Xz[], spacing: number, loop: boolean): Xz[] {
  if (pts.length < 2) return pts.map((p) => ({ ...p }));
  const src = loop ? [...pts, pts[0]!] : pts;
  const seg = [0];
  let total = 0;
  for (let i = 1; i < src.length; i++) {
    const a = src[i - 1]!;
    const b = src[i]!;
    total += Math.hypot(b.x - a.x, b.z - a.z);
    seg.push(total);
  }
  if (total < spacing) return pts.map((p) => ({ ...p }));
  const n = Math.max(4, Math.round(total / spacing));
  const out: Xz[] = [];
  const last = loop ? n - 1 : n;
  let i = 1;
  for (let k = 0; k <= last; k++) {
    const d = (k / n) * total;
    while (i < seg.length - 1 && (seg[i] as number) < d) i++;
    const d0 = seg[i - 1] as number;
    const d1 = seg[i] as number;
    const a = src[i - 1]!;
    const b = src[i]!;
    const t = d1 - d0 > 1e-6 ? Math.min(Math.max((d - d0) / (d1 - d0), 0), 1) : 0;
    out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  }
  return out;
}

function smoothOpen(pts: Xz[], passes: number): Xz[] {
  let cur = pts.map((p) => ({ ...p }));
  for (let p = 0; p < passes; p++) {
    const next = cur.map((q) => ({ ...q }));
    for (let i = 1; i < cur.length - 1; i++) {
      const a = cur[i - 1]!;
      const b = cur[i]!;
      const c = cur[i + 1]!;
      next[i] = { x: b.x * 0.5 + (a.x + c.x) * 0.25, z: b.z * 0.5 + (a.z + c.z) * 0.25 };
    }
    cur = next;
  }
  return cur;
}

function clampLim(p: Xz, lim: number): Xz {
  return {
    x: Math.min(Math.max(p.x, -lim), lim),
    z: Math.min(Math.max(p.z, -lim), lim),
  };
}

// ---------------------------------------------------------------------------
// 弹性带:拉普拉斯收紧 + 约束投影(建筑先推,水最后推 → 水约束永远成立)
// ---------------------------------------------------------------------------

function projectPoint(nav: NavField, x: number, z: number, o: BandOpts): Xz {
  let px = x;
  let pz = z;
  const b = navSample(nav, nav.sdFoot, px, pz);
  if (b < 3.5) {
    const g = navGrad(nav, nav.sdFoot, px, pz);
    if (g) {
      const step = Math.min(3.5 - b, 5);
      px += g.x * step;
      pz += g.z * step;
    }
  }
  const d = navSample(nav, nav.sdWater, px, pz);
  if (d < o.minStand) {
    const g = navGrad(nav, nav.sdWater, px, pz);
    if (g) {
      const step = Math.min(o.minStand - d, 5);
      px += g.x * step;
      pz += g.z * step;
    }
  } else if (o.maxStand !== null && d > o.maxStand && navSample(nav, nav.sdFoot, px, pz) > 12) {
    const g = navGrad(nav, nav.sdWater, px, pz);
    if (g) {
      const step = Math.min((d - o.maxStand) * 0.5, 4);
      px -= g.x * step;
      pz -= g.z * step;
    }
  }
  return clampLim({ x: px, z: pz }, o.lim);
}

export function relaxBand(nav: NavField, input: Xz[], loop: boolean, o: BandOpts): Xz[] {
  const pts = resamplePath(input, BAND_STEP, loop);
  const n = pts.length;
  if (n < 3) return pts;
  let xs = Float64Array.from(pts, (p) => p.x);
  let zs = Float64Array.from(pts, (p) => p.z);
  let nx = new Float64Array(n);
  let nz = new Float64Array(n);
  for (let it = 0; it < o.iters; it++) {
    for (let i = 0; i < n; i++) {
      if (!loop && (i === 0 || i === n - 1)) {
        nx[i] = xs[i] as number;
        nz[i] = zs[i] as number;
        continue;
      }
      const a = i === 0 ? n - 1 : i - 1;
      const c = i === n - 1 ? 0 : i + 1;
      nx[i] = (xs[i] as number) * 0.5 + ((xs[a] as number) + (xs[c] as number)) * 0.25;
      nz[i] = (zs[i] as number) * 0.5 + ((zs[a] as number) + (zs[c] as number)) * 0.25;
    }
    for (let i = 0; i < n; i++) {
      const q = projectPoint(nav, nx[i] as number, nz[i] as number, o);
      nx[i] = q.x;
      nz[i] = q.z;
    }
    const tx = xs;
    xs = nx;
    nx = tx;
    const tz = zs;
    zs = nz;
    nz = tz;
  }
  // 收尾:只投影不平滑,确保每点都满足约束
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < n; i++) {
      const q = projectPoint(nav, xs[i] as number, zs[i] as number, o);
      xs[i] = q.x;
      zs[i] = q.z;
    }
  }
  const out: Xz[] = [];
  for (let i = 0; i < n; i++) out.push({ x: xs[i] as number, z: zs[i] as number });
  return resamplePath(out, OUT_STEP, loop);
}

// ---------------------------------------------------------------------------
// 河岸路线:走廊内代价网格 A*(两岸各跑一次取低代价)→ 拉直 → 弹性带
// ---------------------------------------------------------------------------

class MinHeap {
  private f = new Float64Array(1 << 14);
  private id = new Int32Array(1 << 14);
  size = 0;

  push(f: number, id: number): void {
    if (this.size === this.f.length) {
      const nf = new Float64Array(this.size * 2);
      nf.set(this.f);
      this.f = nf;
      const ni = new Int32Array(this.size * 2);
      ni.set(this.id);
      this.id = ni;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((this.f[p] as number) <= f) break;
      this.f[i] = this.f[p] as number;
      this.id[i] = this.id[p] as number;
      i = p;
    }
    this.f[i] = f;
    this.id[i] = id;
  }

  pop(): number {
    const top = this.id[0] as number;
    const n = --this.size;
    if (n > 0) {
      const lf = this.f[n] as number;
      const li = this.id[n] as number;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && (this.f[r] as number) < (this.f[l] as number) ? r : l;
        if ((this.f[c] as number) >= lf) break;
        this.f[i] = this.f[c] as number;
        this.id[i] = this.id[c] as number;
        i = c;
      }
      this.f[i] = lf;
      this.id[i] = li;
    }
    return top;
  }
}

const DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function astar(
  res: number,
  cost: Float32Array,
  start: number,
  goal: number,
  maxExpand: number,
): { cells: number[]; total: number } | null {
  const n = res * res;
  const g = new Float32Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap();
  const gx = goal % res;
  const gz = (goal / res) | 0;
  const heur = (i: number): number => {
    const dx = Math.abs((i % res) - gx);
    const dz = Math.abs(((i / res) | 0) - gz);
    return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
  };
  g[start] = 0;
  heap.push(heur(start), start);
  let expanded = 0;
  let reached = false;
  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    if (cur === goal) {
      reached = true;
      break;
    }
    closed[cur] = 1;
    if (++expanded > maxExpand) break;
    const cx = cur % res;
    const cz = (cur / res) | 0;
    const cc = cost[cur] as number;
    const gc = g[cur] as number;
    for (const [dx, dz] of DIRS) {
      const xx = cx + dx;
      const zz = cz + dz;
      if (xx < 0 || zz < 0 || xx >= res || zz >= res) continue;
      const ni = zz * res + xx;
      if (closed[ni]) continue;
      const nc = cost[ni] as number;
      if (!(nc < Infinity)) continue;
      const diag = dx !== 0 && dz !== 0;
      if (diag && (!((cost[cz * res + xx] as number) < Infinity) || !((cost[zz * res + cx] as number) < Infinity))) {
        continue;
      }
      const ng = gc + (diag ? SQRT2 : 1) * (cc + nc) * 0.5;
      if (ng < (g[ni] as number)) {
        g[ni] = ng;
        prev[ni] = cur;
        heap.push(ng + heur(ni), ni);
      }
    }
  }
  if (!reached) return null;
  const cells: number[] = [];
  for (let at = goal; at >= 0; at = prev[at] as number) {
    cells.push(at);
    if (at === start) break;
  }
  cells.reverse();
  return cells.length >= 2 ? { cells, total: g[goal] as number } : null;
}

/** 落在 lim 内最长的连续一段 */
function trimInside(pts: Xz[], lim: number): Xz[] {
  let best: Xz[] = [];
  let cur: Xz[] = [];
  for (const p of pts) {
    if (Math.abs(p.x) <= lim && Math.abs(p.z) <= lim) {
      cur.push(p);
    } else {
      if (cur.length > best.length) best = cur;
      cur = [];
    }
  }
  return cur.length > best.length ? cur : best;
}

/** 河心走廊:mask = 离河心 ≤ radius;bandDist = 贴岸带用的离岸距离 */
function riverCorridor(
  nav: NavField,
  spine: Xz[],
  radius: number,
  bankHint: number,
): { mask: Uint8Array; bandDist: Float32Array } {
  const { res } = nav;
  const seed = new Uint8Array(res * res);
  const step = nav.texel * 0.5;
  for (let i = 0; i < spine.length; i++) {
    const a = spine[i]!;
    const b = spine[Math.min(i + 1, spine.length - 1)]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const k = Math.max(1, Math.ceil(len / step));
    for (let j = 0; j <= k; j++) {
      const t = j / k;
      seed[navCell(nav, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)] = 1;
    }
  }
  const d = edt2d(seed, res, nav.texel);
  const mask = new Uint8Array(res * res);
  // 水场里没有这条河(干河床/细溪未成水)时,退回"离 OSM 河心 − 半河宽"
  const bandDist = new Float32Array(res * res);
  for (let i = 0; i < mask.length; i++) {
    const ds = d[i] as number;
    mask[i] = ds <= radius ? 1 : 0;
    bandDist[i] = Math.min(nav.sdWater[i] as number, ds - bankHint);
  }
  return { mask, bandDist };
}

function bankCost(nav: NavField, corridor: Uint8Array, bandDist: Float32Array, o: BankOpts): Float32Array {
  const n = nav.res * nav.res;
  const cost = new Float32Array(n).fill(Infinity);
  for (let i = 0; i < n; i++) {
    if (!corridor[i]) continue;
    const d = nav.sdWater[i] as number;
    let c = 1;
    if (nav.water[i]) c += 450;
    else if (d < o.minStand) c += 40 + (o.minStand - d) * 14;
    const e = ((bandDist[i] as number) - o.target) / 9;
    c += 1.15 * Math.min(e * e, 40);
    if (nav.foot[i]) c += 3000;
    else if (nav.built[i]) c += 22;
    if (nav.cliff[i]) c += 90;
    c += 7 * Math.max(0, (nav.slope[i] as number) - 0.35);
    if (nav.plant[i]) c += 2.2;
    cost[i] = c;
  }
  return cost;
}

/** 从河心端点沿法线找第一个落在贴岸带上的格 */
function bankPoint(
  nav: NavField,
  corridor: Uint8Array,
  bandDist: Float32Array,
  spine: Xz[],
  idx: number,
  side: number,
  o: BankOpts,
): number {
  const p = spine[idx]!;
  const a = spine[Math.max(idx - 1, 0)]!;
  const b = spine[Math.min(idx + 1, spine.length - 1)]!;
  const tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const nx = (-(b.z - a.z) / tl) * side;
  const nz = ((b.x - a.x) / tl) * side;
  let fallback = -1;
  let fbD = -Infinity;
  for (let s = 0; s <= 240; s += 2) {
    const x = p.x + nx * s;
    const z = p.z + nz * s;
    if (Math.abs(x) > o.lim || Math.abs(z) > o.lim) break;
    const i = navCell(nav, x, z);
    if (!corridor[i]) break;
    if (nav.water[i] || nav.foot[i] || nav.cliff[i]) continue;
    const d = bandDist[i] as number;
    if (d >= o.target - 3 && (nav.sdWater[i] as number) >= o.minStand) return i;
    if (d > fbD) {
      fbD = d;
      fallback = i;
    }
  }
  return fbD > 3 ? fallback : -1;
}

/**
 * 视线拉直:弦上不得入水/压楼/上崖、不得比贴岸带更近或远太多,
 * 也不许比原 A* 段多穿植被(避免为了取直从树丛里切过去)。
 */
function pullCells(
  nav: NavField,
  cells: number[],
  corridor: Uint8Array,
  bandDist: Float32Array,
  o: BankOpts,
): Xz[] {
  const pts = cells.map((i) => navCenter(nav, i));
  const plantPrefix = new Int32Array(cells.length + 1);
  for (let i = 0; i < cells.length; i++) {
    plantPrefix[i + 1] = (plantPrefix[i] as number) + (nav.plant[cells[i]!] ? 1 : 0);
  }
  const chordOk = (ia: number, ib: number): boolean => {
    const a = pts[ia]!;
    const b = pts[ib]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(2, Math.ceil(len / 1.5));
    const da = navSample(nav, bandDist, a.x, a.z);
    const db = navSample(nav, bandDist, b.x, b.z);
    const hi = Math.max(o.maxStand, da + 3, db + 3);
    const allowPlants = (plantPrefix[ib] as number) - (plantPrefix[ia] as number) + 1;
    let plants = 0;
    let lastCell = -1;
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const i = navCell(nav, x, z);
      if (!corridor[i] || nav.water[i] || nav.foot[i] || nav.cliff[i]) return false;
      if (navSample(nav, nav.sdWater, x, z) < o.minStand + 1) return false;
      if (navSample(nav, bandDist, x, z) > hi) return false;
      if (i !== lastCell && nav.plant[i]) {
        plants++;
        if (plants > allowPlants) return false;
      }
      lastCell = i;
    }
    return true;
  };
  const out: Xz[] = [{ ...pts[0]! }];
  let a = 0;
  while (a < pts.length - 1) {
    let best = a + 1;
    for (let j = a + 2; j < pts.length; j++) {
      const p = pts[a]!;
      const q = pts[j]!;
      if (Math.hypot(q.x - p.x, q.z - p.z) > 70) break;
      if (chordOk(a, j)) best = j;
    }
    out.push({ ...pts[best]! });
    a = best;
  }
  return out;
}

export function bankRoute(nav: NavField, spineIn: Xz[], o: BankOpts): Xz[] | null {
  const inside = trimInside(spineIn, o.lim - 8);
  if (inside.length < 2) return null;
  let spine = resamplePath(inside, 12, false);
  if (spine.length < 3) return null;
  spine = smoothOpen(spine, 3);
  const radius = Math.min(Math.max(o.bankHint * 2 + 150, 170), 280);
  const { mask: corridor, bandDist } = riverCorridor(nav, spine, radius, o.bankHint);
  const cost = bankCost(nav, corridor, bandDist, o);
  let best: { cells: number[]; total: number } | null = null;
  for (const side of [1, -1]) {
    const s0 = bankPoint(nav, corridor, bandDist, spine, 0, side, o);
    const s1 = bankPoint(nav, corridor, bandDist, spine, spine.length - 1, side, o);
    if (s0 < 0 || s1 < 0 || s0 === s1) continue;
    const r = astar(nav.res, cost, s0, s1, 900_000);
    if (r && (!best || r.total < best.total)) best = r;
  }
  if (!best) return null;
  const pulled = pullCells(nav, best.cells, corridor, bandDist, o);
  return relaxBand(nav, pulled, false, {
    minStand: o.minStand,
    maxStand: o.maxStand,
    iters: 60,
    lim: o.lim,
  });
}

/**
 * 湖环:从湖心放射线,出水后到达目标岸距处取点。
 * 湖心必须落在水里 —— 多块分散水面的质心常在岸上,放射线原地即"达标",整环塌成一点。
 */
export function lakeRing(
  nav: NavField,
  anchor: Xz,
  rMax: number,
  o: { target: number; lim: number },
): Xz[] | null {
  if (navSample(nav, nav.sdWater, anchor.x, anchor.z) > 0) return null;
  const K = 72;
  const pts: Xz[] = [];
  let misses = 0;
  for (let k = 0; k < K; k++) {
    const a = (k / K) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    let left = false;
    let found: Xz | null = null;
    let lastDry: Xz | null = null;
    for (let t = 0; t <= rMax; t += 3) {
      const x = anchor.x + dx * t;
      const z = anchor.z + dz * t;
      if (Math.abs(x) > o.lim || Math.abs(z) > o.lim) break;
      const d = navSample(nav, nav.sdWater, x, z);
      if (d <= 0) {
        if (left) break;
        continue;
      }
      left = true;
      if (!nav.foot[navCell(nav, x, z)]) lastDry = { x, z };
      if (d >= o.target) {
        found = { x, z };
        break;
      }
    }
    const p = found ?? lastDry;
    if (p) pts.push(p);
    else misses++;
  }
  if (pts.length < K * 0.6 || misses > K * 0.3) return null;
  return pts;
}
