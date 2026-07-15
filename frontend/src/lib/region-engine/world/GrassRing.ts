/**
 * GrassRing — 相机跟随的近景草毯(移植 LAAS `GroundRing`/`GroundCover`)。
 *
 * 无上传流式:每个实例槽固定映射到与它同余(mod GRID)且离相机最近的世界格
 * (经典 clipmap wrap),全部逐实例参数(存活/高矮/朝向/干湿/相位)由
 * hash(worldCell) 在顶点阶段重建 —— 槽的内容只在其世界格变化时变化,
 * 零逐帧 CPU、零 attribute 上传。LAAS 用 compute 剔除 + indirect draw;
 * 此处为 WebGPU/WebGL2 双后端把"剔除"降级为顶点缩放到零(退化三角形)。
 *
 * 双层 LOD:
 *   g0 近景(≤24 m):3 叶簇 × 3 段锥形叶片,弧面法线(±38° 边缘倾斜,
 *      像半圆柱那样受光 —— Ghost of Tsushima 的招),逐叶弯折;
 *   g1 中景(20~64 m):三张交叉宽叶卡(超级草丛),覆盖换宽度;
 *   之外交给地形 splat 的草色。
 *
 * 密度按世界字段门控:水面/雪/城区/沙地砍掉,林下变暗变冷,农田让位给
 * 作物池,陡坡衰减;叶尖背光透光 + 基部假自阴影 + 风场悬臂弯折与树同源。
 */

import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
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
import { fbm2, hash2 } from "../gpu/noise";
import type { NF, NV2, NV3, NV4 } from "../gpu/tsl-types";
import type { EnvState } from "../render/env";
import { sampleFloatBilinear, type WorldTextures } from "../render/fields";

// g0 近景:细格 + 真叶片簇;g1 中景:粗格 + 宽草丛卡
const G0_R = 24;
const G0_CELL = 0.3;
const G0_GRID = 160; // ±24 m 环,25 600 槽 × 5 叶簇 → ~128k 叶片
const G1_R = 64;
const G1_CELL = 0.75;
const G1_GRID = 172; // ±64.5 m 环,29 584 槽
/** g0→g1 交接带宽(米) */
const BAND = 7;

// ---------------------------------------------------------------------------
// 几何(移植 GroundCover.grassBladeGeometry / GroundRing.bladeClump / tuft)
// ---------------------------------------------------------------------------

/** 单叶片:锥形 N 段条带,内建弯折;弧面法线让平片像半圆柱受光 */
function grassBladeGeometry(SEG = 3): BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uvA: number[] = [];
  const idx: number[] = [];
  const W = 0.02;
  // 边缘顶点绕叶轴倾斜 ±38°,插值逐像素补出弧面
  const SN = 0.616;
  const CS = 0.788;
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    const w = W * (1 - t * 0.85);
    const bendZ = t * t * 0.24;
    const y = t * (1 - t * t * 0.06);
    if (i < SEG) {
      pos.push(-w, y, bendZ, w, y, bendZ);
      nrm.push(-SN, 0.25, -CS, SN, 0.25, -CS);
      uvA.push(0, t, 1, t);
    } else {
      pos.push(0, y, bendZ);
      nrm.push(0, 0.25, -1);
      uvA.push(0.5, 1);
    }
  }
  for (let i = 0; i < SEG; i++) {
    const a = i * 2;
    if (i < SEG - 1) idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    else idx.push(a, a + 1, a + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uvA), 2));
  g.setIndex(idx);
  return g;
}

/**
 * 一实例 N 叶簇 —— 近景茂密感的关键:逐像素叶片交叠才读作"厚草",
 * 单根细叶无论密度多高在步行距离都读作稀疏(LAAS 注)。
 */
function bladeClump(blades: number, segs: number): BufferGeometry {
  let s = 1234567 + blades * 77 + segs * 13;
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const pos: number[] = [];
  const nrm: number[] = [];
  const uvA: number[] = [];
  const idx: number[] = [];
  for (let b = 0; b < blades; b++) {
    const base = grassBladeGeometry(segs);
    const yaw = rnd() * Math.PI * 2;
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const ox = (rnd() - 0.5) * 0.26;
    const oz = (rnd() - 0.5) * 0.26;
    const hk = 0.62 + rnd() * 0.65;
    const lean = (rnd() - 0.5) * 0.42;
    const p = base.attributes.position as BufferAttribute;
    const nA = base.attributes.normal as BufferAttribute;
    const uA = base.attributes.uv as BufferAttribute;
    const v0 = pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) * 1.25;
      const y = p.getY(i) * hk;
      const z = p.getZ(i);
      pos.push(x * c + z * sn + ox + lean * y * c, y, z * c - x * sn + oz + lean * y * sn);
      nrm.push(nA.getX(i) * c + nA.getZ(i) * sn, nA.getY(i), nA.getZ(i) * c - nA.getX(i) * sn);
      uvA.push(uA.getX(i), uA.getY(i));
    }
    const ix = base.index as BufferAttribute;
    for (let i = 0; i < ix.count; i++) idx.push(v0 + ix.getX(i));
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uvA), 2));
  g.setIndex(idx);
  return g;
}

/** 三张交叉宽叶卡 —— 中景草丛(≈一小簇合成一卡) */
function tuftGeometry(W = 0.055): BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uvA: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k < 3; k++) {
    const a = k * 1.92 + 0.4;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const base = pos.length / 3;
    for (const [u, v] of [
      [-W, 0],
      [W, 0],
      [W * 0.55, 1],
      [-W * 0.55, 1],
    ] as const) {
      pos.push(u * c, v, u * s);
      const sgn = u < 0 ? -1 : 1;
      nrm.push(
        -s * 0.97 * 0.788 + sgn * 0.616 * c,
        0.25,
        c * 0.97 * 0.788 + sgn * 0.616 * s,
      );
      uvA.push(u < 0 ? 0 : 1, v);
    }
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uvA), 2));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------------------
// 材质(顶点阶段:环 wrap → 字段门控 → 变换 + 风;片元:着色)
// ---------------------------------------------------------------------------

type LayerOpts = {
  grid: number;
  cell: number;
  radius: number;
  /** [fadeInDist, fadeOutDist];null = 无该侧交接 */
  fades: [number | null, number | null];
  salt: number;
  /** 中景草丛:更宽更高,法线全走地形 */
  tuft: boolean;
};

function grassLayerMaterial(
  tex: WorldTextures,
  env: EnvState,
  o: LayerOpts,
): MeshStandardNodeMaterial {
  const { res, size } = tex;
  const mat = new MeshStandardNodeMaterial();
  mat.metalness = 0;
  mat.roughness = 0.88;
  mat.side = DoubleSide;

  // ---- 环 wrap:槽 → 离相机最近的同余世界格 ----
  const i = float(instanceIndex);
  const sx = i.mod(o.grid);
  const sy = i.div(o.grid).floor();
  const camC = vec2(cameraPosition.x, cameraPosition.z).div(o.cell);
  const wc = vec2(
    camC.x.sub(sx).div(o.grid).round().mul(o.grid).add(sx),
    camC.y.sub(sy).div(o.grid).round().mul(o.grid).add(sy),
  ).toVar();
  const jit = vec2(hash2(wc, o.salt + 1), hash2(wc, o.salt + 2));
  const wpos = wc.add(jit).mul(o.cell).toVar();
  const dist = wpos.sub(vec2(cameraPosition.x, cameraPosition.z)).length().toVar();

  // ---- 地面 + 字段 ----
  const h = sampleFloatBilinear(tex.heightTex, wpos, res, size).toVar();
  const ci = (v: NF) => clamp(v, 0, res - 1).toInt();
  const px = wpos.div(size).add(0.5).mul(res);
  const ix = ci(px.x);
  const iy = ci(px.y);
  const bio = textureLoad(tex.biomeTex, ivec2(ix, iy)).toVar(); // r=id g=snow b=veg a=moist
  const msk = textureLoad(tex.maskTex, ivec2(ix, iy)).toVar(); // r=forest g=farm b=urban a=sand
  const fld = textureLoad(tex.fieldsTex, ivec2(ix, iy)).toVar(); // b=riverProfile a=lake
  const waterY = textureLoad(tex.waterTex, ivec2(ix, iy)).x;
  // 地形法线(有限差分,texel 步长)
  const e = size / res;
  const hX = sampleFloatBilinear(tex.heightTex, wpos.add(vec2(e, 0)), res, size);
  const hZ = sampleFloatBilinear(tex.heightTex, wpos.add(vec2(0, e)), res, size);
  const tNrm = vec3(h.sub(hX), float(e), h.sub(hZ)).normalize().toVar();
  const slope = tNrm.y.oneMinus().mul(2.4).clamp(0, 1);

  // ---- 密度门控(0..1)与存活判定 ----
  const above = h.sub(waterY); // waterY=WATER_NONE(-1e4) 时恒为正
  const bank = smoothstep(0.05, 0.45, above).mul(
    fld.z.smoothstep(0.2, 0.9).mul(0.8).oneMinus(), // 河床冲刷带变稀
  );
  const canopy = smoothstep(0.25, 0.8, msk.x);
  // 多尺度随机斑块:~13 m 团簇 × ~45 m 宏观疏密漂移。真实草甸从不均匀 ——
  // 密簇、秃斑、缓坡草浪交替;但斑块只做 ±30% 调制,不再把草甸掏空
  // (上一版斑块直接乘密度,meadow 存活率只剩 ~20%,读作深色斑点)
  const patchFine = fbm2(wpos.div(13), 2).mul(0.5).add(0.5);
  const patchMacro = fbm2(wpos.div(45).add(vec2(31.7, 11.3)), 2).mul(0.5).add(0.5);
  const patchRaw = patchFine.mul(0.55).add(patchMacro.mul(0.45));
  // 湿度抬高斑块下限(湿润草甸整体连片,干旱区草只在斑块核心存活)
  const patchFloor = bio.w.mul(0.35).add(0.5);
  const patchK = smoothstep(0.25, 0.75, patchRaw)
    .mul(float(1).sub(patchFloor))
    .add(patchFloor)
    .toVar();
  // 主地形范围裁剪:草不越界飘到裙带/雾底上
  const halfR = size / 2;
  const edgeD = wpos.x.abs().max(wpos.y.abs());
  const inBounds = float(1).sub(smoothstep(halfR - 16, halfR - 4, edgeD));
  // 硬门控(雪/城区/沙地/农田/陡坡)与软密度分开:近场保底不得穿透硬门控
  const hardGate = bio.y
    .mul(0.97)
    .oneMinus() // 雪
    .mul(smoothstep(0.3, 0.65, msk.z).oneMinus()) // 城区
    .mul(smoothstep(0.3, 0.65, msk.w).oneMinus()) // 沙地
    .mul(smoothstep(0.3, 0.7, msk.y).mul(0.85).oneMinus()) // 农田让位作物池
    .mul(smoothstep(0.5, 0.9, slope).oneMinus()) // 陡坡
    .mul(bank)
    .mul(inBounds)
    .toVar();
  // LAAS meadow 密度权重 1.5(近乎满铺):bio.z 已含 OSM 草地面积权重,
  // meadow 基础 veg≈0.14 → dens≈0.8,OSM 牧场 → 饱和,荒漠 veg≈0.03 → 零星
  let dens = bio.z
    .mul(2.2)
    .add(0.5)
    .mul(patchK)
    .mul(canopy.mul(0.35).oneMinus()) // 林下变稀
    .mul(hardGate);
  // 近场 scruff 保底(LAAS Pillar A):~12 m 内不允许全秃,
  // 贫瘠土壤也要有稀疏干叶 —— 硬门控(水/雪/城区)仍然生效
  const scruff = float(0.4)
    .mul(float(1).sub(smoothstep(8, 14, dist)))
    .mul(hardGate);
  dens = dens.max(scruff);
  const alive = hash2(wc, o.salt).lessThan(dens).select(float(1), float(0));

  // ---- 距离带交接(LAAS bandFade 的缩放版) + 环边缘 ----
  let bandK: NF = float(1).sub(smoothstep(o.radius - BAND, o.radius, dist));
  if (o.fades[0] !== null) {
    bandK = bandK.mul(smoothstep(o.fades[0] - BAND, o.fades[0], dist));
  }
  if (o.fades[1] !== null) {
    bandK = bandK.mul(float(1).sub(smoothstep(o.fades[1] - BAND, o.fades[1], dist)));
  }
  const sK = alive.mul(bandK).toVar();

  // ---- 逐实例形态 ----
  const h1 = hash2(wc, o.salt + 3);
  const h2v = hash2(wc, o.salt + 4);
  // 密斑块草更高(郁闭竞光),秃斑边缘草矮而稀 —— 高度跟随密度斑块
  const lushK = patchK.mul(0.5).add(bio.z.mul(0.5));
  const bladeH = h1
    .pow(1.3)
    .mul(o.tuft ? 0.5 : 0.34)
    .add(o.tuft ? 0.38 : 0.22)
    .mul(lushK.mul(0.7).add(0.6))
    .mul(sK);
  const widen = o.tuft ? float(3.0) : float(1.35);
  const yawA = h2v.mul(6.2831853);
  const c = cos(yawA);
  const s = sin(yawA);
  const tilt = vec2(hash2(wc, o.salt + 5).sub(0.5), hash2(wc, o.salt + 6).sub(0.5)).mul(0.5);

  const ls = positionLocal.mul(vec3(widen.mul(sK), bladeH, sK)).toVar();
  const rx = ls.x.mul(c).add(ls.z.mul(s));
  const rz = ls.z.mul(c).sub(ls.x.mul(s));

  // ---- 风:悬臂弯折(tip²)骑在与树同源的阵风场上 + 细颤 ----
  const tN = positionLocal.y; // 0..1 叶内高度
  const gustP = wpos.sub(env.windDir.mul(env.time.mul(10.5))).div(85);
  const gust = hash2(gustP.floor(), 11)
    .mul(0.5)
    .add(
      sin(gustP.x.add(gustP.y).mul(6.28).add(env.time.mul(0.7))).mul(0.25).add(0.25),
    );
  const amp = env.windStrength.mul(gust.mul(0.9).add(0.3));
  const bend = amp.mul(tN.mul(tN)).mul(bladeH.mul(0.5));
  const flut = o.tuft
    ? float(0)
    : sin(env.time.mul(5.2).add(h1.mul(6.2832)).add(wpos.x.add(wpos.y).mul(0.9)))
        .mul(tN)
        .mul(amp)
        .mul(0.045);
  const dx = env.windDir.x.mul(bend).sub(env.windDir.y.mul(flut));
  const dz = env.windDir.y.mul(bend).add(env.windDir.x.mul(flut));
  const dy = bend.mul(tN).mul(-0.4);

  // 随机倾倒(剪切)—— 全部笔直向上读作"种的玉米"(LAAS 注)
  mat.positionNode = vec3(
    rx.add(tilt.x.mul(ls.y)).add(dx).add(wpos.x),
    ls.y.add(h).add(dy),
    rz.add(tilt.y.mul(ls.y)).add(dz).add(wpos.y),
  );

  // ---- 法线:yaw 旋转弧面法线 → 随距离拉向地形法线 ----
  // 草坡要像它长着的山坡那样受光(GoT 招;逐叶卡片法线会让草地闪灰)
  const nR = vec3(
    normalLocal.x.mul(c).add(normalLocal.z.mul(s)),
    normalLocal.y,
    normalLocal.z.mul(c).sub(normalLocal.x.mul(s)),
  );
  const upK = o.tuft ? float(0.95) : smoothstep(6, 50, dist).mul(0.35).add(0.5);
  mat.normalNode = transformNormalToView(
    mix(nR.normalize(), tNrm, upK).normalize() as unknown as NV3,
  );

  // ---- 颜色:对齐地形 splat 草色调色板(LAAS "color matched to the
  // terrain grass palette")—— 叶尖 = 地面草色,草毯与地面融为一体;
  // 上一版沿用 LAAS 原值(为它更暗的地表设计)导致叶片读作深色斑点
  const t = uv().y as unknown as NF;
  // 地形 splat: grass = vec3(0.24,0.36,0.13) × macro(0.75..1.25)
  const fresh = mix(
    vec3(0.105, 0.17, 0.055),
    vec3(0.24, 0.36, 0.13),
    t.mul(t),
  );
  const dry = mix(vec3(0.14, 0.12, 0.05), vec3(0.31, 0.27, 0.11), t);
  // 块级(~2.4 m)干湿/色相 —— 草甸读作"色块漂移"而不是噪声;
  // 稀疏斑块(patchK 低)+ 干燥(bio.w 低)微偏枯黄,与密度分布呼应
  const patchX = hash2(wc.mul(0.125).floor(), o.salt + 8);
  const patchY = hash2(wc.mul(0.125).floor(), o.salt + 9);
  const sparseDry = float(1).sub(patchK).mul(0.4).mul(float(1).sub(bio.w));
  const dryK = smoothstep(0.68, 0.95, patchX)
    .mul(0.6)
    .add(sparseDry)
    .clamp(0, 1)
    .mul(canopy.mul(0.85).oneMinus());
  let albedo = mix(fresh, dry, dryK) as unknown as NV3;
  albedo = albedo.mul(patchY.sub(0.5).mul(0.22).add(1)) as unknown as NV3;
  // 林下:深冷绿(干草斑是全日照现象)
  albedo = mix(albedo, vec3(0.06, 0.11, 0.04), canopy.mul(0.5)) as unknown as NV3;
  // 湿地微暗(与地形 splat 的浸润一致)
  albedo = albedo.mul(bio.w.mul(0.2).oneMinus()) as unknown as NV3;
  mat.colorNode = albedo;

  // 叶尖背光透光:朝太阳看时叶片透亮
  const viewDir = positionWorld.sub(cameraPosition).normalize();
  const toward = clamp(viewDir.dot(env.sunDir.negate()), 0, 1);
  const glow = toward.pow(5).mul(env.sunIntensity()).mul(0.09).mul(t);
  const sunCol = mix(vec3(0.9, 1.05, 0.55), vec3(0.15, 0.2, 0.35), env.nightK);
  mat.emissiveNode = (albedo as unknown as NV3).mul(sunCol).mul(glow);

  // 基部假自阴影(减弱:密草毯基部本就被叶片交叠遮挡,再压暗会发黑)
  mat.aoNode = smoothstep(0.0, 0.55, t).mul(0.35).add(0.65);

  return mat;
}

/** 建两层草环(g0 近景叶簇 + g1 中景草丛),加进场景即可,无需逐帧更新 */
export function createGrassRing(tex: WorldTextures, env: EnvState): Group {
  const group = new Group();

  const g0 = new InstancedMesh(
    bladeClump(5, 3),
    grassLayerMaterial(tex, env, {
      grid: G0_GRID,
      cell: G0_CELL,
      radius: G0_R,
      fades: [null, null],
      salt: 101,
      tuft: false,
    }),
    G0_GRID * G0_GRID,
  );

  const g1 = new InstancedMesh(
    tuftGeometry(),
    grassLayerMaterial(tex, env, {
      grid: G1_GRID,
      cell: G1_CELL,
      radius: G1_R,
      fades: [G0_R, null],
      salt: 202,
      tuft: true,
    }),
    G1_GRID * G1_GRID,
  );

  for (const mesh of [g0, g1]) {
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
