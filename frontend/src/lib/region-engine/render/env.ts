/**
 * 场景环境状态:昼夜、太阳/月亮方向、风场 uniform(全部材质共享)。
 *
 * 昼夜切换是平滑插值(~2.5 s),nightK ∈ [0,1] 驱动天空/光照/萤火虫/窗光。
 */

import { Color, Vector2, Vector3 } from "three";
import { uniform } from "three/tsl";
import type { TimeOfDay } from "../types";

export class EnvState {
  /** 0=白天, 1=黑夜(平滑过渡) */
  readonly nightK = uniform(0);
  /** 世界时间(秒,驱动风/水/粒子动画) */
  readonly time = uniform(0);
  /** 太阳方向(单位向量,指向太阳) */
  readonly sunDir = uniform(new Vector3(0.35, 0.72, 0.42).normalize());
  /** 风:方向(单位 xz)与强度 0..1 */
  readonly windDir = uniform(new Vector2(0.82, 0.57));
  readonly windStrength = uniform(0.45);

  private target: TimeOfDay = "day";

  readonly daySun = new Vector3(0.35, 0.72, 0.42).normalize();
  /** 夜晚的“月光”方向 */
  readonly nightSun = new Vector3(-0.3, 0.55, -0.5).normalize();

  setTimeOfDay(tod: TimeOfDay): void {
    this.target = tod;
  }

  get timeOfDay(): TimeOfDay {
    return this.target;
  }

  /** 每帧推进:时间累计 + 昼夜插值 */
  update(dt: number): void {
    this.time.value += dt;
    const targetK = this.target === "night" ? 1 : 0;
    const k = this.nightK.value as number;
    const next = k + (targetK - k) * (1 - Math.exp(-dt * 1.6));
    this.nightK.value = Math.abs(next - targetK) < 1e-3 ? targetK : next;
    const t = this.nightK.value as number;
    (this.sunDir.value as Vector3)
      .copy(this.daySunLerped(t))
      .normalize();
  }

  private tmp = new Vector3();

  private daySunLerped(t: number): Vector3 {
    return this.tmp.copy(this.daySun).lerp(this.nightSun, t);
  }

  /** CPU 侧光照颜色(DirectionalLight 每帧调色) */
  sunColor(out: Color): Color {
    const t = this.nightK.value as number;
    return out.setRGB(
      1.0 * (1 - t) + 0.28 * t,
      0.96 * (1 - t) + 0.34 * t,
      0.88 * (1 - t) + 0.52 * t,
    );
  }

  sunIntensity(): number {
    const t = this.nightK.value as number;
    return 3.2 * (1 - t) + 0.35 * t;
  }

  ambientIntensity(): number {
    const t = this.nightK.value as number;
    return 0.55 * (1 - t) + 0.12 * t;
  }

  fogColor(out: Color): Color {
    const t = this.nightK.value as number;
    return out.setRGB(
      0.72 * (1 - t) + 0.03 * t,
      0.8 * (1 - t) + 0.045 * t,
      0.88 * (1 - t) + 0.09 * t,
    );
  }
}
