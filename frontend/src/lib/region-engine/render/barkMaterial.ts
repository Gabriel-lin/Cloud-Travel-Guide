/**
 * 程序化树皮材质(对齐 LAAS `BarkSynth` + `barkTexturedMaterial` 观感)。
 *
 * 不烘焙 2048² 纹理,在片元阶段用 UV 做周期性 worley 风格板条 +
 * 裂缝暗化 + 法线扰动 + 腔隙 AO。各树种 `barkStyle` 映射不同
 * 板条频率/裂缝深度/深浅色(樟≈榉树皮、杉≈云杉纵裂等)。
 */

import { DoubleSide } from "three";
import type { InstancedBufferAttribute } from "three";
import { MeshPhysicalNodeMaterial } from "three/webgpu";
import {
  clamp,
  float,
  instancedBufferAttribute,
  mix,
  normalLocal,
  transformNormalToView,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import { fbm2, hash2, ridged2 } from "../gpu/noise";
import type { NF, NV2, NV3, NV4 } from "../gpu/tsl-types";

/** 树皮风格参数(简化自 LAAS BARK_TABLE) */
export type BarkStyle = {
  /** 周向/纵向板条频率 */
  plates: [number, number];
  warp: number;
  fissureW: number;
  fissureDepth: number;
  plateRound: number;
  vertCrack: number;
  deep: [number, number, number];
  high: [number, number, number];
  mottle: number;
  roughBase: number;
  normalK: number;
};

export const BARK_STYLES = {
  /** 云杉:窄纵裂灰褐树皮 */
  spruce: {
    plates: [16, 4], warp: 0.5, fissureW: 0.34, fissureDepth: 0.85, plateRound: 0.25,
    vertCrack: 0.55, deep: [0.045, 0.032, 0.026], high: [0.21, 0.155, 0.115],
    mottle: 0.25, roughBase: 0.92, normalK: 2.6,
  },
  /** 榉/阔叶:浅灰平滑,细微斑驳 */
  beech: {
    plates: [5, 5], warp: 0.6, fissureW: 0.85, fissureDepth: 0.12, plateRound: 0.1,
    vertCrack: 0, deep: [0.16, 0.15, 0.135], high: [0.3, 0.285, 0.25],
    mottle: 0.5, roughBase: 0.78, normalK: 0.9,
  },
  /** 竹秆:纵向节间纹理 */
  bamboo: {
    plates: [3, 18], warp: 0.15, fissureW: 0.92, fissureDepth: 0.08, plateRound: 0.05,
    vertCrack: 0, deep: [0.22, 0.28, 0.14], high: [0.42, 0.5, 0.26],
    mottle: 0.15, roughBase: 0.7, normalK: 0.5,
  },
  /** 荒漠灌木/梭梭:扭曲深脊 */
  gnarl: {
    plates: [9, 3], warp: 1.4, fissureW: 0.5, fissureDepth: 0.9, plateRound: 0.3,
    vertCrack: 0.3, deep: [0.05, 0.043, 0.036], high: [0.205, 0.18, 0.15],
    mottle: 0.3, roughBase: 0.93, normalK: 2.8,
  },
} as const satisfies Record<string, BarkStyle>;

export type BarkStyleKey = keyof typeof BARK_STYLES;

/** 片元高度场(用于颜色 + 法线) */
function barkHeight(p: BarkStyle, uvN: NV2, seed: number): NF {
  const warp = vec2(
    fbm2(uvN.mul(6), 2, 2, 0.5).sub(0.5),
    fbm2(uvN.mul(6).add(vec2(17.3, 31.7)), 2, 2, 0.5).sub(0.5),
  ).mul(p.warp * 0.12);
  const q = uvN.add(warp);
  const pl = ridged2(q.mul(vec2(p.plates[0], p.plates[1])));
  const edge = float(1).sub(pl).div(p.fissureW).clamp(0, 1);
  let h: NF = edge.pow(0.65).mul(p.fissureDepth);
  h = h.add(pl.mul(p.plateRound));
  if (p.vertCrack > 0) {
    const cx = q.x
      .mul(Math.max(1, Math.round(p.plates[0] * 0.5)))
      .add(fbm2(q.mul(3), 2, 2, 0.5).mul(1.4));
    const crack = cx.fract().sub(0.5).abs().mul(2);
    const crackK = float(1).sub(crack.div(0.22).clamp(0, 1).pow(0.5).mul(p.vertCrack));
    h = h.mul(crackK);
  }
  h = h.add(fbm2(uvN.mul(24), 3, 2, 0.5).sub(0.5).mul(p.mottle * 0.08));
  return h;
}

export function buildBarkMaterial(
  style: BarkStyle,
  instHue: InstancedBufferAttribute,
  seed = 0,
): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.specularIntensity = 0.45;
  mat.metalness = 0;
  mat.side = DoubleSide;

  const uvN = uv();
  const h = barkHeight(style, uvN, seed).toVar();

  const deep = vec3(style.deep[0], style.deep[1], style.deep[2]);
  const high = vec3(style.high[0], style.high[1], style.high[2]);
  const mott = hash2(uvN.mul(80), seed + 201).sub(0.5).mul(style.mottle);
  let albedo: NV3 = mix(deep, high, h.clamp(0, 1)) as unknown as NV3;
  albedo = albedo.mul(mott.add(1)) as unknown as NV3;

  // 实例色相抖动(干部)
  const hue = instancedBufferAttribute(instHue) as unknown as NF;
  const shift = hue.sub(0.5).mul(0.18);
  albedo = vec3(
    albedo.x.mul(shift.mul(0.8).add(1)),
    albedo.y.mul(shift.mul(-0.35).add(1)),
    albedo.z.mul(shift.mul(-0.6).add(1)),
  ) as unknown as NV3;

  // 裂缝腔隙 AO(间接光暗化)
  const cavity = h.clamp(0, 1).mul(0.7).add(0.3);
  mat.colorNode = albedo.mul(cavity.mul(0.45).add(0.55));

  // 法线扰动(有限差分)
  const e = float(0.004);
  const hx0 = barkHeight(style, vec2(uvN.x.sub(e), uvN.y), seed);
  const hx1 = barkHeight(style, vec2(uvN.x.add(e), uvN.y), seed);
  const hy0 = barkHeight(style, vec2(uvN.x, uvN.y.sub(e)), seed);
  const hy1 = barkHeight(style, vec2(uvN.x, uvN.y.add(e)), seed);
  const bump = vec3(
    hx0.sub(hx1).mul(style.normalK * 0.5),
    hy0.sub(hy1).mul(style.normalK * 0.5),
    float(1),
  ).normalize();
  const n = normalLocal;
  mat.normalNode = transformNormalToView(
    vec3(n.x.add(bump.x), n.y.add(bump.y), n.z.add(bump.z)).normalize(),
  );

  mat.roughnessNode = float(style.roughBase).add(h.sub(0.5).mul(0.08));

  return mat;
}
