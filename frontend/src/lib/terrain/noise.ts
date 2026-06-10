/**
 * 零依赖的可重复(seedable)程序化噪声工具。
 *
 * 实现经典 value-noise + fBm(分形布朗运动),用于在无任何外部高程数据时
 * 直接生成连续起伏的地形高度场。输出范围约 [0,1]。
 */

/** 基于坐标与种子的确定性散列,返回 [0,1)。 */
function hash2(x: number, y: number, seed: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

/** 5 阶平滑插值(smootherstep),消除栅格感。 */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 二维 value noise,输出 [0,1]。 */
export function valueNoise2D(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  const v00 = hash2(ix, iy, seed);
  const v10 = hash2(ix + 1, iy, seed);
  const v01 = hash2(ix, iy + 1, seed);
  const v11 = hash2(ix + 1, iy + 1, seed);

  const ux = fade(fx);
  const uy = fade(fy);

  return lerp(lerp(v00, v10, ux), lerp(v01, v11, ux), uy);
}

/** fBm 的可调参数。 */
export interface FbmOptions {
  /** 叠加的噪声层数。默认 5。 */
  octaves?: number;
  /** 每层频率倍率。默认 2。 */
  lacunarity?: number;
  /** 每层振幅衰减。默认 0.5。 */
  gain?: number;
  /** 基础频率。默认 1。 */
  frequency?: number;
  /** 随机种子。默认 0。 */
  seed?: number;
}

/**
 * 分形布朗运动:多层 value noise 叠加,输出归一化到 [0,1]。
 *
 * @param nx 归一化横坐标 [0,1]
 * @param nz 归一化纵坐标 [0,1]
 */
export function fbm2D(nx: number, nz: number, options: FbmOptions = {}): number {
  const {
    octaves = 5,
    lacunarity = 2,
    gain = 0.5,
    frequency = 1,
    seed = 0,
  } = options;

  let amplitude = 1;
  let freq = frequency;
  let sum = 0;
  let norm = 0;

  for (let i = 0; i < octaves; i += 1) {
    sum += amplitude * valueNoise2D(nx * freq, nz * freq, seed + i * 13);
    norm += amplitude;
    amplitude *= gain;
    freq *= lacunarity;
  }

  return norm > 0 ? sum / norm : 0;
}

/** 生成一个可直接用作地形高度生成器的 fBm 函数。 */
export function createFbmGenerator(
  options: FbmOptions = {},
): (nx: number, nz: number) => number {
  return (nx, nz) => fbm2D(nx, nz, options);
}
