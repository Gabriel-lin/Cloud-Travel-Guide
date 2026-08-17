/**
 * 真实河道烧入 + 湿度扩散 kernel。
 *
 * - carve:OSM 河线光栅化的河床剖面(1=中心)按逐河哈希深度刻入高度场,
 *   再按 seed + 流向叠深潭浅滩 / 沙洲 / 沙波;湖底用湖盆距离场下压,
 *   湖心深槽、近岸浅碟,并叠 seed 驱动的淤积波。
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
  sin,
  smoothstep,
  vec2,
} from "three/tsl";
import { fbm2 } from "./noise";
import type { FloatBuffer, NF, NI } from "./tsl-types";

export type RiverCarveResult = {
  /** 刻蚀后的最终高度 */
  height: FloatBuffer;
  /** 河床刻蚀深度(米,水深参考) */
  carveDepth: FloatBuffer;
};

function packFlow(flowX: Float32Array, flowZ: Float32Array, n: number): Float32Array {
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    out[i * 2] = flowX[i] as number;
    out[i * 2 + 1] = flowZ[i] as number;
  }
  return out;
}

/** 河道/湖泊刻蚀 kernel(含 seed 河床微地貌) */
export async function runRiverCarve(
  renderer: Renderer,
  heightIn: FloatBuffer,
  profileArr: Float32Array,
  riverDepthArr: Float32Array,
  lakeBowlArr: Float32Array,
  flowXArr: Float32Array,
  flowZArr: Float32Array,
  res: number,
  size: number,
  seed: number,
): Promise<RiverCarveResult> {
  const N = res * res;
  const profile = instancedArray(profileArr, "float");
  const rDepth = instancedArray(riverDepthArr, "float");
  const lakeBowl = instancedArray(lakeBowlArr, "float");
  const flow = instancedArray(packFlow(flowXArr, flowZArr, N), "vec2");
  const height = instancedArray(N, "float");
  const carveDepth = instancedArray(N, "float");
  const seedOff = (seed % 1024) * 13.7;

  const kernel = Fn(() => {
    const i = instanceIndex.toInt();
    If(i.greaterThanEqual(N), () => {
      Return();
    });
    const x = i.mod(res);
    const y = i.div(res);
    const h0 = heightIn.element(i).toVar();
    const p = clamp(profile.element(i), 0, 1).toVar();
    const rD = rDepth.element(i).toVar();
    const bowl = clamp(lakeBowl.element(i), 0, 1).toVar();
    const fl = flow.element(i).toVar();
    const flowMag = fl.length().max(0.001);
    const T = fl.div(flowMag).toVar();

    const wpos = vec2(float(x), float(y))
      .div(res)
      .sub(0.5)
      .mul(size)
      .add(vec2(seedOff, seedOff * 0.61))
      .toVar();
    const along = wpos.x.mul(T.x).add(wpos.y.mul(T.y)).toVar();
    const across = wpos.x.mul(T.y.negate()).add(wpos.y.mul(T.x)).toVar();

    // 溪流(浅刻)深潭-浅滩强;宽河以沙波/边滩为主
    const streamK = smoothstep(3.0, 1.3, rD).toVar();
    const baseRiver = p.pow(1.25).mul(rD).toVar();
    const pool = sin(along.div(8.5).add(fbm2(wpos.div(22), 2).mul(2.2)))
      .mul(0.5)
      .add(0.5)
      .toVar();
    const dunes = fbm2(vec2(along.div(14), across.div(5)).add(vec2(4.1, 9.7)), 3);
    const ripples = fbm2(vec2(along.div(3.2), across.div(1.4)).add(vec2(11.3, 2.9)), 3);
    const gravelBar = fbm2(vec2(along.div(7.2), across.div(2.6)).add(vec2(seedOff * 0.02, 5.4)), 3);
    const bar = smoothstep(0.18, 0.42, p)
      .mul(smoothstep(0.78, 0.52, p))
      .mul(sin(along.div(24).add(seedOff * 0.01)).mul(0.5).add(0.5));
    const relief = pool
      .sub(0.45)
      .mul(0.26)
      .mul(streamK)
      .mul(p)
      .add(dunes.mul(0.16).mul(p))
      .add(ripples.mul(0.08).mul(streamK).mul(p))
      .add(gravelBar.mul(0.11).mul(streamK).mul(p))
      .sub(bar.mul(0.14));
    const riverDepth = max(0, baseRiver.mul(float(1).add(relief))).toVar();

    // 湖:近岸浅碟 + 湖心深槽(seed 盆地) + 淤积波
    const basin = fbm2(wpos.div(32).add(vec2(8.2, 3.4)), 4).mul(0.5).add(0.5);
    const siltWave = fbm2(wpos.div(7.5).add(vec2(21.7, 5.1)), 3);
    const shoreBar = fbm2(wpos.div(9.5).add(vec2(3.3, seedOff * 0.03)), 3);
    const lakeDepth = bowl.mul(
      float(0.38)
        .add(bowl.mul(float(1.45).add(basin.mul(2.35))))
        .add(siltWave.mul(0.22))
        .add(shoreBar.mul(0.16).mul(float(1).sub(bowl))),
    );

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
