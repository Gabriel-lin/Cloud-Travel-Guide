/**
 * 鸟类羽色皮肤(CPU 程序化绘制,供 BirdFlocks 的实例图集使用)。
 *
 * 羽色/斑纹对照各鸟种的实拍参考(Wikipedia 条目首图,均为鉴定级侧面照)与
 * Cornell / Birds of the World 鉴定要点重画;不采样照片。
 *
 * 一致性与个体差异:
 *   - 每个鸟种一个皮肤库(SKIN_VARIANTS 张 tile),库内每张按种子长出个体差异
 *     (性别 / 幼鸟 / 形态型 / 斑纹位置密度 / 色相明度抖动);同种所有个体都从本种
 *     库中取 tile,再由 shader 叠加逐实例亮度、色相、饱和度微调 —— 基本纹理一致,
 *     每只都不完全相同。
 *
 * tile 布局(与 birdGeometry 的 UV 约定一致):
 *   u: 0 喙 → 1 尾;v ∈ [0, 0.52] 身体展开(t = v/0.52,td = 背 0 → 腹 1 对称)
 *   v ∈ [0.54, 0.975] 翼/尾"单片羽":chord = 羽根 0 → 羽端 1,u 分区见 SKIN_ZONES,
 *     每片几何羽把自己的宽度映射到分区全宽,羽轴在 SKIN_RACHIS_K 处
 *   v > 0.978 腿 / 趾色块(u < 0.5 趾,否则腿)
 */

import type { BirdSpeciesId } from "./birdSpecies";

export const SKIN_TILE_W = 256;
export const SKIN_TILE_H = 192;
/** 每鸟种皮肤库中的个体变体数 */
export const SKIN_VARIANTS = 8;

/** 翼/尾区 u 分区 [u0, u1](几何 uvU0/uvUW 与此对齐) */
export const SKIN_ZONES = {
  covert: [0.04, 0.34],
  tail: [0.36, 0.6],
  secondary: [0.62, 0.83],
  primary: [0.84, 0.98],
} as const;
/** 羽轴在分区内的相对位置(addFeather 的 tc=0.36) */
export const SKIN_RACHIS_K = 0.36;
/** 腿 / 趾色块 v */
export const SKIN_LEG_V = 0.99;
/** 肩羽钉到体区的 UV(背侧,喜鹊此处为白肩斑) */
export const SKIN_SCAPULAR_UV: readonly [number, number] = [0.34, 0.1];

export type Rgb = [number, number, number];
type FeatherZone = keyof typeof SKIN_ZONES;

// ---------------------------------------------------------------------------
// 数学 / 噪声
// ---------------------------------------------------------------------------

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const sm = (t: number): number => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
/** x 落在 [a, b] 内为 1,边缘软化宽度 s */
const range = (x: number, a: number, b: number, s: number): number =>
  sm((x - a) / s) * sm((b - x) / s);
/** |x − c| < w 为 1,边缘软化 s */
const band = (x: number, c: number, w: number, s: number): number => sm((w - Math.abs(x - c)) / s);
/** 椭圆盘 */
const disc = (x: number, y: number, cx: number, cy: number, rx: number, ry: number, s: number): number =>
  sm((1 - Math.hypot((x - cx) / rx, (y - cy) / ry)) / s);
/** 周期横斑:n 个周期,占空比 w(0..1),phase 相位 */
const bars = (x: number, n: number, w: number, phase: number, s = 0.3): number =>
  sm((Math.cos((x * n + phase) * Math.PI * 2) - (1 - 2 * w)) / s);

function hash01(x: number, y: number, s: number): number {
  let h = ((x | 0) * 374761393 + (y | 0) * 668265263 + ((s * 97) | 0) * 1013904223) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x: number, y: number, s: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash01(ix, iy, s);
  const b = hash01(ix + 1, iy, s);
  const c = hash01(ix, iy + 1, s);
  const d = hash01(ix + 1, iy + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** 两倍频 fbm(0..1 附近,均值 ≈ 0.5) */
function fbm2(x: number, y: number, s: number): number {
  return vnoise(x, y, s) * 0.667 + vnoise(x * 2.13, y * 2.13, s + 3) * 0.333;
}

type Px = { r: number; g: number; b: number };

function paint(p: Px, col: Rgb, k: number): void {
  const c = clamp01(k);
  if (c <= 0) return;
  p.r += (col[0] - p.r) * c;
  p.g += (col[1] - p.g) * c;
  p.b += (col[2] - p.b) * c;
}

function scaleRgb(p: Px, k: number): void {
  p.r *= k;
  p.g *= k;
  p.b *= k;
}

function lerp3(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp01(t);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

// ---------------------------------------------------------------------------
// 个体 / 羽片单元
// ---------------------------------------------------------------------------

/** 一张 tile 的个体参数(由种子抽取) */
type Indiv = {
  male: boolean;
  juv: boolean;
  /** 形态型 0..1(原鸽等多型种) */
  morph: number;
  hueJ: number;
  lumJ: number;
  /** 羽毛磨损 / 褪色 0..1 */
  wear: number;
  /** 噪声偏移 */
  off: number;
  a: number;
  b: number;
  c: number;
  d: number;
};

/** 体羽鳞状单元:羽片沿 u(向尾)叠瓦排列 */
type Cell = {
  /** 单元中心 1 → 边缘 0 */
  center: number;
  /** 羽片后缘(靭尾一侧)边缘遮罩 */
  edge: number;
  /** 沿 u 方向单元内位置 −0.5..0.5(+ 向尾) */
  fx: number;
  /** 横向单元内位置 −0.5..0.5 */
  fy: number;
  seed: number;
};

function featherCell(u: number, td: number, nU: number, nV: number, s: number): Cell {
  // 低频扭曲 + 逐排随机错位:打破规则砖格,羽端呈圆弧鳞状
  const uu = u + (vnoise(u * 9, td * 9, s + 41) - 0.5) * 0.035;
  const tt = td + (vnoise(u * 9, td * 9, s + 43) - 0.5) * 0.03;
  const row = Math.floor(tt * nV);
  const stag = (row & 1) * 0.5 + hash01(row, 0, s + 7) * 0.3;
  const colF = uu * nU + stag;
  const col = Math.floor(colF);
  const fx = colF - col - 0.5;
  const fy = tt * nV - row - 0.5;
  const center = clamp01(1 - Math.hypot(fx * 1.6, fy * 2.1));
  const tipD = fx + 0.6 * fy * fy; // 羽端圆弧(抛物线)
  const edge = sm((tipD - 0.22) / 0.16) * sm((0.5 - Math.abs(fy) * 1.05) / 0.25);
  return { center, edge, fx, fy, seed: hash01(col, row, s) };
}

type BodyCtx = {
  u: number;
  /** 背 0 → 腹 1 */
  td: number;
  cell: Cell;
  in: Indiv;
};

type FeatherCtx = {
  zone: FeatherZone;
  /** 分区内横向 0..1(羽轴在 SKIN_RACHIS_K) */
  x: number;
  /** 羽根 0 → 羽端 1 */
  c: number;
  /** 外羽片 −1 .. 羽轴 0 .. 内羽片 +1 */
  web: number;
  in: Indiv;
};

type SpeciesSkin = {
  back: Rgb;
  side: Rgb;
  belly: Rgb;
  head: Rgb;
  feathers: Record<FeatherZone, Rgb>;
  /** 羽缘:颜色与强度(0 = 无明显羽缘) */
  fringe: { col: Rgb; k: number };
  beak: Rgb;
  cere?: Rgb;
  iris: Rgb;
  eyeRing?: Rgb;
  leg: Rgb;
  toe?: Rgb;
  /** 金属光泽 0..1(写入 morph,shader 高光随之增强偏蓝绿) */
  sheen: number;
  /** 体羽鳞状:每单位 u 的羽数、明暗幅度 */
  scale: { n: number; amp: number };
  /** 物种特定的个体抽取(性别 / 幼鸟 / 形态比例) */
  variant: (rng: () => number) => Partial<Indiv>;
  body: (p: Px, c: BodyCtx) => void;
  feather: (p: Px, f: FeatherCtx) => void;
};

/** 沿 u 拉长的斑纹(fu 小于 ftd 时沿体轴拉长) */
const streaks = (u: number, td: number, off: number, fu: number, ftd: number, thr: number, s: number): number =>
  sm((fbm2(u * fu, td * ftd, off) - thr) / s);

const BLACK: Rgb = [0.05, 0.05, 0.055];
const WHITE: Rgb = [0.95, 0.95, 0.94];

// ---------------------------------------------------------------------------
// 鸟种皮肤定义(颜色取自参考照片的中间调)
// ---------------------------------------------------------------------------

const SKINS: Record<BirdSpeciesId, SpeciesSkin> = {
  /** 树麻雀:栗冠、白颊黑斑、小黑颏、白半领、背黑纵纹、两道白翼斑;雌雄同色 */
  sparrow: {
    back: [0.5, 0.35, 0.19],
    side: [0.66, 0.58, 0.46],
    belly: [0.8, 0.77, 0.7],
    head: [0.5, 0.27, 0.15],
    feathers: {
      covert: [0.5, 0.33, 0.17],
      tail: [0.42, 0.3, 0.17],
      secondary: [0.34, 0.24, 0.13],
      primary: [0.3, 0.21, 0.12],
    },
    fringe: { col: [0.8, 0.7, 0.5], k: 0.7 },
    beak: [0.12, 0.1, 0.08],
    iris: [0.25, 0.15, 0.08],
    leg: [0.72, 0.55, 0.48],
    sheen: 0.04,
    scale: { n: 26, amp: 0.05 },
    variant: (rng) => ({ juv: rng() < 0.15 }),
    body(p, c) {
      const { u, td } = c;
      const dull = c.in.juv ? 0.5 : 1;
      paint(p, [0.5, 0.27, 0.15], range(u, -1, 0.27, 0.05) * range(td, -1, 0.42, 0.05)); // 栗冠/颈背
      paint(p, [0.95, 0.94, 0.9], range(u, 0.1, 0.24, 0.03) * range(td, 0.44, 0.88, 0.03)); // 白颊
      paint(p, [0.93, 0.92, 0.88], range(u, 0.22, 0.27, 0.025) * range(td, 0.32, 0.78, 0.03) * 0.85); // 白半领
      paint(p, BLACK, disc(u, td, 0.165, 0.6, 0.035, 0.12, 0.3) * dull); // 黑颊斑
      paint(p, BLACK, range(u, 0.05, 0.13, 0.02) * range(td, 0.5, 0.6, 0.02) * 0.85); // 黑眼先
      paint(p, BLACK, range(u, 0.07, 0.19, 0.03) * range(td, 0.84, 1.1, 0.03) * dull); // 黑颏
      const mantle = range(u, 0.27, 0.74, 0.05) * range(td, -1, 0.46, 0.05);
      paint(p, [0.1, 0.07, 0.05], streaks(u, td, c.in.off, 5, 16, 0.55, 0.06) * mantle * 0.8); // 背黑纵纹
      paint(p, [0.78, 0.66, 0.45], c.cell.edge * mantle * 0.35); // 背羽淡缘
      paint(p, [0.7, 0.6, 0.45], range(u, 0.35, 0.8, 0.08) * range(td, 0.4, 0.75, 0.08) * 0.35); // 胁略暖
    },
    feather(p, f) {
      if (f.zone === "covert") {
        paint(p, [0.12, 0.08, 0.05], sm((0.55 - Math.abs(f.web)) / 0.2) * sm((0.85 - f.c) / 0.15) * 0.55); // 黑心
        paint(p, [0.93, 0.9, 0.82], sm((f.c - 0.86) / 0.06) * 0.8); // 白端 → 翼斑
      }
    },
  },

  /** 家燕:钢蓝上体、锈红额喉、蓝黑胸带、乳白下体、黑色深叉尾带白斑 */
  swallow: {
    back: [0.07, 0.09, 0.2],
    side: [0.07, 0.09, 0.2],
    belly: [0.9, 0.85, 0.74],
    head: [0.07, 0.09, 0.2],
    feathers: {
      covert: [0.06, 0.07, 0.14],
      tail: [0.05, 0.05, 0.08],
      secondary: [0.05, 0.05, 0.08],
      primary: [0.05, 0.05, 0.07],
    },
    fringe: { col: [0.2, 0.2, 0.25], k: 0 },
    beak: [0.06, 0.06, 0.06],
    iris: [0.15, 0.1, 0.06],
    leg: [0.2, 0.15, 0.13],
    sheen: 0.6,
    scale: { n: 20, amp: 0.03 },
    variant: () => ({}),
    body(p, c) {
      const { u, td } = c;
      const cream: Rgb = [0.92 - c.in.a * 0.06, 0.87 - c.in.a * 0.06, 0.78 - c.in.a * 0.1];
      // 下体乳白,与钢蓝上体界线清晰
      paint(p, [0.07, 0.09, 0.2], 1);
      paint(p, cream, range(u, 0.27, 1.1, 0.04) * sm((td - 0.55) / 0.06));
      paint(p, [0.55, 0.2, 0.1], range(u, 0.04, 0.09, 0.02) * range(td, -1, 0.5, 0.05)); // 锈红额
      paint(p, [0.55, 0.2, 0.1], range(u, 0.05, 0.21, 0.025) * sm((td - 0.55) / 0.06)); // 锈红喉
      paint(p, [0.06, 0.08, 0.18], range(u, 0.21, 0.275, 0.02) * sm((td - 0.55) / 0.06)); // 蓝黑胸带
      const iri = (vnoise(u * 5, td * 3, c.in.off + 2) - 0.5) * 0.12;
      p.b += iri;
      p.g += iri * 0.4;
    },
    feather(p, f) {
      if (f.zone === "tail") paint(p, WHITE, sm((f.web - 0.25) / 0.2) * band(f.c, 0.66, 0.09, 0.05) * 0.9); // 内羽片白斑
    },
  },

  /** 原鸽:蓝灰体、深灰头、颈绿紫虹彩、两道黑翼带、白腰、尾端黑带;多型 */
  pigeon: {
    back: [0.6, 0.63, 0.68],
    side: [0.62, 0.65, 0.7],
    belly: [0.66, 0.68, 0.72],
    head: [0.42, 0.45, 0.52],
    feathers: {
      covert: [0.66, 0.69, 0.73],
      tail: [0.5, 0.53, 0.58],
      secondary: [0.62, 0.65, 0.7],
      primary: [0.36, 0.38, 0.43],
    },
    fringe: { col: [0.75, 0.77, 0.8], k: 0.15 },
    beak: [0.2, 0.18, 0.18],
    cere: [0.9, 0.9, 0.88],
    iris: [0.9, 0.45, 0.1],
    leg: [0.8, 0.35, 0.35],
    sheen: 0.35,
    scale: { n: 22, amp: 0.04 },
    variant: (rng) => ({ morph: rng() }),
    body(p, c) {
      const { u, td } = c;
      const m = c.in.morph;
      paint(p, [0.42, 0.45, 0.52], range(u, -1, 0.2, 0.04)); // 深灰头
      const neck = range(u, 0.14, 0.3, 0.04) * range(td, 0.3, 0.95, 0.1);
      const nz = sm((fbm2(u * 7, td * 4, c.in.off + 5) - 0.5) / 0.25);
      paint(p, lerp3([0.2, 0.5, 0.38], [0.42, 0.25, 0.48], nz), neck * 0.8); // 颈部绿紫虹彩(平滑过渡)
      paint(p, [0.5, 0.47, 0.5], range(u, 0.24, 0.46, 0.05) * sm((td - 0.55) / 0.1) * 0.6); // 酒灰胸
      paint(p, WHITE, range(u, 0.74, 0.86, 0.03) * range(td, -1, 0.32, 0.05)); // 白腰
      if (m > 0.8 && m <= 0.9) scaleRgb(p, 0.55); // 暗型
      else if (m > 0.9 && m <= 0.95) paint(p, [0.62, 0.42, 0.34], 0.7); // 红型
      else if (m > 0.95) paint(p, WHITE, sm((fbm2(u * 4, td * 3, c.in.off + 9) - 0.52) / 0.05)); // 花斑型
    },
    feather(p, f) {
      const m = f.in.morph;
      if (m > 0.8 && m <= 0.9) scaleRgb(p, 0.6);
      else if (m > 0.9 && m <= 0.95) paint(p, [0.62, 0.42, 0.34], 0.6);
      if (f.zone === "covert") {
        if (m <= 0.6) paint(p, BLACK, band(f.c, 0.8, 0.07, 0.04) * 0.9); // 黑翼带
        else if (m <= 0.8) paint(p, [0.15, 0.15, 0.18], sm((vnoise(f.x * 4, f.c * 5, f.in.off + 7) - 0.5) / 0.05) * 0.8); // 格纹型
      } else if (f.zone === "secondary") {
        if (m <= 0.6) paint(p, BLACK, band(f.c, 0.56, 0.06, 0.04) * 0.9); // 第二道翼带
      } else if (f.zone === "tail") {
        paint(p, BLACK, sm((f.c - 0.8) / 0.06) * 0.85); // 尾端黑带
        paint(p, WHITE, sm((-f.web - 0.7) / 0.15) * sm((0.78 - f.c) / 0.1) * 0.6); // 外侧尾羽白缘
      }
    },
  },

  /** 喜鹊:黑头胸背、白腹白肩斑、蓝色虹彩翼、白初级飞羽黑端、铜绿长尾 */
  magpie: {
    back: [0.05, 0.05, 0.06],
    side: [0.05, 0.05, 0.06],
    belly: [0.95, 0.95, 0.93],
    head: [0.05, 0.05, 0.06],
    feathers: {
      covert: [0.07, 0.2, 0.42],
      tail: [0.09, 0.3, 0.27],
      secondary: [0.07, 0.18, 0.4],
      primary: [0.92, 0.93, 0.92],
    },
    fringe: { col: [0.2, 0.2, 0.2], k: 0 },
    beak: [0.04, 0.04, 0.04],
    iris: [0.15, 0.1, 0.06],
    leg: [0.06, 0.06, 0.06],
    sheen: 0.7,
    scale: { n: 18, amp: 0.03 },
    variant: () => ({}),
    body(p, c) {
      const { u, td } = c;
      paint(p, [0.05, 0.05, 0.06], 1);
      paint(p, WHITE, range(u, 0.3, 0.78, 0.04) * sm((td - 0.56) / 0.04)); // 白腹
      paint(p, WHITE, range(u, 0.27, 0.42, 0.03) * range(td, 0.22, 0.5, 0.04)); // 白肩斑
      const iri = (vnoise(u * 4, td * 3, c.in.off + 3) - 0.5) * 0.08 * range(u, 0.24, 0.8, 0.1) * range(td, -1, 0.5, 0.1);
      p.b += iri * 1.4;
      p.g += iri;
    },
    feather(p, f) {
      if (f.zone === "primary") {
        paint(p, BLACK, sm((f.c - 0.78) / 0.06)); // 黑端
        paint(p, BLACK, sm((-f.web - 0.6) / 0.15) * 0.8); // 外羽片黑缘
      } else if (f.zone === "covert" || f.zone === "secondary") {
        paint(p, BLACK, sm((f.c - 0.86) / 0.06) * 0.7);
        const iri = (vnoise(f.x * 3, f.c * 4, f.in.off + 11) - 0.5) * 0.16;
        p.b += iri;
        p.g += iri * 0.5;
      } else {
        paint(p, [0.3, 0.12, 0.35], sm((f.c - 0.82) / 0.1) * 0.5); // 尾端紫晕
        paint(p, BLACK, sm((f.c - 0.93) / 0.04) * 0.6);
      }
    },
  },

  /** 大嘴乌鸦:通体黑,紫蓝光泽,颈背磨损处泛褐灰;粗厚弓形喙 */
  crow: {
    back: [0.05, 0.05, 0.06],
    side: [0.06, 0.06, 0.07],
    belly: [0.07, 0.07, 0.08],
    head: [0.06, 0.06, 0.07],
    feathers: {
      covert: [0.04, 0.04, 0.05],
      tail: [0.04, 0.04, 0.05],
      secondary: [0.04, 0.04, 0.05],
      primary: [0.04, 0.04, 0.05],
    },
    fringe: { col: [0.1, 0.1, 0.12], k: 0 },
    beak: [0.03, 0.03, 0.03],
    iris: [0.12, 0.08, 0.05],
    leg: [0.05, 0.05, 0.05],
    sheen: 0.55,
    scale: { n: 16, amp: 0.035 },
    variant: () => ({}),
    body(p, c) {
      const { u, td } = c;
      paint(p, [0.16, 0.13, 0.11], range(u, 0.16, 0.3, 0.05) * range(td, 0.3, 1.1, 0.1) * c.in.wear * 0.7); // 颈部磨损泛褐
      const iri = (fbm2(u * 3, td * 2, c.in.off + 4) - 0.5) * 0.1 * range(td, -1, 0.6, 0.15);
      p.b += iri * 1.5;
      p.r += iri * 0.6;
    },
    feather(p, f) {
      const iri = (vnoise(f.x * 2, f.c * 3, f.in.off + 13) - 0.5) * 0.1;
      p.b += iri * 1.4;
      p.r += iri * 0.5;
    },
  },

  /** 绿头鸭:雄 墨绿头白颈环栗胸灰体黑尾上覆羽白尾;雌 褐色鳞斑深眼纹;两性蓝紫翼镜白边 */
  mallard: {
    back: [0.42, 0.4, 0.37],
    side: [0.72, 0.7, 0.66],
    belly: [0.78, 0.76, 0.72],
    head: [0.06, 0.32, 0.18],
    feathers: {
      covert: [0.5, 0.46, 0.4],
      tail: [0.9, 0.9, 0.88],
      secondary: [0.45, 0.42, 0.38],
      primary: [0.42, 0.4, 0.37],
    },
    fringe: { col: [0.85, 0.78, 0.62], k: 0.5 },
    beak: [0.85, 0.75, 0.2],
    iris: [0.25, 0.15, 0.08],
    leg: [0.92, 0.45, 0.1],
    sheen: 0.35,
    scale: { n: 18, amp: 0.05 },
    variant: (rng) => ({ male: rng() < 0.55 }),
    body(p, c) {
      const { u, td } = c;
      if (c.in.male) {
        paint(p, [0.06, 0.32, 0.18], range(u, -1, 0.225, 0.02)); // 墨绿头
        const purple = (vnoise(u * 12, td * 5, c.in.off + 1) - 0.5) * 0.14 * range(u, -1, 0.22, 0.03);
        p.r += Math.max(purple, 0) * 1.2;
        p.b += Math.abs(purple);
        paint(p, WHITE, band(u, 0.237, 0.011, 0.005)); // 白颈环
        paint(p, [0.42, 0.18, 0.1], range(u, 0.245, 0.46, 0.03) * sm((td - 0.35) / 0.15)); // 栗胸
        // 胁部细波状纹
        const verm = 0.5 + 0.5 * Math.sin((td * 90 + vnoise(u * 10, td * 4, c.in.off + 6) * 4) * Math.PI);
        scaleRgb(p, 1 - verm * 0.07 * range(u, 0.45, 0.82, 0.05) * range(td, 0.35, 1.1, 0.1));
        paint(p, BLACK, range(u, 0.8, 1.1, 0.03) * (range(td, -1, 0.38, 0.06) + sm((td - 0.72) / 0.06))); // 黑尾上/下覆羽
      } else {
        paint(p, [0.6, 0.48, 0.32], 1);
        paint(p, [0.72, 0.62, 0.45], range(u, -1, 0.22, 0.04) * sm((td - 0.38) / 0.1)); // 淡黄褐脸
        paint(p, [0.3, 0.22, 0.14], range(u, -1, 0.22, 0.04) * range(td, -1, 0.34, 0.06)); // 深冠
        paint(p, [0.25, 0.18, 0.11], range(u, 0.05, 0.2, 0.02) * range(td, 0.5, 0.6, 0.02) * 0.85); // 深眼纹
        const bodyZ = range(u, 0.22, 1.1, 0.04);
        paint(p, [0.28, 0.2, 0.12], c.cell.center * 0.65 * bodyZ); // 羽心深褐
        paint(p, [0.8, 0.68, 0.48], c.cell.edge * 0.6 * bodyZ); // 羽缘淡皮黄
      }
    },
    feather(p, f) {
      if (f.zone === "secondary") {
        const inner = sm((f.web + 0.3) / 0.3);
        paint(p, [0.16, 0.24, 0.66], range(f.c, 0.42, 0.8, 0.04) * inner); // 蓝紫翼镜
        paint(p, BLACK, band(f.c, 0.83, 0.03, 0.02) * inner);
        paint(p, WHITE, band(f.c, 0.38, 0.035, 0.02) * inner + sm((f.c - 0.88) / 0.04) * inner); // 白边
      } else if (!f.in.male) {
        if (f.zone === "tail") paint(p, [0.5, 0.4, 0.28], 0.85);
        paint(p, [0.3, 0.22, 0.13], sm((0.5 - Math.abs(f.web)) / 0.25) * sm((0.85 - f.c) / 0.1) * 0.5); // 深羽心
      } else if (f.zone === "covert") {
        paint(p, [0.6, 0.57, 0.52], sm((f.web - 0.2) / 0.3) * 0.3);
      }
    },
  },

  /** 白鹭:通体白,细黑喙,黄眼先,黑腿黄趾 */
  egret: {
    back: [0.95, 0.96, 0.95],
    side: [0.96, 0.97, 0.96],
    belly: [0.97, 0.98, 0.97],
    head: [0.96, 0.97, 0.96],
    feathers: {
      covert: [0.95, 0.96, 0.95],
      tail: [0.95, 0.96, 0.95],
      secondary: [0.94, 0.95, 0.94],
      primary: [0.93, 0.94, 0.93],
    },
    fringe: { col: [1, 1, 1], k: 0 },
    beak: [0.06, 0.06, 0.07],
    iris: [0.9, 0.85, 0.4],
    leg: [0.08, 0.08, 0.09],
    toe: [0.85, 0.75, 0.2],
    sheen: 0.1,
    scale: { n: 14, amp: 0.025 },
    variant: () => ({}),
    body(p, c) {
      const { u, td } = c;
      paint(p, [0.75, 0.72, 0.35], range(u, 0.075, 0.1, 0.01) * range(td, 0.44, 0.62, 0.03)); // 黄眼先
      const warm = c.in.hueJ * 0.03;
      p.r += warm;
      p.g += warm * 0.5;
    },
    feather(p, f) {
      if (f.zone === "primary") paint(p, [0.8, 0.82, 0.82], sm((f.c - 0.85) / 0.1) * 0.3);
    },
  },

  /** 银鸥:白头体尾、浅灰背翼、黑翼尖白斑、黄喙红点、淡黄眼、粉腿;冬羽头颈褐纵纹,幼鸟褐斑 */
  gull: {
    back: [0.62, 0.65, 0.68],
    side: [0.93, 0.94, 0.94],
    belly: [0.96, 0.96, 0.95],
    head: [0.95, 0.95, 0.94],
    feathers: {
      covert: [0.64, 0.67, 0.7],
      tail: [0.95, 0.95, 0.94],
      secondary: [0.62, 0.65, 0.68],
      primary: [0.55, 0.58, 0.62],
    },
    fringe: { col: [0.96, 0.96, 0.96], k: 0.35 },
    beak: [0.9, 0.75, 0.2],
    iris: [0.9, 0.88, 0.6],
    eyeRing: [0.9, 0.6, 0.2],
    leg: [0.85, 0.65, 0.65],
    sheen: 0.12,
    scale: { n: 16, amp: 0.03 },
    variant: (rng) => ({ juv: rng() < 0.2 }),
    body(p, c) {
      const { u, td } = c;
      if (c.in.juv) {
        paint(p, [0.55, 0.5, 0.44], 1);
        paint(p, [0.82, 0.78, 0.72], c.cell.edge * 0.6); // 淡鳞缘
        paint(p, [0.3, 0.27, 0.24], c.cell.center * 0.35 * range(u, 0.22, 1.1, 0.05) * range(td, -1, 0.7, 0.1));
        paint(p, [0.4, 0.36, 0.32], streaks(u, td, c.in.off, 9, 12, 0.56, 0.06) * range(u, -1, 0.26, 0.05) * 0.6);
        return;
      }
      paint(p, WHITE, 1);
      paint(p, [0.62, 0.65, 0.68], range(u, 0.26, 0.76, 0.04) * range(td, -1, 0.42, 0.05)); // 浅灰背
      // 冬羽头颈细褐纹(强度随个体)
      paint(p, [0.45, 0.4, 0.35], streaks(u, td, c.in.off, 10, 14, 0.58, 0.05) * range(u, -1, 0.28, 0.05) * c.in.a * 0.7);
      paint(p, [0.9, 0.3, 0.1], range(u, 0.03, 0.046, 0.006) * range(td, 0.4, 0.75, 0.05) * 0.8); // 喙红点
    },
    feather(p, f) {
      if (f.in.juv) {
        paint(p, [0.5, 0.45, 0.4], 0.8);
        paint(p, [0.82, 0.78, 0.72], Math.max(sm((Math.abs(f.web) - 0.75) / 0.15), sm((f.c - 0.85) / 0.08)) * 0.6);
        if (f.zone === "tail") paint(p, [0.2, 0.18, 0.16], sm((f.c - 0.7) / 0.08) * 0.85);
        if (f.zone === "primary") paint(p, [0.2, 0.18, 0.16], sm((f.c - 0.3) / 0.2) * 0.8);
        return;
      }
      if (f.zone === "primary") {
        paint(p, BLACK, sm((f.c - 0.42) / 0.15)); // 黑翼尖
        paint(p, WHITE, disc(f.web, f.c, 0.3, 0.8, 0.5, 0.06, 0.4) * 0.95); // 白斑(mirror)
        paint(p, WHITE, sm((f.c - 0.94) / 0.03) * 0.9); // 白端
      }
    },
  },

  /** 鸿雁:黑长喙基部白细线、深栗冠与后颈、乳白脸与前颈、灰褐背淡缘、胁部淡横斑、白腹 */
  goose: {
    back: [0.46, 0.4, 0.32],
    side: [0.62, 0.56, 0.47],
    belly: [0.9, 0.88, 0.82],
    head: [0.32, 0.2, 0.12],
    feathers: {
      covert: [0.5, 0.45, 0.37],
      tail: [0.5, 0.46, 0.4],
      secondary: [0.42, 0.38, 0.32],
      primary: [0.36, 0.33, 0.29],
    },
    fringe: { col: [0.85, 0.8, 0.7], k: 0.6 },
    beak: [0.06, 0.05, 0.05],
    iris: [0.25, 0.15, 0.08],
    leg: [0.9, 0.5, 0.15],
    sheen: 0.08,
    scale: { n: 16, amp: 0.06 },
    variant: () => ({}),
    body(p, c) {
      const { u, td } = c;
      paint(p, [0.88, 0.83, 0.72], range(u, 0.04, 0.3, 0.03) * sm((td - 0.42) / 0.06)); // 乳白脸/前颈
      paint(p, [0.32, 0.2, 0.12], range(u, -1, 0.3, 0.04) * range(td, -1, 0.34, 0.04)); // 深栗冠/后颈
      paint(p, WHITE, band(u, 0.078, 0.008, 0.004) * sm((td - 0.3) / 0.1) * 0.9); // 喙基白线
      const flank = range(u, 0.3, 0.78, 0.05) * range(td, 0.38, 0.78, 0.06);
      paint(p, [0.82, 0.78, 0.7], c.cell.edge * flank * 0.65); // 胁部淡横斑
      paint(p, [0.4, 0.34, 0.27], c.cell.center * flank * 0.3);
      paint(p, [0.8, 0.75, 0.65], c.cell.edge * range(u, 0.28, 0.8, 0.05) * range(td, -1, 0.4, 0.06) * 0.5); // 背羽淡缘
      paint(p, [0.93, 0.92, 0.88], sm((td - 0.8) / 0.06) * range(u, 0.3, 1.1, 0.05)); // 白腹
      paint(p, WHITE, range(u, 0.84, 1.1, 0.03) * sm((td - 0.55) / 0.1)); // 白尾下覆羽
    },
    feather(p, f) {
      if (f.zone === "tail") paint(p, WHITE, sm((f.c - 0.88) / 0.05) * 0.9);
    },
  },

  /** 红隼:雄 蓝灰头黑髭纹、栗背黑点、灰尾黑次端带白端、皮黄下体黑纵纹;雌 栗褐横斑 */
  kestrel: {
    back: [0.66, 0.4, 0.22],
    side: [0.8, 0.62, 0.42],
    belly: [0.86, 0.74, 0.54],
    head: [0.52, 0.55, 0.6],
    feathers: {
      covert: [0.66, 0.4, 0.22],
      tail: [0.5, 0.53, 0.58],
      secondary: [0.45, 0.3, 0.18],
      primary: [0.16, 0.13, 0.12],
    },
    fringe: { col: [0.85, 0.72, 0.5], k: 0.3 },
    beak: [0.45, 0.48, 0.52],
    cere: [0.9, 0.75, 0.2],
    iris: [0.12, 0.08, 0.05],
    eyeRing: [0.9, 0.75, 0.2],
    leg: [0.9, 0.75, 0.2],
    sheen: 0.05,
    scale: { n: 20, amp: 0.05 },
    variant: (rng) => ({ male: rng() < 0.5 }),
    body(p, c) {
      const { u, td } = c;
      const male = c.in.male;
      if (male) {
        paint(p, [0.52, 0.55, 0.6], range(u, -1, 0.22, 0.04) * range(td, -1, 0.75, 0.08)); // 蓝灰头
        paint(p, [0.5, 0.53, 0.58], range(u, 0.74, 1.1, 0.04) * range(td, -1, 0.4, 0.06)); // 灰腰
      } else {
        paint(p, [0.55, 0.38, 0.22], range(u, -1, 0.22, 0.04) * range(td, -1, 0.75, 0.08)); // 褐头
        paint(p, [0.25, 0.17, 0.1], streaks(u, td, c.in.off, 8, 20, 0.56, 0.05) * range(u, -1, 0.22, 0.04) * range(td, -1, 0.6, 0.1) * 0.6);
        paint(p, [0.6, 0.38, 0.2], range(u, 0.74, 1.1, 0.04) * range(td, -1, 0.4, 0.06));
      }
      paint(p, [0.9, 0.85, 0.72], range(u, 0.08, 0.22, 0.03) * sm((td - 0.62) / 0.06)); // 淡颊/喉
      paint(p, [0.15, 0.1, 0.07], range(u, 0.1, 0.15, 0.015) * range(td, 0.6, 0.8, 0.02) * 0.8); // 黑髭纹
      const mantle = range(u, 0.24, 0.72, 0.05) * range(td, -1, 0.45, 0.06);
      if (male) {
        const spot = disc(c.cell.fx, c.cell.fy, 0.05, 0, 0.16, 0.2, 0.3) * sm((c.cell.seed - 0.25) / 0.1);
        paint(p, BLACK, spot * mantle * 0.9); // 背黑点
      } else {
        paint(p, [0.22, 0.14, 0.08], band(c.cell.fx, 0.02, 0.1, 0.06) * mantle * 0.75); // 背黑横斑
      }
      const breast = range(u, 0.24, 0.58, 0.05) * sm((td - 0.55) / 0.08);
      paint(p, [0.25, 0.16, 0.09], streaks(u, td, c.in.off + 2, 4, 18, male ? 0.58 : 0.52, 0.05) * breast * 0.8); // 胸纵纹
      const bellyZ = range(u, 0.5, 0.82, 0.05) * sm((td - 0.6) / 0.08);
      paint(p, [0.25, 0.16, 0.09], disc(c.cell.fx, c.cell.fy, 0, 0, 0.14, 0.18, 0.3) * sm((c.cell.seed - 0.3) / 0.1) * bellyZ * 0.7); // 腹点斑
    },
    feather(p, f) {
      const male = f.in.male;
      if (f.zone === "covert") {
        if (male) paint(p, BLACK, disc(f.web, f.c, 0.15, 0.8, 0.45, 0.07, 0.35) * 0.9); // 黑次端点
        else paint(p, [0.22, 0.14, 0.08], (band(f.c, 0.35, 0.05, 0.03) + band(f.c, 0.6, 0.05, 0.03) + band(f.c, 0.85, 0.05, 0.03)) * 0.75);
      } else if (f.zone === "tail") {
        if (!male) {
          paint(p, [0.58, 0.38, 0.22], 1);
          paint(p, [0.22, 0.14, 0.08], (band(f.c, 0.2, 0.035, 0.02) + band(f.c, 0.4, 0.035, 0.02) + band(f.c, 0.6, 0.035, 0.02)) * 0.7);
        }
        paint(p, BLACK, range(f.c, 0.78, 0.9, 0.02) * 0.95); // 黑次端带
        paint(p, WHITE, sm((f.c - 0.93) / 0.03) * 0.9); // 白端
      } else if (f.zone === "secondary") {
        paint(p, [0.22, 0.14, 0.08], (band(f.c, 0.3, 0.05, 0.03) + band(f.c, 0.58, 0.05, 0.03)) * 0.6);
      }
    },
  },

  /** 雕鸮:黄褐底、背部深褐斑驳、胸粗黑纵纹、腹细横纹、灰褐面盘深缘、橙眼 */
  "eagle-owl": {
    back: [0.42, 0.3, 0.17],
    side: [0.62, 0.48, 0.3],
    belly: [0.8, 0.68, 0.48],
    head: [0.55, 0.42, 0.26],
    feathers: {
      covert: [0.55, 0.4, 0.24],
      tail: [0.6, 0.46, 0.28],
      secondary: [0.5, 0.36, 0.22],
      primary: [0.45, 0.32, 0.2],
    },
    fringe: { col: [0.75, 0.62, 0.42], k: 0.25 },
    beak: [0.15, 0.13, 0.12],
    iris: [0.95, 0.5, 0.08],
    eyeRing: [0.12, 0.1, 0.08],
    leg: [0.75, 0.62, 0.45],
    sheen: 0.03,
    scale: { n: 14, amp: 0.06 },
    variant: () => ({}),
    body(p, c) {
      const { u, td } = c;
      paint(p, [0.72, 0.62, 0.48], range(u, 0.05, 0.17, 0.02) * range(td, 0.3, 0.9, 0.1)); // 面盘
      paint(p, [0.2, 0.14, 0.09], band(u, 0.175, 0.012, 0.008) * range(td, 0.3, 0.9, 0.1) * 0.7); // 面盘深缘
      const back = range(u, 0.18, 1.1, 0.05) * range(td, -1, 0.5, 0.08);
      paint(p, [0.15, 0.1, 0.06], sm((fbm2(u * 15, td * 11, c.in.off) - 0.53) / 0.08) * back * 0.8); // 背部深褐细斑驳
      paint(p, [0.82, 0.7, 0.5], c.cell.edge * back * 0.35);
      const breast = range(u, 0.2, 0.58, 0.05) * sm((td - 0.5) / 0.08);
      paint(p, [0.18, 0.12, 0.07], streaks(u, td, c.in.off + 5, 3.5, 20, 0.54, 0.05) * breast * 0.9); // 胸粗纵纹
      const lower = range(u, 0.45, 0.92, 0.06) * sm((td - 0.6) / 0.08);
      paint(p, [0.3, 0.2, 0.12], (0.5 + 0.5 * Math.sin(u * 62 * Math.PI + td * 6)) * lower * 0.35); // 腹细横纹
    },
    feather(p, f) {
      paint(p, [0.2, 0.13, 0.08], bars(f.c, f.zone === "covert" ? 3 : 5.5, 0.22, f.in.b) * 0.6 * (f.zone === "covert" ? 0.7 : 1));
      if (f.zone === "covert") paint(p, [0.18, 0.12, 0.07], sm((fbm2(f.x * 5, f.c * 6, f.in.off + 8) - 0.56) / 0.06) * 0.6);
    },
  },

  /** 雪鸮:白底;雄近纯白疏点,雌/幼横斑密;面盘纯白,黄眼黑喙 */
  "snowy-owl": {
    back: [0.94, 0.95, 0.96],
    side: [0.95, 0.96, 0.97],
    belly: [0.97, 0.97, 0.98],
    head: [0.96, 0.97, 0.97],
    feathers: {
      covert: [0.94, 0.95, 0.96],
      tail: [0.95, 0.96, 0.96],
      secondary: [0.93, 0.94, 0.95],
      primary: [0.92, 0.93, 0.94],
    },
    fringe: { col: [1, 1, 1], k: 0 },
    beak: [0.06, 0.06, 0.06],
    iris: [0.98, 0.85, 0.1],
    eyeRing: [0.12, 0.1, 0.08],
    leg: [0.9, 0.9, 0.9],
    sheen: 0.05,
    scale: { n: 14, amp: 0.03 },
    variant: (rng) => ({ male: rng() < 0.45 }),
    body(p, c) {
      const { u, td } = c;
      const dens = c.in.male ? 0.18 : 0.75 + c.in.b * 0.25;
      const face = range(u, -1, 0.2, 0.04) * sm((td - 0.38) / 0.08);
      const barM = band(c.cell.fx, 0.05, c.in.male ? 0.06 : 0.11, 0.05) * sm((c.cell.seed - (1 - dens)) / 0.1);
      paint(p, [0.15, 0.13, 0.12], barM * (1 - face) * range(u, 0.04, 1.1, 0.03) * 0.9); // 横斑
    },
    feather(p, f) {
      const k = f.in.male ? 0.22 : 0.85;
      paint(p, [0.15, 0.13, 0.12], bars(f.c, f.zone === "tail" ? 3 : 4.5, 0.2, f.in.b) * k * sm((0.55 - Math.abs(f.web)) / 0.35 + 0.4));
    },
  },
};

/** 鸟种光泽(写入 morph 表供 shader 提亮偏蓝绿高光) */
export function skinSheen(id: BirdSpeciesId): number {
  return SKINS[id].sheen;
}

// ---------------------------------------------------------------------------
// 绘制
// ---------------------------------------------------------------------------

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawIndividual(skin: SpeciesSkin, seed: number): Indiv {
  const rng = mulberry(seed);
  const base: Indiv = {
    male: rng() < 0.5,
    juv: false,
    morph: rng(),
    hueJ: (rng() - 0.5) * 0.16,
    lumJ: 0.9 + rng() * 0.2,
    wear: rng(),
    off: rng() * 90,
    a: rng(),
    b: rng(),
    c: rng(),
    d: rng(),
  };
  return { ...base, ...skin.variant(rng) };
}

/** 眼:深色眼圈 + 眼周淡色 + 虹膜 + 瞳孔 + 高光(位置与几何眼盘钉点一致) */
function paintEye(p: Px, skin: SpeciesSkin, u: number, t: number): void {
  const dark: Rgb = [skin.head[0] * 0.25, skin.head[1] * 0.25, skin.head[2] * 0.25];
  const ring = skin.eyeRing ?? [0.88, 0.82, 0.72];
  for (const tc of [0.28, 0.72]) {
    const dx = (u - 0.1) * 6.4;
    const dy = (t - tc) * 4.2;
    const d = Math.hypot(dx, dy);
    paint(p, dark, sm((0.12 - d) / 0.03) * (1 - sm((0.084 - d) / 0.02)) * 0.6);
    paint(p, ring, sm((0.088 - d) / 0.016) * (1 - sm((0.06 - d) / 0.012)) * 0.85);
    paint(p, [0.06, 0.05, 0.04], sm((0.066 - d) / 0.01) * (1 - sm((0.05 - d) / 0.01)) * 0.7);
    paint(p, skin.iris, sm((0.05 - d) / 0.012) * (1 - sm((0.02 - d) / 0.008)));
    paint(p, [0.02, 0.02, 0.02], sm((0.018 - d) / 0.008));
    paint(p, [1, 0.97, 0.92], sm((0.01 - Math.hypot(dx + 0.012, dy + 0.008)) / 0.006) * 0.7);
  }
}

/** 喙:角质色 + 嘴峰压暗 + 蜡膜 + 鼻孔(u < 0.11 区,几何喙环钉在此) */
function paintBeak(p: Px, skin: SpeciesSkin, u: number, td: number, femaleMallard: boolean): void {
  const beak = sm((0.11 - u) / 0.05);
  if (beak <= 0.02) return;
  paint(p, skin.beak, beak);
  if (femaleMallard) {
    paint(p, [0.88, 0.52, 0.18], beak);
    paint(p, [0.22, 0.16, 0.1], beak * range(td, -1, 0.3, 0.08) * 0.85); // 雌鸭嘴峰深色鞍斑
  }
  const culmen = sm((0.012 - Math.abs(td - 0.18)) / 0.014) * beak;
  scaleRgb(p, 1 - culmen * 0.3);
  if (skin.cere) {
    const cere = sm((u - 0.05) / 0.015) * sm((0.092 - u) / 0.025) * sm((0.42 - td) / 0.2);
    paint(p, skin.cere, cere * 0.85);
  }
  const nare = sm((0.012 - Math.abs(u - 0.058)) / 0.008) * sm((0.04 - Math.abs(td - 0.4)) / 0.03) * beak;
  scaleRgb(p, 1 - nare * 0.55);
  const tip = sm((0.02 - u) / 0.012) * beak;
  scaleRgb(p, 1 - tip * 0.25);
}

/**
 * 画一张鸟皮 tile 到图集(RGBA8,sRGB)。
 * @param seed 个体种子:同种不同 seed → 同一基本纹理、不同个体细节
 */
export function paintBirdSkin(
  pix: Uint8Array,
  atlasW: number,
  ox: number,
  oy: number,
  tw: number,
  th: number,
  species: BirdSpeciesId,
  seed: number,
): void {
  const skin = SKINS[species];
  const ind = drawIndividual(skin, seed);
  const femaleMallard = species === "mallard" && !ind.male;
  const p: Px = { r: 0, g: 0, b: 0 };
  const rk = SKIN_RACHIS_K;
  const zones = Object.entries(SKIN_ZONES) as [FeatherZone, readonly [number, number]][];

  for (let y = 0; y < th; y++) {
    const fv = y / (th - 1);
    for (let x = 0; x < tw; x++) {
      const u = x / (tw - 1);

      if (fv < 0.54) {
        // ---------------- 身体 ----------------
        const t = Math.min(fv / 0.52, 1);
        const td = Math.min(t, 1 - t) * 2;
        const toSide = sm(td * 0.95);
        const toBelly = sm((td - 0.28) / 0.52);
        const base = lerp3(lerp3(skin.back, skin.side, toSide), skin.belly, toBelly);
        p.r = base[0];
        p.g = base[1];
        p.b = base[2];
        paint(p, skin.head, range(u, -1, 0.2, 0.05) * (1 - toBelly * 0.6));

        const cell = featherCell(u, td, skin.scale.n, skin.scale.n * 0.55, seed);
        skin.body(p, { u, td, cell, in: ind });

        // 廓羽鳞状明暗:羽端略亮、羽根被上一排压暗;头部更细
        const isHead = u < 0.2;
        const cellF = isHead ? featherCell(u, td, skin.scale.n * 1.8, skin.scale.n, seed + 1) : cell;
        const amp = skin.scale.amp * (isHead ? 0.6 : 1) * range(u, 0.06, 0.96, 0.05);
        const tipD = cellF.fx + 0.6 * cellF.fy * cellF.fy;
        const shade = 1 + amp * ((0.5 - Math.abs(cellF.fy)) * 1.2 + tipD * 0.9 + (cellF.seed - 0.5) * 0.3);
        scaleRgb(p, shade);
        // 羽枝细纹
        const barb = 0.5 + 0.5 * Math.sin((u * 46 + Math.abs(cellF.fy) * 2.6) * Math.PI * 2);
        scaleRgb(p, 1 - barb * amp * 0.5);

        paintBeak(p, skin, u, td, femaleMallard);
        paintEye(p, skin, u, t);

        const grain = fbm2(u * 7, td * 5, ind.off + 20) - 0.5;
        const gk = 1 + grain * 0.1;
        p.r = (p.r + ind.hueJ * 0.06) * ind.lumJ * gk;
        p.g = (p.g + ind.hueJ * 0.015) * ind.lumJ * gk;
        p.b = (p.b - ind.hueJ * 0.05) * ind.lumJ * gk;
      } else if (fv > 0.978) {
        // ---------------- 腿 / 趾色块 ----------------
        const col = u < 0.5 ? (skin.toe ?? skin.leg) : skin.leg;
        p.r = col[0] * ind.lumJ;
        p.g = col[1] * ind.lumJ;
        p.b = col[2] * ind.lumJ;
      } else {
        // ---------------- 翼 / 尾单片羽 ----------------
        let zone: FeatherZone = "covert";
        let z0 = 0.04;
        let z1 = 0.34;
        let bestD = 9;
        for (const [name, [a, b]] of zones) {
          const d = u < a ? a - u : u > b ? u - b : 0;
          if (d < bestD) {
            bestD = d;
            zone = name;
            z0 = a;
            z1 = b;
          }
        }
        const xz = clamp01((u - z0) / (z1 - z0));
        const c = clamp01((fv - 0.555) / 0.42);
        const web = xz < rk ? -(rk - xz) / rk : (xz - rk) / (1 - rk);
        const base = skin.feathers[zone];
        p.r = base[0];
        p.g = base[1];
        p.b = base[2];
        // 外羽片略深、内羽片略浅(折叠时外羽片朝外受磨损)
        scaleRgb(p, 1 - Math.max(-web, 0) * 0.12 + Math.max(web, 0) * 0.05);

        skin.feather(p, { zone, x: xz, c, web, in: ind });

        const lum = 0.3 * p.r + 0.59 * p.g + 0.11 * p.b;
        // 羽轴:浅羽深轴、深羽浅轴,向羽端变细消失
        const rachis = sm((0.028 - Math.abs(xz - rk)) / 0.014) * sm((0.92 - c) / 0.15) * sm((c - 0.02) / 0.06);
        paint(p, lum > 0.45 ? [lum * 0.72, lum * 0.7, lum * 0.66] : [lum + 0.14, lum + 0.13, lum + 0.11], rachis * 0.8);
        // 羽枝:自羽轴斜向羽端的细纹
        const barb = 0.5 + 0.5 * Math.sin((c * 22 + Math.abs(web) * 5.5 + vnoise(xz * 3, c * 4, ind.off + 27) * 0.5) * Math.PI * 2);
        scaleRgb(p, 1 - barb * 0.07 * (1 - rachis));
        // 羽缘(边缘 + 羽端),羽根绒羽不带缘
        const fluff = sm((0.1 - c) / 0.08);
        if (skin.fringe.k > 0) {
          const fr = Math.max(sm((Math.abs(web) - 0.78) / 0.14), sm((c - 0.88) / 0.07)) * skin.fringe.k * (1 - fluff);
          paint(p, skin.fringe.col, fr * 0.85);
        }
        // 边缘压暗(羽片边界)+ 羽根绒羽灰化
        const edge = sm((Math.abs(web) - 0.9) / 0.08) * (1 - fluff);
        scaleRgb(p, 1 - edge * 0.25);
        paint(p, [skin.side[0] * 0.85 + 0.08, skin.side[1] * 0.85 + 0.07, skin.side[2] * 0.85 + 0.05], fluff * 0.45);
        // 磨损:羽端褪色
        scaleRgb(p, 1 + sm((c - 0.7) / 0.3) * ind.wear * 0.06);

        const grain = fbm2(xz * 4, c * 6, ind.off + 33) - 0.5;
        const gk = 1 + grain * 0.06;
        p.r = (p.r + ind.hueJ * 0.03) * ind.lumJ * gk;
        p.g = (p.g + ind.hueJ * 0.01) * ind.lumJ * gk;
        p.b = (p.b - ind.hueJ * 0.025) * ind.lumJ * gk;
      }

      const o = ((oy + y) * atlasW + (ox + x)) * 4;
      pix[o] = Math.round(clamp01(p.r) * 255);
      pix[o + 1] = Math.round(clamp01(p.g) * 255);
      pix[o + 2] = Math.round(clamp01(p.b) * 255);
      pix[o + 3] = 255;
    }
  }
}
