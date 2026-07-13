/**
 * 层级风 kernel(全顶点阶段,LAAS `Wind.ts` 的两级简化):
 *
 * ① 平均倾斜:整树沿风向按高度悬臂剖面弯曲,阵风场(平流 fbm 锋面)调幅;
 * ② 摇摆:围绕倾斜的慢振荡,频率由每实例哈希去相关(相位/频率各不相同),
 *    副轴 1.31× 形成 Lissajous 轨迹,不是同步摆钟。
 *
 * 返回世界空间位移,供树/灌木/农作物/草的 positionNode 叠加。
 */

import { cos, sin, vec2, vec3 } from "three/tsl";
import { fbm2 } from "../gpu/noise";
import type { NF, NV2, NV3 } from "../gpu/tsl-types";
import type { EnvState } from "./env";

/**
 * @param anchor   实例根部世界 xz(阵风采样点,整树一致)
 * @param heightK  顶点相对高度 0..1(根部 0 → 冠顶 1)
 * @param phase    每实例相位哈希 0..1
 * @param amp      最大位移(米,树 ~0.5、灌木 ~0.15、作物 ~0.08)
 */
export function windSway(
  env: EnvState,
  anchor: NV2,
  heightK: NF,
  phase: NF,
  amp: number,
): NV3 {
  // 阵风锋面:85 m 尺度 fbm 沿风向平流(10.5 m/s)
  const gustP = anchor.sub(env.windDir.mul(env.time.mul(10.5))).div(85);
  const gust = fbm2(gustP, 2).mul(0.5).add(0.5);

  // 悬臂剖面:位移 ∝ heightK²
  const profile = heightK.mul(heightK);
  const strength = env.windStrength.mul(gust.mul(0.7).add(0.3));

  // 每实例固有频率 0.5~1.1 Hz + 相位去相关
  const freq = phase.mul(0.6).add(0.5).mul(6.283);
  const t = env.time.mul(freq).add(phase.mul(37));
  const swayMain = sin(t).mul(0.5).add(0.5).mul(0.55).add(0.45);
  const swayCross = cos(t.mul(1.31)).mul(0.25);

  const dir = vec3(env.windDir.x, 0, env.windDir.y);
  const cross = vec3(env.windDir.y.negate(), 0, env.windDir.x);
  return dir
    .mul(swayMain)
    .add(cross.mul(swayCross))
    .mul(profile.mul(strength).mul(amp));
}

/** 叶片微颤(附加高频小幅噪声,近景树叶用) */
export function leafFlutter(
  env: EnvState,
  anchor: NV2,
  vertexHash: NF,
  amp: number,
): NV3 {
  const t = env.time.mul(9).add(vertexHash.mul(61));
  const n = fbm2(anchor.div(3).add(vec2(t.mul(0.03), 0)), 2);
  return vec3(
    sin(t).mul(n),
    cos(t.mul(1.7)).mul(n).mul(0.6),
    sin(t.mul(0.83)).mul(n),
  ).mul(env.windStrength.mul(amp));
}
