/**
 * 树皮纹理合成(移植 LAAS `BarkSynth.ts`,boot 一次):逐风格可平铺贴图,
 * 由周期性 worley 板块 + 裂缝 + 微观颗粒构成。
 *
 *   texA = albedo.rgb(sqrt 编码)+ 腔隙 AO(a)
 *   texB = 切线法线 xy(0..1)+ 粗糙度 + 高度
 *
 * LAAS 用 compute + StorageTexture;此处改为全屏 quad 渲到 RenderTarget 再
 * 读回 DataTexture(WebGPU / WebGL2 双后端一致,且方便设 Repeat + mipmap)。
 * 风格配方:云杉纵裂、松树板块、榉树平滑、桦树皮孔、樟树浅纵裂、
 * 柳树深纵裂、扭曲深脊(梭梭)、竹节环。
 */

import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoBlending,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  RenderTarget,
  RepeatWrapping,
  Scene,
  Vector2,
} from "three";
import { MeshBasicNodeMaterial, type Renderer } from "three/webgpu";
import { float, mix, select, sqrt, vec2, vec3, uv } from "three/tsl";
import { hash2 } from "../gpu/noise";
import type { NF, NV2, NV3 } from "../gpu/tsl-types";

export const BARK_RES = 1024;

// ---------------------------------------------------------------------------
// 周期性(可平铺)噪声 —— LAAS pnoise / pfbm / pworley 移植
// ---------------------------------------------------------------------------

/** 包裹整数格点上的 value noise → 以 `period` 平铺 */
function pnoise(p: NV2, period: number, seedK: number): NF {
  const cell = p.floor();
  const f = p.fract();
  const u = f.mul(f).mul(f.negate().mul(2).add(3)); // smoothstep fade
  const wrap = (c: NV2): NV2 => c.sub(c.div(period).floor().mul(period));
  const h = (ox: number, oy: number): NF =>
    hash2(wrap(cell.add(vec2(ox, oy))), seedK);
  const a = h(0, 0);
  const b = h(1, 0);
  const c = h(0, 1);
  const d = h(1, 1);
  return a
    .add(b.sub(a).mul(u.x))
    .add(c.sub(a).mul(u.y))
    .add(a.sub(b).sub(c).add(d).mul(u.x).mul(u.y));
}

function pfbm(p: NV2, octaves: number, period: number, seedK: number): NF {
  let sum: NF = float(0);
  let amp = 0.5;
  let scale = 1;
  for (let i = 0; i < octaves; i++) {
    sum = sum.add(pnoise(p.mul(scale), period * scale, seedK + i * 7).mul(amp));
    amp *= 0.5;
    scale *= 2;
  }
  return sum;
}

/** 周期性 worley:返回 F1 与边缘项(F2−F1),均可平铺 */
function pworley(p: NV2, period: Vector2, seedK: number): { f1: NF; edge: NF } {
  const cell = p.floor();
  const f = p.fract();
  const wrapX = (v: NF): NF => v.sub(v.div(period.x).floor().mul(period.x));
  const wrapY = (v: NF): NF => v.sub(v.div(period.y).floor().mul(period.y));
  const dists: NF[] = [];
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = cell.x.add(ox);
      const cy = cell.y.add(oy);
      const hx = hash2(vec2(wrapX(cx), wrapY(cy)), seedK + 31.7);
      const hy = hash2(vec2(wrapX(cx), wrapY(cy)), seedK + 911.3);
      const feat = vec2(float(ox).add(hx), float(oy).add(hy));
      const d = feat.sub(f);
      dists.push(d.dot(d));
    }
  }
  let f1: NF = dists[0] as NF;
  for (let i = 1; i < 9; i++) f1 = f1.min(dists[i] as NF);
  let f2: NF = float(9);
  for (let i = 0; i < 9; i++) {
    const di = dists[i] as NF;
    f2 = f2.min(di.add(select(di.lessThanEqual(f1.add(1e-5)), float(10), float(0))));
  }
  const f1s = f1.sqrt();
  return { f1: f1s, edge: f2.sqrt().sub(f1s) };
}

// ---------------------------------------------------------------------------
// 风格配方(LAAS BARK_TABLE + 本地树种扩充)
// ---------------------------------------------------------------------------

export type BarkRecipe = {
  /** worley 板块频率(x = 绕干周向,y = 沿干纵向) */
  plates: [number, number];
  /** uv 扭曲量(打破笔直裂缝) */
  warp: number;
  /** 裂缝剖面:暗色沟槽带宽 */
  fissureW: number;
  fissureDepth: number;
  /** 逐板块穹顶圆化 */
  plateRound: number;
  micro: number;
  /** 额外纵向长裂(云杉/枯木) */
  vertCrack: number;
  /** 桦树横向皮孔虚线 */
  lenticels: number;
  /** 竹节环频率(每 uv 单位;0 = 无) */
  rings: number;
  deep: [number, number, number];
  high: [number, number, number];
  /** 低频色相斑驳 */
  mottle: number;
  roughBase: number;
  roughVar: number;
  normalK: number;
};

export const BARK_RECIPES = {
  /** 云杉:窄纵裂灰褐脊(LAAS #0) */
  spruce: {
    plates: [16, 4], warp: 0.5, fissureW: 0.34, fissureDepth: 0.85, plateRound: 0.25,
    micro: 0.3, vertCrack: 0.55, lenticels: 0, rings: 0,
    deep: [0.045, 0.032, 0.026], high: [0.21, 0.155, 0.115], mottle: 0.25,
    roughBase: 0.92, roughVar: 0.07, normalK: 2.6,
  },
  /** 松:大块橙褐板片、片状裂缝(LAAS #1) */
  pine: {
    plates: [7, 9], warp: 0.35, fissureW: 0.42, fissureDepth: 1.0, plateRound: 0.55,
    micro: 0.22, vertCrack: 0.1, lenticels: 0, rings: 0,
    deep: [0.05, 0.027, 0.016], high: [0.3, 0.155, 0.075], mottle: 0.35,
    roughBase: 0.88, roughVar: 0.1, normalK: 3.0,
  },
  /** 榉:浅灰平滑、细微斑驳(LAAS #2)—— 灌木茎 */
  beech: {
    plates: [5, 5], warp: 0.6, fissureW: 0.85, fissureDepth: 0.12, plateRound: 0.1,
    micro: 0.12, vertCrack: 0, lenticels: 0, rings: 0,
    deep: [0.16, 0.15, 0.135], high: [0.3, 0.285, 0.25], mottle: 0.5,
    roughBase: 0.78, roughVar: 0.08, normalK: 0.9,
  },
  /** 桦:白纸皮 + 深色横向皮孔(LAAS #3) */
  birch: {
    plates: [4, 3], warp: 0.3, fissureW: 0.9, fissureDepth: 0.06, plateRound: 0.05,
    micro: 0.1, vertCrack: 0, lenticels: 1, rings: 0,
    deep: [0.46, 0.44, 0.42], high: [0.8, 0.79, 0.76], mottle: 0.22,
    roughBase: 0.62, roughVar: 0.18, normalK: 0.7,
  },
  /** 扭曲深脊:梭梭/岩生鬼木(LAAS #4) */
  gnarl: {
    plates: [9, 3], warp: 1.4, fissureW: 0.5, fissureDepth: 0.9, plateRound: 0.3,
    micro: 0.34, vertCrack: 0.3, lenticels: 0, rings: 0,
    deep: [0.05, 0.043, 0.036], high: [0.205, 0.18, 0.15], mottle: 0.3,
    roughBase: 0.93, roughVar: 0.05, normalK: 2.8,
  },
  /** 樟:灰褐浅纵沟(较云杉浅而密) */
  camphor: {
    plates: [12, 5], warp: 0.5, fissureW: 0.4, fissureDepth: 0.6, plateRound: 0.3,
    micro: 0.25, vertCrack: 0.35, lenticels: 0, rings: 0,
    deep: [0.07, 0.055, 0.042], high: [0.24, 0.19, 0.145], mottle: 0.3,
    roughBase: 0.88, roughVar: 0.08, normalK: 2.2,
  },
  /** 柳:深纵裂灰褐皮 */
  willow: {
    plates: [14, 4], warp: 0.55, fissureW: 0.36, fissureDepth: 0.75, plateRound: 0.22,
    micro: 0.28, vertCrack: 0.5, lenticels: 0, rings: 0,
    deep: [0.055, 0.045, 0.036], high: [0.21, 0.17, 0.125], mottle: 0.28,
    roughBase: 0.9, roughVar: 0.07, normalK: 2.4,
  },
  /** 竹秆:光滑黄绿 + 深色竹节环 */
  bamboo: {
    plates: [3, 3], warp: 0.15, fissureW: 0.95, fissureDepth: 0.25, plateRound: 0.15,
    micro: 0.1, vertCrack: 0, lenticels: 0, rings: 7,
    deep: [0.13, 0.2, 0.07], high: [0.34, 0.44, 0.18], mottle: 0.18,
    roughBase: 0.55, roughVar: 0.12, normalK: 1.2,
  },
} as const satisfies Record<string, BarkRecipe>;

export type BarkStyleKey = keyof typeof BARK_RECIPES;

// ---------------------------------------------------------------------------
// 高度场 + 烘焙
// ---------------------------------------------------------------------------

/** 高度场表达式(法线用带偏移重求值) */
function barkHeight(p: BarkRecipe, uvN: NV2, seedK: number): NF {
  const warp = vec2(
    pfbm(uvN.mul(6), 2, 6, seedK + 31).sub(0.5),
    pfbm(uvN.mul(6), 2, 6, seedK + 67).sub(0.5),
  ).mul(p.warp * 0.12);
  const q = uvN.add(warp);
  const pl = pworley(
    q.mul(vec2(p.plates[0], p.plates[1])),
    new Vector2(p.plates[0], p.plates[1]),
    seedK,
  );
  // 板块中央高、边缘落入裂缝
  const fissure = pl.edge.div(p.fissureW).clamp(0, 1);
  let h: NF = fissure.pow(0.65).mul(p.fissureDepth);
  h = h.add(pl.f1.mul(p.plateRound));
  if (p.vertCrack > 0) {
    // 蜿蜒纵向长裂:x 向细谷线
    const cx = q.x
      .mul(Math.max(1, Math.round(p.plates[0] * 0.5)))
      .add(pfbm(q.mul(3), 2, 3, seedK + 5).mul(1.4));
    const crack = cx.fract().sub(0.5).abs().mul(2); // 裂缝中心为 0
    h = h.mul(
      crack.div(0.22).clamp(0, 1).pow(0.5).mul(p.vertCrack).add(1 - p.vertCrack),
    );
  }
  if (p.rings > 0) {
    // 竹节:沿 v 的窄环形凹槽
    const ringT = q.y.mul(p.rings).fract();
    const nearRing = ringT.sub(0.5).abs().mul(2); // 环中心为 1
    const groove = nearRing.smoothstep(0.9, 0.985);
    h = h.mul(float(1).sub(groove.mul(0.85)));
  }
  h = h.add(pfbm(uvN.mul(24), 3, 24, seedK + 91).sub(0.5).mul(p.micro));
  return h;
}

export type BarkTextures = { texA: DataTexture; texB: DataTexture };

async function renderToDataTexture(
  renderer: Renderer,
  mat: MeshBasicNodeMaterial,
): Promise<DataTexture> {
  const scene = new Scene();
  const quad = new Mesh(new PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  scene.add(quad);
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  cam.position.set(0, 0, 5);
  cam.lookAt(0, 0, 0);

  const rt = new RenderTarget(BARK_RES, BARK_RES);
  rt.texture.colorSpace = NoColorSpace;
  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  await renderer.renderAsync(scene, cam);
  renderer.setRenderTarget(prevTarget);

  const raw = (await renderer.readRenderTargetPixelsAsync(
    rt, 0, 0, BARK_RES, BARK_RES,
  )) as Uint8Array;
  const px = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  rt.dispose();
  quad.geometry.dispose();

  const tex = new DataTexture(px, BARK_RES, BARK_RES);
  tex.colorSpace = NoColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 烘焙一种树皮风格的双贴图(每风格一次,毫秒级,seed 确定)。
 * texA = sqrt(albedo) + cavity;texB = 法线 xy + 粗糙度 + 高度。
 */
export async function bakeBarkTextures(
  renderer: Renderer,
  style: BarkStyleKey,
  seedK: number,
): Promise<BarkTextures> {
  const p = BARK_RECIPES[style] as BarkRecipe;
  const uvN = uv();

  const h = barkHeight(p, uvN, seedK);
  const e = 1.6 / BARK_RES;
  const hx0 = barkHeight(p, uvN.add(vec2(-e, 0)), seedK);
  const hx1 = barkHeight(p, uvN.add(vec2(e, 0)), seedK);
  const hy0 = barkHeight(p, uvN.add(vec2(0, -e)), seedK);
  const hy1 = barkHeight(p, uvN.add(vec2(0, e)), seedK);
  const n = vec3(
    hx0.sub(hx1).mul(p.normalK * 0.5),
    hy0.sub(hy1).mul(p.normalK * 0.5),
    float(1),
  ).normalize();

  // 腔隙:裂缝更暗 + 板块顶部微亮
  const cavity = h.clamp(0, 1).mul(0.7).add(0.3);
  const mott = pnoise(uvN.mul(2), 2, seedK + 201).sub(0.5).mul(p.mottle);
  let albedo: NV3 = mix(
    vec3(p.deep[0], p.deep[1], p.deep[2]),
    vec3(p.high[0], p.high[1], p.high[2]),
    h.clamp(0, 1),
  ) as unknown as NV3;
  albedo = albedo.mul(mott.add(1)) as unknown as NV3;
  if (p.lenticels > 0) {
    // 横向深色虚线:拉伸的 worley 斑点
    const lw = pworley(uvN.mul(vec2(5, 24)), new Vector2(5, 24), seedK + 77);
    const dash = float(1).sub(lw.f1.smoothstep(0.2, 0.42));
    albedo = mix(albedo, vec3(0.045, 0.04, 0.038), dash.mul(0.85)) as unknown as NV3;
  }
  const rough = float(p.roughBase).add(h.sub(0.5).mul(p.roughVar * 2));

  const mkMat = (color: NV3, alpha: NF): MeshBasicNodeMaterial => {
    const m = new MeshBasicNodeMaterial();
    m.colorNode = color;
    m.opacityNode = alpha;
    m.transparent = true;
    m.blending = NoBlending; // rgba 原样写入
    m.fog = false;
    return m;
  };

  // sqrt 编码(LAAS sqrtV3:标量 sqrt 对 vec3 逐分量生效)
  const albEnc = sqrt(albedo.clamp(0, 1) as unknown as NF) as unknown as NV3;
  const matA = mkMat(albEnc, cavity);
  const matB = mkMat(
    vec3(n.x.mul(0.5).add(0.5), n.y.mul(0.5).add(0.5), rough.clamp(0.3, 1)),
    h.clamp(0, 1),
  );

  const texA = await renderToDataTexture(renderer, matA);
  const texB = await renderToDataTexture(renderer, matB);
  matA.dispose();
  matB.dispose();
  return { texA, texB };
}
