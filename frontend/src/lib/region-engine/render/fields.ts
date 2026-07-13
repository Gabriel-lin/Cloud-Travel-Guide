/**
 * WorldFields → GPU 纹理 + TSL 采样 kernel。
 *
 * - heightTex / waterTex:r32float,`textureLoad` 手工双线性(顶点/片元/compute 通用,
 *   规避 float32 不可过滤限制,与 LAAS 的 buffer 采样等价)
 * - biomeTex(id/雪/植被密度/湿度)、maskTex(森林/农田/城区/沙地)、
 *   fieldsTex(流向/河床剖面/湖面):RGBA8 线性过滤
 */

import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  LinearFilter,
  NearestFilter,
  RedFormat,
  RGBAFormat,
  UnsignedByteType,
} from "three";
import { clamp, float, ivec2, textureLoad, vec2 } from "three/tsl";
import { WATER_NONE } from "../gpu/pipeline";
import type { NF, NV2 } from "../gpu/tsl-types";
import type { WorldFields } from "../types";

export type WorldTextures = {
  heightTex: DataTexture;
  waterTex: DataTexture;
  biomeTex: DataTexture;
  maskTex: DataTexture;
  fieldsTex: DataTexture;
  res: number;
  size: number;
};

function floatTex(data: Float32Array, res: number): DataTexture {
  const tex = new DataTexture(data, res, res, RedFormat, FloatType);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function rgbaTex(
  res: number,
  fill: (i: number, px: Uint8Array) => void,
): DataTexture {
  const data = new Uint8Array(res * res * 4);
  const px = new Uint8Array(4);
  for (let i = 0; i < res * res; i++) {
    fill(i, px);
    data.set(px, i * 4);
  }
  const tex = new DataTexture(data, res, res, RGBAFormat, UnsignedByteType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const b = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

export function buildWorldTextures(world: WorldFields): WorldTextures {
  const { res, size, masks } = world;

  const biomeTex = rgbaTex(res, (i, px) => {
    px[0] = b((world.biome[i] as number) / 8);
    px[1] = b(world.snow[i] as number);
    px[2] = b(world.vegDensity[i] as number);
    px[3] = b(world.moisture[i] as number);
  });
  const maskTex = rgbaTex(res, (i, px) => {
    px[0] = b(masks.forest[i] as number);
    px[1] = b(masks.farmland[i] as number);
    px[2] = b(masks.urban[i] as number);
    px[3] = b(masks.sand[i] as number);
  });
  const fieldsTex = rgbaTex(res, (i, px) => {
    px[0] = b((masks.flowX[i] as number) * 0.5 + 0.5);
    px[1] = b((masks.flowZ[i] as number) * 0.5 + 0.5);
    px[2] = b(masks.riverProfile[i] as number);
    px[3] = b(masks.water[i] as number);
  });

  return {
    heightTex: floatTex(world.heights, res),
    waterTex: floatTex(world.waterY, res),
    biomeTex,
    maskTex,
    fieldsTex,
    res,
    size,
  };
}

/** r32float 纹理手工双线性采样(世界 xz → 高度) */
export function sampleFloatBilinear(
  tex: DataTexture,
  wpos: NV2,
  res: number,
  size: number,
): NF {
  const p = wpos
    .div(size)
    .add(0.5)
    .mul(res)
    .sub(0.5)
    .toVar();
  const p0 = p.floor().toVar();
  const f = p.sub(p0).toVar();
  const ci = (v: NF) => clamp(v, 0, res - 1).toInt();
  const x0 = ci(p0.x);
  const y0 = ci(p0.y);
  const x1 = ci(p0.x.add(1));
  const y1 = ci(p0.y.add(1));
  const h00: NF = textureLoad(tex, ivec2(x0, y0)).x;
  const h10: NF = textureLoad(tex, ivec2(x1, y0)).x;
  const h01: NF = textureLoad(tex, ivec2(x0, y1)).x;
  const h11: NF = textureLoad(tex, ivec2(x1, y1)).x;
  const top = h00.mul(f.x.oneMinus()).add(h10.mul(f.x));
  const bot = h01.mul(f.x.oneMinus()).add(h11.mul(f.x));
  return top.mul(f.y.oneMinus()).add(bot.mul(f.y));
}

/** r32float 纹理最近邻采样(阴影投射等低成本路径) */
export function sampleFloatNearest(
  tex: DataTexture,
  wpos: NV2,
  res: number,
  size: number,
): NF {
  const p = wpos.div(size).add(0.5).mul(res).toVar();
  const ci = (v: NF) => clamp(v, 0, res - 1).toInt();
  return textureLoad(tex, ivec2(ci(p.x), ci(p.y))).x;
}

/** 世界 xz → RGBA8 纹理 uv */
export function worldUv(wpos: NV2, size: number): NV2 {
  return vec2(wpos.x.div(size).add(0.5), wpos.y.div(size).add(0.5));
}

/** CPU 双线性采样(贴地探针/散布) */
export function sampleCpu(
  data: Float32Array,
  x: number,
  z: number,
  res: number,
  size: number,
): number {
  const px = Math.min(Math.max((x / size + 0.5) * res - 0.5, 0), res - 1.001);
  const pz = Math.min(Math.max((z / size + 0.5) * res - 0.5, 0), res - 1.001);
  const x0 = Math.floor(px);
  const z0 = Math.floor(pz);
  const fx = px - x0;
  const fz = pz - z0;
  const x1 = Math.min(x0 + 1, res - 1);
  const z1 = Math.min(z0 + 1, res - 1);
  const h00 = data[z0 * res + x0] as number;
  const h10 = data[z0 * res + x1] as number;
  const h01 = data[z1 * res + x0] as number;
  const h11 = data[z1 * res + x1] as number;
  return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
}

/** CPU 水面查询:双线性会被 WATER_NONE 哨兵污染,改用最近邻 + 有效性检查 */
export function sampleWaterCpu(
  waterY: Float32Array,
  x: number,
  z: number,
  res: number,
  size: number,
): number {
  const px = Math.min(Math.max(Math.round((x / size + 0.5) * res - 0.5), 0), res - 1);
  const pz = Math.min(Math.max(Math.round((z / size + 0.5) * res - 0.5), 0), res - 1);
  const v = waterY[pz * res + px] as number;
  return v <= WATER_NONE * 0.5 ? -Infinity : v;
}
