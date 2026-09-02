/**
 * WaterFlora — 河湖真实感细节层:岸边芦苇、荇菜浮叶(带黄花)、
 * 水下摇曳水草、河床/湖床卵石与块石、深水处游曳的鱼群。
 *
 * 植物三层沿用 GrassRing 的零上传 clipmap 环:实例槽固定映射到与它同余
 * 且离相机最近的世界格,全部逐实例参数由 hash(worldCell) 在顶点阶段重建;
 * 存活门控读世界纹理(高度/外扩水位/字段):
 *   芦苇 = 岸线带(水下 0.35 m ~ 水上 0.6 m);
 *   荇菜 = 浅静水(深 0.05~0.85 m 且流速低/湖面);
 *   水草 = 河湖床(深 0.35~3 m),沿流向倾伏 + 正弦摇曳;
 *   卵石/块石 = 溪流急滩、河岸浅滩、湖滨,按 seed 与流态稀疏铺开。
 * 鱼群已升级为专用 TSL 系统(见 FishSchools.ts):按水深分配 8 种常见
 * 淡水鱼,每群独立控制算法 + 光柱信标,此处仅负责接入。
 */

import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
} from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import {
  cameraPosition,
  clamp,
  cos,
  float,
  instanceIndex,
  ivec2,
  mix,
  normalLocal,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  textureLoad,
  transformNormalToView,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import { fbm2, hash2, hashCell } from "../gpu/noise";
import type { NF, NV2, NV3 } from "../gpu/tsl-types";
import type { EnvState } from "../render/env";
import {
  sampleFloatBilinear,
  sampleWaterLevel,
  type WorldTextures,
} from "../render/fields";
import type { WorldFields } from "../types";
import { makeRng } from "../veg/treeBuilder";
import { createFishSchools } from "./FishSchools";

// ---------------------------------------------------------------------------
// 几何
// ---------------------------------------------------------------------------

/** 锥形条带叶片(同 GrassRing 弧面法线风格),bendZ 控制内建弯折 */
function bladeGeometry(
  segs: number,
  W: number,
  bendZ: number,
): { pos: number[]; nrm: number[]; uvA: number[]; idx: number[] } {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uvA: number[] = [];
  const idx: number[] = [];
  const SN = 0.616;
  const CS = 0.788;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = W * (1 - t * 0.8);
    const bz = t * t * bendZ;
    const y = t * (1 - t * t * 0.08);
    if (i < segs) {
      pos.push(-w, y, bz, w, y, bz);
      nrm.push(-SN, 0.25, -CS, SN, 0.25, -CS);
      uvA.push(0, t, 1, t);
    } else {
      pos.push(0, y, bz);
      nrm.push(0, 0.25, -1);
      uvA.push(0.5, 1);
    }
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    if (i < segs - 1) idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    else idx.push(a, a + 1, a + 2);
  }
  return { pos, nrm, uvA, idx };
}

/** N 叶簇(芦苇/水草共用):逐叶随机朝向/偏移/高矮/倾斜 */
function clumpGeometry(opts: {
  blades: number;
  segs: number;
  width: number;
  spread: number;
  bend: number;
  lean: number;
  seed: number;
}): BufferGeometry {
  const rng = makeRng(opts.seed);
  const pos: number[] = [];
  const nrm: number[] = [];
  const uvA: number[] = [];
  const idx: number[] = [];
  for (let b = 0; b < opts.blades; b++) {
    const base = bladeGeometry(opts.segs, opts.width, opts.bend);
    const yawA = rng() * Math.PI * 2;
    const c = Math.cos(yawA);
    const sn = Math.sin(yawA);
    const ox = (rng() - 0.5) * opts.spread;
    const oz = (rng() - 0.5) * opts.spread;
    const hk = 0.7 + rng() * 0.6;
    const lean = (rng() - 0.5) * opts.lean;
    const v0 = pos.length / 3;
    for (let i = 0; i < base.pos.length / 3; i++) {
      const x = base.pos[i * 3] as number;
      const y = (base.pos[i * 3 + 1] as number) * hk;
      const z = base.pos[i * 3 + 2] as number;
      pos.push(
        x * c + z * sn + ox + lean * y * c,
        y,
        z * c - x * sn + oz + lean * y * sn,
      );
      const nx = base.nrm[i * 3] as number;
      const ny = base.nrm[i * 3 + 1] as number;
      const nz = base.nrm[i * 3 + 2] as number;
      nrm.push(nx * c + nz * sn, ny, nz * c - nx * sn);
      uvA.push(base.uvA[i * 2] as number, base.uvA[i * 2 + 1] as number);
    }
    for (const j of base.idx) idx.push(v0 + j);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uvA), 2));
  g.setIndex(idx);
  return g;
}

/** 荇菜浮叶簇:XZ 面小圆盘 × N,每叶带一道楔形缺口(荇菜叶特征) */
function padClusterGeometry(discs: number, seed: number): BufferGeometry {
  const rng = makeRng(seed);
  const pos: number[] = [];
  const nrm: number[] = [];
  const uvA: number[] = [];
  const idx: number[] = [];
  const SEGR = 9;
  for (let d = 0; d < discs; d++) {
    const cx = (rng() - 0.5) * 0.62;
    const cz = (rng() - 0.5) * 0.62;
    const r = 0.035 + rng() * 0.06;
    const cy = d * 0.0025; // 同簇叶片错高,避免共面闪烁
    const notch = rng() * Math.PI * 2;
    const center = pos.length / 3;
    pos.push(cx, cy, cz);
    nrm.push(0, 1, 0);
    uvA.push(0.5, 0.5);
    for (let k = 0; k <= SEGR; k++) {
      const a = (k / SEGR) * Math.PI * 2;
      // 楔形缺口:缺口角 ±0.45 rad 内半径收缩
      let dd = Math.abs(a - notch);
      dd = Math.min(dd, Math.PI * 2 - dd);
      const cut = 1 - 0.8 * Math.max(0, 1 - dd / 0.45);
      const rr = r * cut;
      pos.push(cx + Math.cos(a) * rr, cy, cz + Math.sin(a) * rr);
      nrm.push(0, 1, 0);
      uvA.push(Math.cos(a) * 0.5 + 0.5, Math.sin(a) * 0.5 + 0.5);
    }
    for (let k = 0; k < SEGR; k++) {
      idx.push(center, center + 1 + k + 1, center + 1 + k);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uvA), 2));
  g.setIndex(idx);
  return g;
}

/** 荇菜小黄花:两片交叉竖立小方片 */
function flowerGeometry(): BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uvA: number[] = [];
  const idx: number[] = [];
  const W = 0.028;
  const H = 0.05;
  for (let k = 0; k < 2; k++) {
    const c = k === 0 ? 1 : 0;
    const s = k === 0 ? 0 : 1;
    const v0 = pos.length / 3;
    for (const [u, v] of [
      [-W, 0],
      [W, 0],
      [W, H],
      [-W, H],
    ] as const) {
      pos.push(u * c, v, u * s);
      nrm.push(0, 1, 0);
      uvA.push(u < 0 ? 0 : 1, v / H);
    }
    idx.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uvA), 2));
  g.setIndex(idx);
  return g;
}

/**
 * 水磨卵石:细分二十面体(无 UV 球极点/接缝)沿径向轻位移成椭球,
 * 法线用椭球解析梯度,避免 computeVertexNormals 在低模上打出切面。
 */
function cobbleGeometry(seed: number, kind: "pebble" | "cobble" | "stone"): BufferGeometry {
  const detail = kind === "pebble" ? 2 : 3;
  const g = new IcosahedronGeometry(0.5, detail);
  const rng = makeRng(seed);
  const ax = 0.9 + rng() * 0.22;
  const ay = 0.7 + rng() * 0.18;
  const az = 0.86 + rng() * 0.24;
  const k1 = 1.15 + rng() * 1.1;
  const ph1 = rng() * Math.PI * 2;
  const k2 = 1.6 + rng() * 1.2;
  const ph2 = rng() * Math.PI * 2;
  const k3 = 2.4 + rng() * 1.1;
  const ph3 = rng() * Math.PI * 2;
  const amp1 = 0.035 + rng() * 0.03;
  const amp2 = 0.018 + rng() * 0.018;
  const amp3 = 0.01 + rng() * 0.012;
  const pos = g.getAttribute("position") as BufferAttribute;
  const nrm = g.getAttribute("normal") as BufferAttribute;
  const ax2 = ax * ax;
  const ay2 = ay * ay;
  const az2 = az * az;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const n = Math.hypot(x, y, z) || 1;
    x /= n;
    y /= n;
    z /= n;
    const lon = Math.atan2(z, x);
    const lat = Math.asin(Math.max(-1, Math.min(1, y)));
    const r =
      1 +
      amp1 * Math.sin(k1 * lon + ph1) +
      amp2 * Math.sin(k2 * lat + ph2) +
      amp3 * Math.sin(k3 * (lon + lat) + ph3);
    const px = x * ax * r;
    const py = y * ay * r;
    const pz = z * az * r;
    pos.setXYZ(i, px, py, pz);
    let nx = px / ax2;
    let ny = py / ay2;
    let nz = pz / az2;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nrm.setXYZ(i, nx / nl, ny / nl, nz / nl);
  }
  nrm.needsUpdate = true;
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const minY = bb?.min.y ?? -0.15;
  const maxY = bb?.max.y ?? 0.15;
  const bury = kind === "pebble" ? 0.6 : kind === "cobble" ? 0.56 : 0.52;
  g.translate(0, -(minY + (maxY - minY) * bury), 0);
  return g;
}

// ---------------------------------------------------------------------------
// clipmap 环 wrap(同 GrassRing)
// ---------------------------------------------------------------------------

type RingOpts = { grid: number; cell: number; radius: number; salt: number };

function ringSlot(o: RingOpts): { wc: NV2; wpos: NV2; dist: NF } {
  const i = float(instanceIndex);
  const sx = i.mod(o.grid);
  const sy = i.div(o.grid).floor();
  const camC = vec2(cameraPosition.x, cameraPosition.z).div(o.cell);
  const wc = vec2(
    camC.x.sub(sx).div(o.grid).round().mul(o.grid).add(sx),
    camC.y.sub(sy).div(o.grid).round().mul(o.grid).add(sy),
  ).toVar();
  const jit = vec2(hashCell(wc, o.salt + 1), hashCell(wc, o.salt + 2));
  const wpos = wc.add(jit).mul(o.cell).toVar();
  const dist = wpos
    .sub(vec2(cameraPosition.x, cameraPosition.z))
    .length()
    .toVar();
  return { wc, wpos, dist };
}

/** 主地形边界裁剪(与草毯一致,不飘到裙带上) */
function inBoundsK(wpos: NV2, size: number): NF {
  const halfR = size / 2;
  const edgeD = wpos.x.abs().max(wpos.y.abs());
  return float(1).sub(smoothstep(halfR - 16, halfR - 4, edgeD));
}

/** 逐实例世界字段包(所有水生层共用的采样) */
function sampleFields(tex: WorldTextures, wpos: NV2) {
  const { res, size } = tex;
  const h = sampleFloatBilinear(tex.heightTex, wpos, res, size).toVar();
  const wl = sampleWaterLevel(tex.waterExtTex, wpos, res, size);
  const ci = (v: NF) => clamp(v, 0, res - 1).toInt();
  const px = wpos.div(size).add(0.5).mul(res);
  const ip = ivec2(ci(px.x), ci(px.y));
  const bio = textureLoad(tex.biomeTex, ip).toVar(); // r=id g=snow b=veg a=moist
  const msk = textureLoad(tex.maskTex, ip).toVar(); // r=forest g=farm b=urban a=sand
  const fld = textureLoad(tex.fieldsTex, ip).toVar(); // rg=flow b=profile a=lake
  return { h, wl, bio, msk, fld };
}

// ---------------------------------------------------------------------------
// 芦苇(岸线挺水植物)
// ---------------------------------------------------------------------------

const REED_GRID = 96;
const REED_CELL = 1.05;

function reedMaterial(tex: WorldTextures, env: EnvState, o: RingOpts) {
  const mat = new MeshStandardNodeMaterial();
  mat.metalness = 0;
  mat.roughness = 0.78;
  mat.side = DoubleSide;

  const { wc, wpos, dist } = ringSlot(o);
  const { h, wl, bio, msk } = sampleFields(tex, wpos);
  const above = h.sub(wl.y).toVar();

  // 岸线带:水下 0.35 m ~ 水上 0.6 m,越近水线越密
  const band = wl.valid
    .mul(smoothstep(-0.45, -0.28, above))
    .mul(smoothstep(0.75, 0.35, above))
    .toVar();
  const patch = fbm2(wpos.div(6.5), 2).mul(0.5).add(0.5);
  const dens = band
    .mul(smoothstep(0.2, 0.75, patch).mul(0.75).add(0.25))
    .mul(bio.w.mul(0.6).add(0.4)) // 湿度
    .mul(smoothstep(0.5, 0.2, msk.z)) // 城区不长
    .mul(bio.y.mul(0.95).oneMinus()) // 雪
    .mul(inBoundsK(wpos, tex.size))
    .mul(0.85);
  const alive = hash2(wc, o.salt).lessThan(dens).select(float(1), float(0));
  const bandK = float(1).sub(smoothstep(o.radius - 9, o.radius, dist));
  const sK = alive.mul(bandK).toVar();

  const h1 = hash2(wc, o.salt + 3);
  const h2 = hash2(wc, o.salt + 4);
  const reedH = h1.mul(0.75).add(0.85).mul(sK); // 0.85~1.6 m
  const yawA = h2.mul(6.2831853);
  const c = cos(yawA);
  const s = sin(yawA);
  const ls = positionLocal.mul(vec3(sK, reedH, sK)).toVar();
  const rx = ls.x.mul(c).add(ls.z.mul(s));
  const rz = ls.z.mul(c).sub(ls.x.mul(s));

  // 风:芦苇比草硬 → 幅度小、频率低
  const tN = positionLocal.y;
  const gust = sin(env.time.mul(1.15).add(h1.mul(6.28)).add(wpos.x.mul(0.12)))
    .mul(0.5)
    .add(0.7);
  const bend = env.windStrength.mul(gust).mul(tN.mul(tN)).mul(0.2).mul(reedH);
  const dx = env.windDir.x.mul(bend);
  const dz = env.windDir.y.mul(bend);

  mat.positionNode = vec3(
    rx.add(dx).add(wpos.x),
    ls.y.add(h.sub(0.04)),
    rz.add(dz).add(wpos.y),
  );

  const nR = vec3(
    normalLocal.x.mul(c).add(normalLocal.z.mul(s)),
    normalLocal.y,
    normalLocal.z.mul(c).sub(normalLocal.x.mul(s)),
  );
  mat.normalNode = transformNormalToView(
    mix(nR.normalize(), vec3(0, 1, 0), 0.45).normalize() as unknown as NV3,
  );

  // 颜色:根部深橄榄 → 叶尖黄绿;部分整株偏枯(芦苇秋色)
  const tUv = uv().y as unknown as NF;
  let albedo = mix(
    vec3(0.09, 0.15, 0.055),
    vec3(0.27, 0.31, 0.11),
    tUv.pow(1.35),
  ) as unknown as NV3;
  const dryK = smoothstep(0.72, 0.95, hash2(wc, o.salt + 7)).mul(0.8);
  albedo = mix(albedo, vec3(0.4, 0.32, 0.15), dryK) as unknown as NV3;
  albedo = albedo.mul(hash2(wc, o.salt + 8).sub(0.5).mul(0.2).add(1)) as unknown as NV3;
  mat.colorNode = albedo;
  mat.aoNode = smoothstep(0.0, 0.5, tUv).mul(0.35).add(0.65);
  return mat;
}

// ---------------------------------------------------------------------------
// 荇菜浮叶 + 黄花(浅静水)
// ---------------------------------------------------------------------------

const PAD_GRID = 64;
const PAD_CELL = 0.66;
const FLOWER_GRID = 40;
const FLOWER_CELL = 1.05;

/** 浮叶/花共用的存活密度(浅静水门控) */
function padGate(
  tex: WorldTextures,
  wpos: NV2,
  fields: ReturnType<typeof sampleFields>,
): NF {
  const { h, wl, fld } = fields;
  const depth = wl.y.sub(h).toVar();
  const inDepth = wl.valid
    .mul(smoothstep(0.04, 0.12, depth))
    .mul(smoothstep(0.95, 0.6, depth));
  // 静水:湖面(fld.a)或低流速河缘(fld.b 剖面小)
  const slow = smoothstep(0.38, 0.12, fld.z).max(smoothstep(0.3, 0.7, fld.w));
  const patch = fbm2(wpos.div(4.2).add(vec2(3.7, 8.1)), 2).mul(0.5).add(0.5);
  return inDepth
    .mul(slow)
    .mul(smoothstep(0.3, 0.8, patch))
    .mul(inBoundsK(wpos, tex.size));
}

function padMaterial(tex: WorldTextures, env: EnvState, o: RingOpts) {
  const mat = new MeshStandardNodeMaterial();
  mat.metalness = 0;
  mat.roughness = 0.45; // 蜡质叶面微光
  mat.side = DoubleSide;
  mat.transparent = true; // 进透明队列,排在水面之后叠加

  const { wc, wpos, dist } = ringSlot(o);
  const fields = sampleFields(tex, wpos);
  const dens = padGate(tex, wpos, fields).mul(0.8);
  const alive = hash2(wc, o.salt).lessThan(dens).select(float(1), float(0));
  const bandK = float(1).sub(smoothstep(o.radius - 6, o.radius, dist));
  const sK = alive.mul(bandK).toVar();

  const h1 = hash2(wc, o.salt + 3);
  const h2 = hash2(wc, o.salt + 4);
  const scale = h1.mul(0.6).add(0.7).mul(sK);
  const yawA = h2.mul(6.2831853);
  const c = cos(yawA);
  const s = sin(yawA);
  const ls = positionLocal.mul(vec3(scale, sK, scale)).toVar();
  const rx = ls.x.mul(c).add(ls.z.mul(s));
  const rz = ls.z.mul(c).sub(ls.x.mul(s));
  // 浮在水面略上方 + 轻微起伏(与水面 +0.02 错开防深度打架)
  const bob = sin(env.time.mul(0.8).add(h1.mul(6.28))).mul(0.012);
  const y = fields.wl.y.add(0.045).add(bob).add(h2.mul(0.008));

  mat.positionNode = vec3(rx.add(wpos.x), ls.y.add(y), rz.add(wpos.y));
  mat.normalNode = transformNormalToView(vec3(0, 1, 0));

  // 叶心亮绿 → 叶缘深绿;部分叶偏红棕(荇菜老叶)
  const r2 = uv().sub(0.5).length().mul(2) as unknown as NF;
  let albedo = mix(
    vec3(0.1, 0.21, 0.075),
    vec3(0.045, 0.115, 0.05),
    smoothstep(0.45, 1.0, r2),
  ) as unknown as NV3;
  const oldK = smoothstep(0.7, 0.95, hash2(wc, o.salt + 6)).mul(0.55);
  albedo = mix(albedo, vec3(0.21, 0.13, 0.06), oldK) as unknown as NV3;
  mat.colorNode = albedo;
  return mat;
}

function flowerMaterial(tex: WorldTextures, env: EnvState, o: RingOpts) {
  const mat = new MeshStandardNodeMaterial();
  mat.metalness = 0;
  mat.roughness = 0.6;
  mat.side = DoubleSide;
  mat.transparent = true;

  const { wc, wpos, dist } = ringSlot(o);
  const fields = sampleFields(tex, wpos);
  // 花比叶稀疏得多
  const dens = padGate(tex, wpos, fields).mul(0.22);
  const alive = hash2(wc, o.salt).lessThan(dens).select(float(1), float(0));
  const bandK = float(1).sub(smoothstep(o.radius - 6, o.radius, dist));
  const sK = alive.mul(bandK).toVar();

  const h1 = hash2(wc, o.salt + 3);
  const bob = sin(env.time.mul(0.8).add(h1.mul(6.28))).mul(0.012);
  const y = fields.wl.y.add(0.05).add(bob);
  const ls = positionLocal.mul(sK).toVar();
  mat.positionNode = vec3(ls.x.add(wpos.x), ls.y.add(y), ls.z.add(wpos.y));
  mat.normalNode = transformNormalToView(vec3(0, 1, 0));

  // 明黄小花,微自发光让水面上有"星点"
  const albedo = vec3(0.93, 0.78, 0.2);
  mat.colorNode = albedo;
  mat.emissiveNode = albedo.mul(env.nightK.oneMinus().mul(0.22));
  return mat;
}

// ---------------------------------------------------------------------------
// 水下水草(沉水植物,沿流向倾伏)
// ---------------------------------------------------------------------------

const WEED_GRID = 56;
const WEED_CELL = 0.72;

function weedMaterial(tex: WorldTextures, env: EnvState, o: RingOpts) {
  const mat = new MeshStandardNodeMaterial();
  mat.metalness = 0;
  mat.roughness = 0.9;
  mat.side = DoubleSide;

  const { wc, wpos, dist } = ringSlot(o);
  const { h, wl, fld } = sampleFields(tex, wpos);
  const depth = wl.y.sub(h).toVar();
  // 0.1 m 起步:湖泊/溪流在数据层普遍很浅(湖水位 = 最低岸点 − 0.25),
  // 生长带过深会导致浅湖完全无水草;株高本身随水深缩放,浅处自然矮小
  const band = wl.valid
    .mul(smoothstep(0.1, 0.2, depth))
    .mul(smoothstep(3.4, 2.4, depth));
  const patch = fbm2(wpos.div(5.5).add(vec2(11.3, 2.9)), 2).mul(0.5).add(0.5);
  const dens = band
    .mul(smoothstep(0.28, 0.75, patch))
    .mul(inBoundsK(wpos, tex.size))
    .mul(fld.w.mul(0.35).add(0.65));
  const alive = hash2(wc, o.salt).lessThan(dens).select(float(1), float(0));
  const bandK = float(1).sub(smoothstep(o.radius - 6, o.radius, dist));
  const sK = alive.mul(bandK).toVar();

  const h1 = hash2(wc, o.salt + 3);
  const h2 = hash2(wc, o.salt + 4);
  // 株高随水深:叶尖接近水面但不出水
  const weedH = depth.mul(0.72).min(1.35).mul(h1.mul(0.45).add(0.7)).mul(sK);
  const yawA = h2.mul(6.2831853);
  const c = cos(yawA);
  const s = sin(yawA);
  const ls = positionLocal.mul(vec3(sK, weedH, sK)).toVar();
  const rx = ls.x.mul(c).add(ls.z.mul(s));
  const rz = ls.z.mul(c).sub(ls.x.mul(s));

  // 沿流向倾伏 + 正弦摇曳(尖端幅度大)
  const flow = fld.xy.mul(2).sub(1).toVar();
  const tN = positionLocal.y;
  const tSq = tN.mul(tN);
  const sway = sin(env.time.mul(1.5).add(h1.mul(6.28)).add(wpos.y.mul(0.4)));
  const swayP = cos(env.time.mul(1.1).add(h2.mul(6.28)));
  const leanX = flow.x.mul(0.55).add(sway.mul(0.22)).mul(tSq).mul(weedH);
  const leanZ = flow.y.mul(0.55).add(swayP.mul(0.22)).mul(tSq).mul(weedH);

  mat.positionNode = vec3(
    rx.add(leanX).add(wpos.x),
    ls.y.add(h.sub(0.08)),
    rz.add(leanZ).add(wpos.y),
  );
  const nR = vec3(
    normalLocal.x.mul(c).add(normalLocal.z.mul(s)),
    normalLocal.y,
    normalLocal.z.mul(c).sub(normalLocal.x.mul(s)),
  );
  mat.normalNode = transformNormalToView(
    mix(nR.normalize(), vec3(0, 1, 0), 0.5).normalize() as unknown as NV3,
  );

  // 深水生绿,尖端稍亮;透过 Beer-Lambert 水色读作暗绿摇曳影
  const tUv = uv().y as unknown as NF;
  let albedo = mix(
    vec3(0.04, 0.1, 0.045),
    vec3(0.12, 0.22, 0.08),
    tUv.mul(tUv),
  ) as unknown as NV3;
  albedo = mix(albedo, vec3(0.09, 0.12, 0.05), hash2(wc, o.salt + 6).mul(0.55)) as unknown as NV3;
  mat.colorNode = albedo;
  mat.aoNode = smoothstep(0.0, 0.6, tUv).mul(0.4).add(0.6);
  return mat;
}

// ---------------------------------------------------------------------------
// 河床/湖床卵石与块石
// ---------------------------------------------------------------------------

const PEBBLE_GRID = 112;
const PEBBLE_CELL = 0.18;
const COBBLE_GRID = 80;
const COBBLE_CELL = 0.38;
const STONE_GRID = 44;
const STONE_CELL = 0.88;

function stoneMaterial(
  tex: WorldTextures,
  env: EnvState,
  o: RingOpts & { kind: "pebble" | "cobble" | "stone" },
) {
  const mat = new MeshStandardNodeMaterial();
  mat.metalness = 0;
  mat.roughness = 0.94;

  const { wc, wpos, dist } = ringSlot(o);
  const { h, wl, fld } = sampleFields(tex, wpos);
  const depth = wl.y.sub(h).toVar();
  const wet = wl.valid
    .mul(smoothstep(0.02, 0.08, depth))
    .mul(smoothstep(3.2, 2.2, depth))
    .toVar();
  const waterPoly = smoothstep(0.2, 0.65, fld.w);
  const profile = fld.z.toVar();
  const lakeK = waterPoly.mul(smoothstep(0.34, 0.1, profile));
  const inChan = smoothstep(0.08, 0.4, profile).mul(lakeK.oneMinus());
  const { res, size } = tex;
  const ci = (v: NF) => clamp(v, 0, res - 1).toInt();
  const px = wpos.div(size).add(0.5).mul(res);
  const off = (8 * res) / size;
  const pNear = textureLoad(tex.fieldsTex, ivec2(ci(px.x.add(off)), ci(px.y)))
    .z.min(textureLoad(tex.fieldsTex, ivec2(ci(px.x.sub(off)), ci(px.y))).z)
    .min(textureLoad(tex.fieldsTex, ivec2(ci(px.x), ci(px.y.add(off)))).z)
    .min(textureLoad(tex.fieldsTex, ivec2(ci(px.x), ci(px.y.sub(off)))).z);
  const streamK = inChan.mul(smoothstep(0.42, 0.14, pNear));
  const riverK = inChan.mul(smoothstep(0.16, 0.48, pNear));
  const lakeShore = lakeK.mul(smoothstep(1.1, 0.2, depth));
  const riverBank = smoothstep(0.08, 0.3, profile).mul(smoothstep(0.8, 0.45, profile));
  const patch = fbm2(
    wpos.div(3.2).add(vec2((tex.seed % 97) * 0.11, 12.2)),
    2,
  )
    .mul(0.5)
    .add(0.5);
  const salt = o.salt + (tex.seed % 997);
  let dens: NF;
  if (o.kind === "pebble") {
    dens = wet
      .mul(streamK.mul(0.92).add(riverK.mul(0.78)).add(lakeShore.mul(0.22)))
      .mul(smoothstep(0.08, 0.48, patch))
      .mul(inBoundsK(wpos, tex.size));
  } else if (o.kind === "cobble") {
    dens = wet
      .mul(streamK.mul(0.74).add(riverK.mul(0.52)).add(lakeShore.mul(0.12)))
      .mul(smoothstep(0.14, 0.55, patch))
      .mul(inBoundsK(wpos, tex.size));
  } else {
    dens = wet
      .mul(riverBank.mul(inChan).mul(0.36).add(streamK.mul(0.24)).add(lakeShore.mul(0.06)))
      .mul(smoothstep(0.24, 0.68, patch))
      .mul(inBoundsK(wpos, tex.size));
  }
  const alive = hashCell(wc, salt).lessThan(dens).select(float(1), float(0));
  const bandK = float(1).sub(smoothstep(o.radius - 6, o.radius, dist));
  const sK = alive.mul(bandK).toVar();

  const h1 = hashCell(wc, salt + 3);
  const h2 = hashCell(wc, salt + 4);
  const h3 = hashCell(wc, salt + 5);
  const base = o.kind === "pebble" ? 0.034 : o.kind === "cobble" ? 0.095 : 0.21;
  const span = o.kind === "pebble" ? 0.05 : o.kind === "cobble" ? 0.13 : 0.24;
  const uni = h1.mul(span).add(base).mul(sK);
  const sx = uni.mul(hashCell(wc, salt + 6).mul(0.2).add(0.9));
  const sy = uni.mul(h3.mul(0.12).add(0.9));
  const sz = uni.mul(h2.mul(0.2).add(0.9));
  const yawA = h2.mul(6.2831853);
  const pitch = h3.sub(0.5).mul(0.28);
  const c = cos(yawA);
  const s = sin(yawA);
  const cp = cos(pitch);
  const sp = sin(pitch);
  const ls = positionLocal.mul(vec3(sx, sy, sz)).toVar();
  const ly = ls.y.mul(cp).sub(ls.z.mul(sp));
  const lz = ls.y.mul(sp).add(ls.z.mul(cp));
  const rx = ls.x.mul(c).add(lz.mul(s));
  const rz = lz.mul(c).sub(ls.x.mul(s));
  const extraBury = h3.mul(0.04).add(0.02);
  mat.positionNode = vec3(rx.add(wpos.x), ly.add(h).sub(extraBury), rz.add(wpos.y));

  // 非均匀缩放必须用 S^{-1} 变换法线,否则椭球光照会按三角面切开。
  const n0 = vec3(
    normalLocal.x.div(sx.add(0.0001)),
    normalLocal.y.div(sy.add(0.0001)),
    normalLocal.z.div(sz.add(0.0001)),
  );
  const nP = vec3(
    n0.x,
    n0.y.mul(cp).sub(n0.z.mul(sp)),
    n0.y.mul(sp).add(n0.z.mul(cp)),
  );
  const nR = vec3(
    nP.x.mul(c).add(nP.z.mul(s)),
    nP.y,
    nP.z.mul(c).sub(nP.x.mul(s)),
  ).normalize();
  const pit = fbm2(positionLocal.xz.div(0.08).add(vec2(h1.mul(3), h2.mul(2))), 3);
  const pit2 = fbm2(positionLocal.xz.div(0.08).add(vec2(4.1, 7.7)), 3);

  const tint = hashCell(wc, salt + 8);
  let albedo = mix(vec3(0.48, 0.34, 0.18), vec3(0.24, 0.26, 0.29), tint) as unknown as NV3;
  albedo = mix(albedo, vec3(0.36, 0.28, 0.16), hashCell(wc, salt + 9).mul(0.5)) as unknown as NV3;
  albedo = mix(albedo, vec3(0.34, 0.33, 0.31), hashCell(wc, salt + 10).mul(0.3)) as unknown as NV3;
  albedo = albedo.mul(pit.mul(0.1).add(0.93)) as unknown as NV3;

  // 周丛生物(对照 USGS High Ore Creek 卵石绿褐粘膜、Oregon 水下 periphyton、
  // Cladophora 丝状绿藻、Fontinalis 深色水藓):顶面粘膜近全覆盖,丝状藻成簇,
  // 大石凹处青苔;埋进沙里的底面被冲磨,几乎不长。噪声走卵石局部坐标,避免
  // 相邻石头共用同一张世界贴图。
  const loc = positionLocal.xz.add(vec2(h1.mul(2.7), h2.mul(3.3)));
  const upK = smoothstep(0.05, 0.68, nR.y);
  const sideK = smoothstep(-0.2, 0.28, nR.y).mul(smoothstep(0.82, 0.38, nR.y));
  const buried = smoothstep(0.02, -0.05, positionLocal.y);
  const live = buried.oneMinus();
  const colonize = hashCell(wc, salt + 11);
  const filmN = fbm2(loc.div(0.09).add(vec2(h1.mul(4.2), h2.mul(3.1))), 3)
    .mul(0.5)
    .add(0.5);
  const diatom = upK
    .add(sideK.mul(0.55))
    .mul(colonize.mul(0.35).add(0.62))
    .mul(smoothstep(0.08, 0.42, filmN))
    .mul(live);
  // USGS High Ore Creek / Oregon 水下卵石:粘膜是泥金褐,不是纯灰石
  const diatomCol = mix(vec3(0.44, 0.36, 0.18), vec3(0.2, 0.24, 0.1), filmN);
  albedo = mix(albedo, diatomCol, diatom.mul(0.9)) as unknown as NV3;

  // Nostoc 类金橄榄色团块(Oregon 水下 periphyton 照片中的 golden blobs)
  const blobN = fbm2(loc.div(0.055).add(vec2(h3.mul(5.1), 2.4)), 2).mul(0.5).add(0.5);
  const nostoc = upK
    .mul(smoothstep(0.72, 0.9, blobN))
    .mul(smoothstep(0.45, 0.8, colonize))
    .mul(live);
  albedo = mix(albedo, vec3(0.38, 0.32, 0.1), nostoc.mul(0.8)) as unknown as NV3;

  const filN = fbm2(loc.div(0.06).add(vec2(h2.mul(5.4), 8.1)), 3).mul(0.5).add(0.5);
  const filBoost = lakeK.mul(0.85).add(riverK.mul(0.5)).add(streamK.mul(0.18)).add(0.32);
  const filament = smoothstep(0.42, 0.72, filN)
    .mul(upK)
    .mul(smoothstep(0.28, 0.72, colonize))
    .mul(filBoost)
    .mul(live);
  // Cladophora / High Ore 鲜绿:橄榄底 + 受光处偏黄绿
  const greenFil = mix(vec3(0.18, 0.3, 0.08), vec3(0.36, 0.46, 0.12), hashCell(wc, salt + 12));
  albedo = mix(albedo, greenFil, filament.mul(0.92)) as unknown as NV3;

  const mossN = fbm2(loc.div(0.07).add(vec2(3.3, h3.mul(4.6))), 2).mul(0.5).add(0.5);
  const mossCeil = o.kind === "pebble" ? 0.16 : o.kind === "cobble" ? 0.62 : 0.92;
  const moss = upK
    .mul(smoothstep(0.55, 0.84, mossN))
    .mul(smoothstep(0.38, 0.86, colonize))
    .mul(lakeK.mul(0.5).add(0.5))
    .mul(mossCeil)
    .mul(live);
  // Fontinalis:近黑的深绿绒斑,比丝状藻更深
  albedo = mix(albedo, vec3(0.05, 0.14, 0.035), moss.mul(0.94)) as unknown as NV3;

  // 高频砂感走粗糙度/反照,法线只做极轻扰动,避免再切出三角面。
  const grit = fbm2(loc.div(0.022).add(vec2(h1.mul(6.1), h3.mul(4.4))), 4)
    .mul(0.5)
    .add(0.5);
  albedo = albedo.mul(grit.mul(0.22).add(0.84)) as unknown as NV3;

  const nBump = vec3(
    nR.x.add(pit.mul(0.045)).add(moss.mul(0.04)),
    nR.y.add(moss.mul(0.03)),
    nR.z.add(pit2.mul(0.045)),
  ).normalize();
  mat.normalNode = transformNormalToView(nBump as unknown as NV3);

  const contact = smoothstep(0.06, -0.04, positionLocal.y);
  albedo = albedo.mul(float(1).sub(contact.mul(0.5))) as unknown as NV3;
  const tC = env.time.mul(0.55);
  const cP = positionWorld.xz.div(0.95);
  const cA = sin(cP.x.mul(4.2).add(tC)).mul(sin(cP.y.mul(4.8).sub(tC.mul(0.85))));
  const cB = sin(cP.x.add(cP.y).mul(3.3).sub(tC.mul(0.7))).mul(
    sin(cP.x.sub(cP.y).mul(3.7).add(tC.mul(0.55))),
  );
  const caus = cA.abs().oneMinus().mul(cB.abs().oneMinus());
  const caus4 = caus.mul(caus).mul(caus);
  albedo = albedo.mul(caus4.mul(0.55).add(0.8)) as unknown as NV3;
  albedo = albedo.add(vec3(0.1, 0.11, 0.08).mul(caus4)) as unknown as NV3;
  mat.colorNode = albedo.mul(0.62);
  mat.roughnessNode = float(0.93)
    .add(grit.mul(0.06))
    .sub(diatom.mul(0.12))
    .sub(filament.mul(0.04))
    .add(moss.mul(0.05));
  mat.fog = true;
  return mat;
}

// ---------------------------------------------------------------------------
// 总装
// ---------------------------------------------------------------------------

export function createWaterFlora(
  tex: WorldTextures,
  env: EnvState,
  fields: WorldFields,
): Group {
  const group = new Group();

  const reeds = new InstancedMesh(
    clumpGeometry({
      blades: 5,
      segs: 4,
      width: 0.02,
      spread: 0.42,
      bend: 0.16,
      lean: 0.3,
      seed: 90101,
    }),
    reedMaterial(tex, env, {
      grid: REED_GRID,
      cell: REED_CELL,
      radius: (REED_GRID * REED_CELL) / 2,
      salt: 301,
    }),
    REED_GRID * REED_GRID,
  );

  const pads = new InstancedMesh(
    padClusterGeometry(6, 90201),
    padMaterial(tex, env, {
      grid: PAD_GRID,
      cell: PAD_CELL,
      radius: (PAD_GRID * PAD_CELL) / 2,
      salt: 401,
    }),
    PAD_GRID * PAD_GRID,
  );
  pads.renderOrder = 3; // 在水面(renderOrder 2)之后叠加

  const flowers = new InstancedMesh(
    flowerGeometry(),
    flowerMaterial(tex, env, {
      grid: FLOWER_GRID,
      cell: FLOWER_CELL,
      radius: (FLOWER_GRID * FLOWER_CELL) / 2,
      salt: 501,
    }),
    FLOWER_GRID * FLOWER_GRID,
  );
  flowers.renderOrder = 3;

  const weeds = new InstancedMesh(
    clumpGeometry({
      blades: 5,
      segs: 6,
      width: 0.032,
      spread: 0.34,
      bend: 0.48,
      lean: 0.7,
      seed: 90301,
    }),
    weedMaterial(tex, env, {
      grid: WEED_GRID,
      cell: WEED_CELL,
      radius: (WEED_GRID * WEED_CELL) / 2,
      salt: 601,
    }),
    WEED_GRID * WEED_GRID,
  );

  const cobbles = new InstancedMesh(
    cobbleGeometry(90401 + (fields.seed % 1000), "cobble"),
    stoneMaterial(tex, env, {
      grid: COBBLE_GRID,
      cell: COBBLE_CELL,
      radius: (COBBLE_GRID * COBBLE_CELL) / 2,
      salt: 701,
      kind: "cobble",
    }),
    COBBLE_GRID * COBBLE_GRID,
  );

  const pebbles = new InstancedMesh(
    cobbleGeometry(90601 + (fields.seed % 1000), "pebble"),
    stoneMaterial(tex, env, {
      grid: PEBBLE_GRID,
      cell: PEBBLE_CELL,
      radius: (PEBBLE_GRID * PEBBLE_CELL) / 2,
      salt: 711,
      kind: "pebble",
    }),
    PEBBLE_GRID * PEBBLE_GRID,
  );

  const stones = new InstancedMesh(
    cobbleGeometry(90501 + (fields.seed % 1000), "stone"),
    stoneMaterial(tex, env, {
      grid: STONE_GRID,
      cell: STONE_CELL,
      radius: (STONE_GRID * STONE_CELL) / 2,
      salt: 801,
      kind: "stone",
    }),
    STONE_GRID * STONE_GRID,
  );

  for (const mesh of [reeds, pads, flowers, weeds, pebbles, cobbles, stones]) {
    mesh.frustumCulled = false;
    mesh.castShadow = mesh === cobbles || mesh === stones;
    mesh.receiveShadow =
      mesh === reeds || mesh === pebbles || mesh === cobbles || mesh === stones;
    group.add(mesh);
  }

  // 专用 TSL 鱼群系统:8 种淡水鱼 + 每群独立控制算法 + 光柱信标
  try {
    group.add(createFishSchools(tex, env, fields));
  } catch (err) {
    console.warn("[region-engine] fish schools skipped", err);
  }

  return group;
}
