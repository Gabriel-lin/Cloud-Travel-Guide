/**
 * 真实河道烧入 + 湿度扩散 kernel。
 *
 * - carve:OSM 河线光栅化的河床剖面(1=中心)按逐河哈希深度刻入高度场,
 *   每条河的河床形状/水深互不相同;湖底随水体遮罩下压。
 * - moisture:水源(河/湖/湿地)+ 侵蚀余水 → 可分离盒式模糊扩散(ping-pong)。
 */

import type { ComputeNode, Renderer } from "three/webgpu";
import {
  Fn,
  If,
  Return,
  clamp,
  float,
  instanceIndex,
  instancedArray,
  max,
} from "three/tsl";
import type { FloatBuffer, NF, NI } from "./tsl-types";

export type RiverCarveResult = {
  /** 刻蚀后的最终高度 */
  height: FloatBuffer;
  /** 河床刻蚀深度(米,水深参考) */
  carveDepth: FloatBuffer;
};

/** 河道/湖泊刻蚀 kernel */
export async function runRiverCarve(
  renderer: Renderer,
  heightIn: FloatBuffer,
  profileArr: Float32Array,
  riverHashArr: Float32Array,
  waterMaskArr: Float32Array,
  res: number,
): Promise<RiverCarveResult> {
  const N = res * res;
  const profile = instancedArray(profileArr, "float");
  const rHash = instancedArray(riverHashArr, "float");
  const waterM = instancedArray(waterMaskArr, "float");
  const height = instancedArray(N, "float");
  const carveDepth = instancedArray(N, "float");

  const kernel = Fn(() => {
    const i = instanceIndex.toInt();
    If(i.greaterThanEqual(N), () => {
      Return();
    });
    const h0 = heightIn.element(i).toVar();
    const p = clamp(profile.element(i), 0, 1).toVar();
    const hash = rHash.element(i);
    // 逐河唯一深度:2.0~5.5 m 河中心,抛物线剖面 → 每条河床都不同
    const riverDepth = p.pow(1.25).mul(float(2).add(hash.mul(3.5)));
    // 湖泊:遮罩内下压 2.8 m(湖床),边缘平滑
    const lakeDepth = clamp(waterM.element(i), 0, 1).mul(2.8);
    const depth = max(riverDepth, lakeDepth).toVar();
    height.element(i).assign(h0.sub(depth));
    carveDepth.element(i).assign(depth);
  })().compute(N);
  kernel.setName("regionRiverCarve");

  await renderer.computeAsync(kernel);
  return { height, carveDepth };
}

/** 湿度扩散:源注入 + 可分离盒式模糊 ×2 轮 */
export async function runMoisture(
  renderer: Renderer,
  sourceArr: Float32Array,
  erosionWater: FloatBuffer | null,
  res: number,
): Promise<FloatBuffer> {
  const N = res * res;
  const src = instancedArray(sourceArr, "float");
  const mA = instancedArray(N, "float");
  const mB = instancedArray(N, "float");

  const guard = (body: () => void) =>
    Fn(() => {
      If(instanceIndex.greaterThanEqual(N), () => {
        Return();
      });
      body();
    });

  const initK = guard(() => {
    const i = instanceIndex.toInt();
    const base = clamp(src.element(i).mul(1.4), 0, 1).toVar();
    if (erosionWater) {
      base.assign(max(base, clamp(erosionWater.element(i).mul(2.5), 0, 0.6)));
    }
    mA.element(instanceIndex.toInt()).assign(base);
  })().compute(N);
  initK.setName("moistureInit");

  const R = 6; // 模糊半径(texel)≈ 23 m
  const makeBlur = (
    srcBuf: FloatBuffer,
    dstBuf: FloatBuffer,
    horizontal: boolean,
  ): ComputeNode => {
    const k = guard(() => {
      const i = instanceIndex.toInt();
      const x = i.mod(res);
      const y = i.div(res);
      let acc: NF = float(0);
      for (let o = -R; o <= R; o++) {
        const cx: NI = horizontal
          ? clamp(float(x).add(o), 0, res - 1).toInt()
          : x;
        const cy: NI = horizontal
          ? y
          : clamp(float(y).add(o), 0, res - 1).toInt();
        acc = acc.add(srcBuf.element(cy.mul(res).add(cx)));
      }
      dstBuf.element(i).assign(acc.div(2 * R + 1));
    })().compute(N);
    k.setName(horizontal ? "moistureBlurH" : "moistureBlurV");
    return k;
  };

  const blurH1 = makeBlur(mA, mB, true);
  const blurV1 = makeBlur(mB, mA, false);
  await renderer.computeAsync([initK, blurH1, blurV1, blurH1, blurV1]);
  return mA;
}
