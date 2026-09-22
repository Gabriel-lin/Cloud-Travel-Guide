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
import { clamp, float, ivec2, max, textureLoad, vec2 } from "three/tsl";
import { WATER_NONE } from "../gpu/pipeline";
import type { NF, NV2 } from "../gpu/tsl-types";
import type { WorldFields } from "../types";

export type WorldTextures = {
  heightTex: DataTexture;
  waterTex: DataTexture;
  /** 水位向岸外扩 ~4 texel:水面网格藏边、岸线湿痕/青苔带共用 */
  waterExtTex: DataTexture;
  biomeTex: DataTexture;
  maskTex: DataTexture;
  fieldsTex: DataTexture;
  res: number;
  size: number;
  seed: number;
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

/**
 * 水位向岸外扩(可分离,两轮覆盖 Chebyshev 方窗):只填充无效 texel
 * (取邻域最大有效水位),有效 texel 保留自身精确水位 —— 斜坡河流不会被
 * 上游水位抬高。岸上 texel 得到邻近水位 → 水面网格在岸下延伸(tuck-under),
 * 岸线 = 水面平面与地形的逐像素相交,不再依赖网格分辨率。
 */
export function dilateWaterY(
  waterY: Float32Array,
  res: number,
  radius: number,
): Float32Array {
  const valid = (v: number) => v > WATER_NONE * 0.5;
  const tmp = new Float32Array(waterY.length);
  const out = new Float32Array(waterY.length);
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const i = y * res + x;
      const self = waterY[i] as number;
      if (valid(self)) {
        tmp[i] = self;
        continue;
      }
      let m = -Infinity;
      for (let o = -radius; o <= radius; o++) {
        const cx = Math.min(Math.max(x + o, 0), res - 1);
        const v = waterY[y * res + cx] as number;
        if (valid(v) && v > m) m = v;
      }
      tmp[i] = m === -Infinity ? WATER_NONE : m;
    }
  }
  for (let x = 0; x < res; x++) {
    for (let y = 0; y < res; y++) {
      const i = y * res + x;
      const self = tmp[i] as number;
      if (valid(self)) {
        out[i] = self;
        continue;
      }
      let m = -Infinity;
      for (let o = -radius; o <= radius; o++) {
        const cy = Math.min(Math.max(y + o, 0), res - 1);
        const v = tmp[cy * res + x] as number;
        if (valid(v) && v > m) m = v;
      }
      out[i] = m === -Infinity ? WATER_NONE : m;
    }
  }
  return out;
}

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
    waterExtTex: floatTex(dilateWaterY(world.waterY, res, 4), res),
    biomeTex,
    maskTex,
    fieldsTex,
    res,
    size,
    seed: world.seed,
  };
}

/**
 * 水位纹理有效性双线性采样(顶点/片元通用):
 * 无效 texel(WATER_NONE 哨兵)用邻域最大有效值补齐,返回 {水位, 是否有水}。
 */
export function sampleWaterLevel(
  tex: DataTexture,
  wpos: NV2,
  res: number,
  size: number,
): { y: NF; valid: NF } {
  const p = wpos.div(size).add(0.5).mul(res).sub(0.5).toVar();
  const p0 = p.floor().toVar();
  const f = p.sub(p0).toVar();
  const ci = (v: NF) => clamp(v, 0, res - 1).toInt();
  const x0 = ci(p0.x);
  const y0 = ci(p0.y);
  const x1 = ci(p0.x.add(1));
  const y1 = ci(p0.y.add(1));
  const v00 = textureLoad(tex, ivec2(x0, y0)).x.toVar();
  const v10 = textureLoad(tex, ivec2(x1, y0)).x.toVar();
  const v01 = textureLoad(tex, ivec2(x0, y1)).x.toVar();
  const v11 = textureLoad(tex, ivec2(x1, y1)).x.toVar();
  const big = max(max(v00, v10), max(v01, v11)).toVar();
  const thresh = WATER_NONE * 0.5;
  const fix = (v: NF) => v.greaterThan(thresh).select(v, big);
  const a = fix(v00);
  const bv = fix(v10);
  const c = fix(v01);
  const d = fix(v11);
  const top = a.mul(f.x.oneMinus()).add(bv.mul(f.x));
  const bot = c.mul(f.x.oneMinus()).add(d.mul(f.x));
  return {
    y: top.mul(f.y.oneMinus()).add(bot.mul(f.y)),
    valid: big.greaterThan(thresh).select(float(1), float(0)),
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

/** CPU 水面查询:最近邻 + 3×3 回退,窄溪不会因为踩在相邻干 texel 上丢水位 */
export function sampleWaterCpu(
  waterY: Float32Array,
  x: number,
  z: number,
  res: number,
  size: number,
): number {
  const px = Math.min(Math.max(Math.round((x / size + 0.5) * res - 0.5), 0), res - 1);
  const pz = Math.min(Math.max(Math.round((z / size + 0.5) * res - 0.5), 0), res - 1);
  const thresh = WATER_NONE * 0.5;
  const at = (ix: number, iz: number): number => {
    if (ix < 0 || iz < 0 || ix >= res || iz >= res) return Number.NEGATIVE_INFINITY;
    const v = waterY[iz * res + ix] as number;
    return v <= thresh ? Number.NEGATIVE_INFINITY : v;
  };
  const c = at(px, pz);
  if (Number.isFinite(c)) return c;
  let best = Number.NEGATIVE_INFINITY;
  for (let oz = -1; oz <= 1; oz++) {
    for (let ox = -1; ox <= 1; ox++) {
      const v = at(px + ox, pz + oz);
      if (v > best) best = v;
    }
  }
  return best;
}
