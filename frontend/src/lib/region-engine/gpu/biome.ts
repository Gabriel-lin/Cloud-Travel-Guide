/**
 * 生物群系 + 雪线分类 kernel。
 *
 * 温度(海拔直减率 6.5 ℃/km + 噪声抖动)× 湿度 × 坡度 × OSM 土地利用
 * → biomeId / 雪覆盖 / 植被密度,三个 float buffer 输出。
 *
 * 优先级:urban > farmland > wetland > desert(sand) > rainforest > forest > alpine > meadow。
 */

import type { Renderer } from "three/webgpu";
import {
  Fn,
  If,
  Return,
  clamp,
  float,
  instanceIndex,
  instancedArray,
  smoothstep,
  vec2,
} from "three/tsl";
import { BIOME } from "../const";
import { fbm2 } from "./noise";
import type { FloatBuffer, NI } from "./tsl-types";

export type BiomeResult = {
  biomeId: FloatBuffer;
  snow: FloatBuffer;
  vegDensity: FloatBuffer;
};

export type BiomeMaskBuffers = {
  forest: Float32Array;
  farmland: Float32Array;
  urban: Float32Array;
  sand: Float32Array;
  wetland: Float32Array;
  scrub: Float32Array;
  /** OSM 草地/牧场多边形(landuse=meadow|grass, natural=grassland) */
  grass: Float32Array;
};

function packMask4(
  a: Float32Array,
  b: Float32Array,
  c: Float32Array,
  d: Float32Array,
  n: number,
): Float32Array {
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = a[i] as number;
    out[i * 4 + 1] = b[i] as number;
    out[i * 4 + 2] = c[i] as number;
    out[i * 4 + 3] = d[i] as number;
  }
  return out;
}

export async function runBiomeClassify(
  renderer: Renderer,
  height: FloatBuffer,
  moisture: FloatBuffer,
  masks: BiomeMaskBuffers,
  res: number,
  size: number,
  baseAlt: number,
  seed: number,
): Promise<BiomeResult> {
  const N = res * res;
  const texel = size / res;
  // 7 张遮罩打成 2 个 vec4,整 kernel storage buffer 从 12 降到 7
  // (Windows 默认 maxStorageBuffersPerShaderStage = 8)
  const maskA = instancedArray(
    packMask4(masks.forest, masks.farmland, masks.urban, masks.sand, N),
    "vec4",
  );
  const maskB = instancedArray(
    packMask4(masks.wetland, masks.scrub, masks.grass, new Float32Array(N), N),
    "vec4",
  );
  const biomeId = instancedArray(N, "float");
  const snow = instancedArray(N, "float");
  const vegDensity = instancedArray(N, "float");
  const seedOff = (seed % 512) * 7.3;

  const kernel = Fn(() => {
    const i = instanceIndex.toInt();
    If(i.greaterThanEqual(N), () => {
      Return();
    });
    const x = i.mod(res);
    const y = i.div(res);
    const at = (cx: NI, cy: NI) =>
      clamp(float(cy), 0, res - 1)
        .toInt()
        .mul(res)
        .add(clamp(float(cx), 0, res - 1).toInt());

    const h = height.element(i).toVar();
    const hR = height.element(at(x.add(1), y));
    const hU = height.element(at(x, y.add(1)));
    const slope = vec2(hR.sub(h), hU.sub(h)).div(texel).length().toVar();

    const wpos = vec2(float(x), float(y))
      .div(res)
      .sub(0.5)
      .mul(size)
      .add(vec2(seedOff, seedOff * 1.7))
      .toVar();
    const jitter = fbm2(wpos.div(180), 3); // 生态过渡带扰动

    // 温度模型:海平面 24 ℃,直减率 6.5 ℃/km,噪声 ±1.5 ℃
    const altAbs = h.add(baseAlt);
    const temp = float(24)
      .sub(altAbs.mul(0.0065))
      .add(jitter.mul(1.5))
      .toVar();
    const moist = clamp(moisture.element(i), 0, 1).toVar();

    // 雪:低温 + 缓坡持雪(陡壁挂不住),0..1
    const snowTemp = smoothstep(2.5, -3.5, temp);
    const slopeHold = smoothstep(1.4, 0.5, slope);
    const snowK = clamp(snowTemp.mul(slopeHold.mul(0.75).add(0.25)).pow(0.8), 0, 1);
    snow.element(i).assign(snowK);

    // 遮罩读数(叠加过渡带抖动,边缘犬牙交错)
    const edge = jitter.mul(0.22);
    const ma = maskA.element(i);
    const mb = maskB.element(i);
    const fFor = clamp(ma.x.add(edge), 0, 1);
    const fFarm = clamp(ma.y.add(edge.mul(0.4)), 0, 1);
    const fUrban = clamp(ma.z, 0, 1);
    const fSand = clamp(ma.w.add(edge.mul(0.5)), 0, 1);
    const fWet = clamp(mb.x, 0, 1);
    const fScrub = clamp(mb.y, 0, 1);
    const fGrass = clamp(mb.z.add(edge.mul(0.6)), 0, 1);

    // 干旱沙漠(无遮罩数据时的气候推断):高温 + 极低湿度
    const arid = smoothstep(0.12, 0.03, moist).mul(smoothstep(14, 24, temp));
    const desertK = clamp(fSand.add(arid.mul(0.8)), 0, 1);
    // 雨林:密林 + 高湿 + 温暖
    const rainK = fFor.mul(smoothstep(0.5, 0.8, moist)).mul(smoothstep(14, 20, temp));
    // 高山带:树线以上
    const alpineK = smoothstep(3400, 3900, altAbs);

    const id = float(BIOME.meadow).toVar();
    const veg = float(0.14).add(jitter.mul(0.06)).toVar(); // meadow 基础
    // OSM 草地/牧场多边形:面积内草密度大幅抬升(id 保持 meadow),
    // 面积权重 fGrass 连续过渡 —— 小块草皮弱增,整片牧场浓密
    If(fGrass.greaterThan(0.25), () => {
      veg.assign(clamp(float(0.45).add(fGrass.mul(0.5)), 0, 1));
    });
    If(alpineK.greaterThan(0.5), () => {
      id.assign(BIOME.alpine);
      veg.assign(clamp(float(0.06).sub(snowK.mul(0.05)), 0, 1));
    });
    If(fFor.greaterThan(0.42), () => {
      id.assign(BIOME.forest);
      veg.assign(float(0.75).add(fFor.mul(0.25)));
    });
    If(rainK.greaterThan(0.4), () => {
      id.assign(BIOME.rainforest);
      veg.assign(1);
    });
    If(desertK.greaterThan(0.5), () => {
      id.assign(BIOME.desert);
      veg.assign(0.03);
    });
    If(fWet.greaterThan(0.45), () => {
      id.assign(BIOME.wetland);
      veg.assign(0.4);
    });
    If(fFarm.greaterThan(0.45), () => {
      id.assign(BIOME.farmland);
      veg.assign(0.2);
    });
    If(fUrban.greaterThan(0.45), () => {
      id.assign(BIOME.urban);
      veg.assign(0.05);
    });
    // 灌丛密度独立叠加(不改 biome id)
    veg.assign(clamp(veg.add(fScrub.mul(0.3)), 0, 1));
    // 雪下植被清零
    veg.assign(veg.mul(snowK.mul(0.9).oneMinus()));

    biomeId.element(i).assign(id);
    vegDensity.element(i).assign(veg);
  })().compute(N);
  kernel.setName("regionBiomeClassify");

  await renderer.computeAsync(kernel);
  return { biomeId, snow, vegDensity };
}
