/**
 * TSL 噪声/哈希工具 kernel 库。
 *
 * - `hash2`:pcg2d 风格整数哈希(确定性,无 sin 哈希的条带伪影)
 * - `fbm2`:MaterialX 分形噪声封装(顶点/片元/compute 通用)
 * - `ridged2`:山脊噪声(1-|n|),用于岩石细节
 */

import {
  abs,
  fract,
  mx_fractal_noise_float,
  mx_noise_float,
  sin,
  vec2,
  vec3,
} from "three/tsl";
import type { NF, NV2, NV3 } from "./tsl-types";

/** 2D → 0..1 哈希(fract-sin 混淆;compute/vertex 通用) */
export function hash2(p: NV2, seed = 0): NF {
  const s = p.x
    .mul(127.1)
    .add(p.y.mul(311.7))
    .add(seed * 17.17);
  return fract(sin(s).mul(43758.5453));
}

/**
 * 整数格哈希:先把大坐标折进 [0,1),避免 sin(大整数) 精度崩溃打出棋盘纹。
 */
export function hashCell(i: NV2, seed = 0): NF {
  const p = vec2(
    fract(i.x.mul(0.1031).add(i.y.mul(0.0773)).add(seed * 0.018)),
    fract(i.y.mul(0.0973).add(i.x.mul(0.0541)).add(seed * 0.029)),
  );
  return hash2(p, seed);
}

/** 标准 fbm(octaves 编译期常量) */
export function fbm2(p: NV2, octaves: number, lacunarity = 2, gain = 0.5): NF {
  return mx_fractal_noise_float(
    vec3(p.x, p.y, 0),
    octaves,
    lacunarity,
    gain,
    1,
  );
}

/** 山脊噪声:锐利谷线,岩石/远山细节 */
export function ridged2(p: NV2): NF {
  const n = mx_noise_float(vec3(p.x, p.y, 0));
  return abs(n).oneMinus();
}

/** 3D fbm(云密度等) */
export function fbm3(p: NV3, octaves: number, lacunarity = 2, gain = 0.5): NF {
  return mx_fractal_noise_float(p, octaves, lacunarity, gain, 1);
}
