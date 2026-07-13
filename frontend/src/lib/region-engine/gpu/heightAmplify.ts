/**
 * 细节放大 kernel:DEM 宏观形态 + 分形微地形。
 *
 * ~30 m 采样的 DEM 双线性放大后过于平滑,本 kernel 按坡度调制叠加 fbm/山脊噪声
 * (山地细节强、平原细节弱),城区/农田/水面抑制,并输出侵蚀硬度场。
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
  vec2,
} from "three/tsl";
import { fbm2, ridged2 } from "./noise";
import type { FloatBuffer, NI } from "./tsl-types";

export type AmplifyResult = {
  height: FloatBuffer;
  hardness: FloatBuffer;
};

export async function runHeightAmplify(
  renderer: Renderer,
  demRel: Float32Array,
  suppress: Float32Array,
  res: number,
  size: number,
  seed: number,
): Promise<AmplifyResult> {
  const N = res * res;
  const texel = size / res;
  const dem = instancedArray(demRel, "float");
  const sup = instancedArray(suppress, "float");
  const height = instancedArray(N, "float");
  const hardness = instancedArray(N, "float");
  const seedOff = (seed % 1024) * 13.7;

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

    const h0 = dem.element(i).toVar();
    const hL = dem.element(at(x.sub(1), y));
    const hR = dem.element(at(x.add(1), y));
    const hD = dem.element(at(x, y.sub(1)));
    const hU = dem.element(at(x, y.add(1)));
    const slope = vec2(hR.sub(hL), hU.sub(hD))
      .div(2 * texel)
      .length()
      .toVar();

    const wpos = vec2(float(x), float(y))
      .div(res)
      .sub(0.5)
      .mul(size)
      .add(vec2(seedOff, seedOff * 0.61))
      .toVar();

    // 三频细节:250 m 起伏 / 60 m 皱褶 / 山脊谷线
    const macro = fbm2(wpos.div(250), 4);
    const meso = fbm2(wpos.div(60).add(vec2(31.7, 17.3)), 4);
    const rid = ridged2(wpos.div(95));

    const slopeK = clamp(slope.mul(4), 0, 1);
    const supK = clamp(sup.element(i), 0, 1);
    // 平原 0.8 m 起伏,山地最高 ~14 m;城/田/水抑制 92%
    const amp = float(0.8)
      .add(slopeK.mul(9))
      .mul(supK.mul(0.92).oneMinus());
    const detail = macro
      .mul(0.55)
      .add(meso.mul(0.3))
      .add(rid.sub(0.5).mul(slopeK).mul(0.6));

    height.element(i).assign(h0.add(detail.mul(amp)));
    // 硬度:陡坡 = 岩石(抗侵蚀),叠噪声碎化
    hardness
      .element(i)
      .assign(
        clamp(
          float(0.18)
            .add(slopeK.mul(0.62))
            .add(fbm2(wpos.div(140), 3).mul(0.18)),
          0,
          1,
        ),
      );
  })().compute(N);
  kernel.setName("regionHeightAmplify");

  await renderer.computeAsync(kernel);
  return { height, hardness };
}
