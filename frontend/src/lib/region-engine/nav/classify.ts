/**
 * 按河流覆盖 / 起伏 / 孤立峰 / 湖面给区域打分,选出 S 或 O 骨架。
 */

import { hash01 } from "../geo/overpass";
import { sampleCpu, sampleWaterCpu } from "../render/fields";
import type { RiverLine, WorldFields } from "../types";
import type { TourClassification } from "./types";

const STRIDE = 8;

type Xz = { x: number; z: number };

function xzOf(i: number, res: number, size: number): Xz {
  const px = i % res;
  const pz = (i / res) | 0;
  return { x: (px / res - 0.5) * size, z: (pz / res - 0.5) * size };
}

function inBounds(p: Xz, half: number, pad: number): boolean {
  return Math.abs(p.x) <= half - pad && Math.abs(p.z) <= half - pad;
}

function riverLen(r: RiverLine, half: number): { pts: Xz[]; length: number } {
  const n = r.pts.length / 2;
  const pts: Xz[] = [];
  for (let i = 0; i < n; i++) {
    const p = { x: r.pts[i * 2] as number, z: r.pts[i * 2 + 1] as number };
    if (inBounds(p, half, 40)) pts.push(p);
  }
  let length = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    length += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return { pts, length };
}

function resample(pts: Xz[], spacing: number): Xz[] {
  if (pts.length < 2) return pts.slice();
  let total = 0;
  const seg: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    total += Math.hypot(b.x - a.x, b.z - a.z);
    seg.push(total);
  }
  if (total < spacing) return [pts[0]!, pts[pts.length - 1]!];
  const out: Xz[] = [];
  const n = Math.max(4, Math.round(total / spacing));
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

function longestRiver(rivers: RiverLine[], size: number): { pts: Xz[]; length: number; width: number } | null {
  const half = size / 2;
  let best: { pts: Xz[]; length: number; width: number } | null = null;
  for (const r of rivers) {
    const clipped = riverLen(r, half);
    if (clipped.pts.length < 3 || clipped.length < 180) continue;
    if (!best || clipped.length > best.length) {
      best = { pts: clipped.pts, length: clipped.length, width: r.width };
    }
  }
  return best;
}

function valleySpine(fields: WorldFields, seed: number): { spine: Xz[]; anchor: Xz; yaw: number } {
  const { res, size, heights, waterY } = fields;
  const half = size / 2;
  const inner0 = Math.floor(res * 0.1);
  const inner1 = res - inner0;
  const lows: Xz[] = [];
  let hMin = Infinity;
  let hMax = -Infinity;
  for (let z = inner0; z < inner1; z += STRIDE) {
    for (let x = inner0; x < inner1; x += STRIDE) {
      const h = heights[z * res + x] as number;
      if (h < hMin) hMin = h;
      if (h > hMax) hMax = h;
    }
  }
  const cut = hMin + (hMax - hMin) * 0.38;
  let sx = 0;
  let sz = 0;
  for (let z = inner0; z < inner1; z += STRIDE) {
    for (let x = inner0; x < inner1; x += STRIDE) {
      const i = z * res + x;
      const p = xzOf(i, res, size);
      const w = sampleWaterCpu(waterY, p.x, p.z, res, size);
      const g = heights[i] as number;
      if (g > cut) continue;
      if (Number.isFinite(w) && w > g + 0.2) continue;
      lows.push(p);
      sx += p.x;
      sz += p.z;
    }
  }
  const n = Math.max(lows.length, 1);
  const cx = lows.length ? sx / lows.length : 0;
  const cz = lows.length ? sz / lows.length : 0;
  let xx = 0;
  let zz = 0;
  let xz = 0;
  for (const p of lows) {
    const dx = p.x - cx;
    const dz = p.z - cz;
    xx += dx * dx;
    zz += dz * dz;
    xz += dx * dz;
  }
  xx /= n;
  zz /= n;
  xz /= n;
  const yaw =
    lows.length > 8
      ? 0.5 * Math.atan2(2 * xz, xx - zz)
      : hash01(seed ^ 0x51ed) * Math.PI;
  const dirX = Math.cos(yaw);
  const dirZ = Math.sin(yaw);
  const perpX = -dirZ;
  const perpZ = dirX;
  let tMin = 0;
  let tMax = 0;
  for (const p of lows) {
    const t = (p.x - cx) * dirX + (p.z - cz) * dirZ;
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }
  const halfLen = Math.min(Math.max((tMax - tMin) * 0.42, 620), half - 160);
  const amp = 120 + hash01(seed ^ 91) * 90;
  const count = 22;
  const spine: Xz[] = [];
  for (let i = 0; i <= count; i++) {
    const u = i / count;
    const s = (u - 0.5) * 2 * halfLen;
    const wave = Math.sin(u * Math.PI * 2);
    spine.push({
      x: cx + dirX * s + perpX * amp * wave,
      z: cz + dirZ * s + perpZ * amp * wave,
    });
  }
  return { spine, anchor: { x: cx, z: cz }, yaw };
}

export function classifyRegion(fields: WorldFields, rivers: RiverLine[]): TourClassification {
  const { res, size, heights, masks, seed } = fields;
  const half = size / 2;
  const inner0 = Math.floor(res * 0.08);
  const inner1 = res - inner0;
  let cells = 0;
  let riverCells = 0;
  let waterCells = 0;
  let minH = Infinity;
  let maxH = -Infinity;
  let maxI = 0;
  let lakeX = 0;
  let lakeZ = 0;
  let lakeN = 0;
  let lakeXX = 0;
  let lakeZZ = 0;

  for (let z = inner0; z < inner1; z += STRIDE) {
    for (let x = inner0; x < inner1; x += STRIDE) {
      const i = z * res + x;
      cells++;
      const h = heights[i] as number;
      if (h < minH) minH = h;
      if (h > maxH) {
        maxH = h;
        maxI = i;
      }
      if ((masks.riverProfile[i] as number) > 0.28) riverCells++;
      if ((masks.water[i] as number) > 0.5) {
        waterCells++;
        const p = xzOf(i, res, size);
        lakeX += p.x;
        lakeZ += p.z;
        lakeXX += p.x * p.x;
        lakeZZ += p.z * p.z;
        lakeN++;
      }
    }
  }

  const riverCover = riverCells / Math.max(cells, 1);
  const waterCover = waterCells / Math.max(cells, 1);
  const relief = maxH - minH;
  const peak = xzOf(maxI, res, size);
  const tex = size / res;
  let ringH = 0;
  let ringN = 0;
  const ringR = 280;
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2;
    const x = peak.x + Math.cos(ang) * ringR;
    const z = peak.z + Math.sin(ang) * ringR;
    if (!inBounds({ x, z }, half, 20)) continue;
    ringH += sampleCpu(heights, x, z, res, size);
    ringN++;
  }
  const isolation = maxH - (ringN ? ringH / ringN : maxH);

  const river = longestRiver(rivers, size);
  const wantS = (river !== null && river.length > 700) || riverCover > 0.035;
  const wantPeakO = relief > 160 && isolation > 32 && Math.abs(peak.x) < half - 220 && Math.abs(peak.z) < half - 220;
  const wantLakeO = waterCover > 0.07 && riverCover < 0.045 && lakeN > 12;

  if (wantPeakO && !(wantS && river && river.length > 1400)) {
    const prominence = Math.max(isolation, relief * 0.25);
    let rx = Math.min(Math.max(150 + prominence * 1.05, 180), 560);
    const fit = Math.min(half - 140 - Math.abs(peak.x), half - 140 - Math.abs(peak.z));
    rx = Math.min(rx, Math.max(fit, 140));
    const k = 0.86 + hash01(seed ^ 3) * 0.28;
    return {
      kind: "o",
      feature: "peak",
      anchor: peak,
      spine: [],
      bank: 0,
      radiusX: rx,
      radiusZ: rx * k,
      yaw: hash01(seed ^ 11) * Math.PI,
    };
  }

  if (wantLakeO) {
    const ax = lakeX / lakeN;
    const az = lakeZ / lakeN;
    const rmsX = Math.sqrt(Math.max(lakeXX / lakeN - ax * ax, 80 * 80));
    const rmsZ = Math.sqrt(Math.max(lakeZZ / lakeN - az * az, 80 * 80));
    const pad = 18 + tex * 2;
    return {
      kind: "o",
      feature: "lake",
      anchor: { x: ax, z: az },
      spine: [],
      bank: 0,
      radiusX: Math.min(Math.max(rmsX * 1.15 + pad, 140), half - 140),
      radiusZ: Math.min(Math.max(rmsZ * 1.15 + pad, 140), half - 140),
      yaw: hash01(seed ^ 19) * 0.6,
    };
  }

  if (river && (wantS || river.length > 480)) {
    return {
      kind: "s",
      feature: "river",
      anchor: river.pts[(river.pts.length / 2) | 0] ?? { x: 0, z: 0 },
      spine: resample(river.pts, 28),
      bank: river.width / 2 + 8,
      radiusX: 0,
      radiusZ: 0,
      yaw: 0,
    };
  }

  const valley = valleySpine(fields, seed);
  return {
    kind: "s",
    feature: "valley",
    anchor: valley.anchor,
    spine: valley.spine,
    bank: 10,
    radiusX: 0,
    radiusZ: 0,
    yaw: valley.yaw,
  };
}
