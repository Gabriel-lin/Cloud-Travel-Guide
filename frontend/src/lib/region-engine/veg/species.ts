/**
 * 树种生长文法参数(对齐 LAAS fable5-world-demo `Species.ts`/`VegTypes.ts`)。
 *
 * 每个树种 = 逐级分枝参数(LevelParams[])+ 树冠包络 + 叶簇参数:
 * levels[0] 是树干的几何参数;levels[i] 描述第 i 级枝的几何与其在母枝上的分布
 * (叶序/密度/插入角/长度比)。叶簇是真实网格(条带叶/针叶梳刷),不是贴片球。
 *
 * 成都平原:竹、樟(阔叶)、柳(滨水)、杉(针叶);
 * 高海拔站点自动启用高山杉,干旱站点启用梭梭 —— 由散布器按生物群系选择。
 */

import type { BarkStyleKey } from "../render/barkMaterial";

/** 树冠包络:按子枝在母枝上的位置缩放子枝长度 */
export type CrownShape = "cone" | "ellipsoid" | "dome" | "column" | "irregular";

export type FoliageKind = "leafCluster" | "needleSpray";

/** 逐级分枝参数(levels[0]=树干) */
export type LevelParams = {
  /** 每米母枝的子枝数(在 childStart..childEnd 区间内) */
  density: number;
  /** 0 = 黄金角螺旋叶序;n≥2 = n 枝轮生 */
  whorl: number;
  /** 承载子枝的母枝 t 区间 */
  childStart: number;
  childEnd: number;
  /** 插入角(弧度,相对母枝切向)在区间首/尾的值 */
  angleBase: number;
  angleTip: number;
  /** 子枝长 = 母枝长 × lenRatio × 树冠包络(t) */
  lenRatio: number;
  /** 长度 ± 抖动比例 */
  lenJitter: number;
  /** 子枝基半径 = 母枝 t 处半径 × radRatio */
  radRatio: number;
  /** 折线段数 */
  segs: number;
  /** 每段随机游走(弧度) */
  wander: number;
  /** 每段垂直响应:<0 下垂,>0 向上 */
  gravitropism: number;
  /** 悬臂下垂(整枝累计,弧度) */
  droop: number;
  /** 集中在梢端的上翘(云杉次级枝) */
  tipCurl: number;
  /** 半径沿枝衰减指数 */
  taper: number;
  /** 0=径向叶序;1=严格平面两列(针叶枝/榉树小枝);小数混合 */
  planar?: number;
};

/** 单叶/针叶形状 */
export type LeafShape = {
  /** 叶长(米);针叶簇为针长 */
  len: number;
  width: number;
  /** 宽度剖面指数(1≈椭圆,越大越尖) */
  shapePow: number;
  /** 沿主脉折叠(V 截面) */
  fold: number;
  /** 沿长度向下卷曲 */
  curl: number;
  /** 每簇针叶数(needleSpray) */
  needleCount: number;
  /** 排布:0=平面梳,1=径向刷 */
  brush: number;
};

export type FoliageParams = {
  kind: FoliageKind;
  /** 携带叶锚点的枝级 */
  anchorLevel: number;
  /** 锚点沿枝间距(米) */
  spacing: number;
  /** 锚点从枝的 t 起始 */
  tStart: number;
  /** 单簇世界尺度(米) */
  scale: [number, number];
  /** 叶簇偏离枝轴的外倾角(弧度) */
  tilt: number;
  /** 每簇叶数(leafCluster) */
  clusterSize: [number, number];
  /** 几何法线向冠层球面法线融合的比例(0..1) */
  normalBend: number;
  /** 叶/簇沿小枝两列互生(否则螺旋) */
  planarLeaves?: boolean;
  /** 叶基色(RGB 0..1) */
  color: [number, number, number];
  /** 逐锚点色相摆动幅度 */
  hueVar: number;
  /** 叶卡片预算(超出按步长抽稀,幸存者按 √stride 放大保持覆盖) */
  anchorTarget: number;
  /**
   * 叶簇卡片(LAAS FoliageCards):真实枝簇烘焙进图集后,按锚点放
   * alpha 测试大卡片。'lying' = 枝平面单面(针叶/榉);'cross' = 十字双面
   * (立体阔叶簇)。sizeK 为卡片尺寸相对锚点 scale 的倍数。
   */
  card: { mode: "lying" | "cross"; sizeK: number };
  leaf: LeafShape;
};

export type SpeciesParams = {
  id: TreeSpeciesId;
  /** 成树高度区间(米) */
  height: [number, number];
  /** 干底半径系数(占高度比) */
  trunkRadiusK: number;
  crown: CrownShape;
  /** 光竞争树冠不对称强度(0..~0.5) */
  asym: number;
  levels: LevelParams[];
  foliage: FoliageParams;
  /** 根部瘤状扩张:幅度、高度(米)、板根瓣数 */
  flare: { amp: number; height: number; lobes: number };
  bark: [number, number, number];
  /** 程序化树皮风格(对齐 LAAS BARK_TABLE) */
  barkStyle: BarkStyleKey;
  /** 竹类专用:一丛 culm(竹竿)数量区间 —— 存在时走专用生成路径 */
  culms?: [number, number];
};

export type TreeSpeciesId =
  | "bamboo"
  | "broadleaf"
  | "willow"
  | "conifer"
  | "alpineFir"
  | "saxaul";

export const TREE_SPECIES: Record<TreeSpeciesId, SpeciesParams> = {
  /** 竹:丛生竹竿 + 顶部下垂长叶(专用 culm 路径) */
  bamboo: {
    id: "bamboo",
    height: [7, 12],
    trunkRadiusK: 0.008,
    crown: "column",
    asym: 0.1,
    culms: [6, 10],
    levels: [
      {
        density: 0, whorl: 0, childStart: 0, childEnd: 0,
        angleBase: 0, angleTip: 0, lenRatio: 0, lenJitter: 0, radRatio: 0,
        segs: 7, wander: 0.025, gravitropism: 0.05, droop: 0.16, tipCurl: 0,
        taper: 0.3,
      },
    ],
    foliage: {
      kind: "leafCluster",
      anchorLevel: 0,
      spacing: 0.13,
      tStart: 0.4,
      scale: [0.55, 0.85],
      tilt: 1.15,
      clusterSize: [5, 8],
      normalBend: 0.35,
      color: [0.3, 0.46, 0.16],
      hueVar: 0.3,
      anchorTarget: 600,
      card: { mode: "cross", sizeK: 1.5 },
      leaf: { len: 0.28, width: 0.03, shapePow: 1.6, fold: 0.35, curl: 0.5, needleCount: 0, brush: 0 },
    },
    flare: { amp: 0, height: 0.3, lobes: 0 },
    bark: [0.4, 0.47, 0.24],
    barkStyle: "bamboo",
  },

  /** 樟/阔叶:椭球冠,黄金角叶序,3 级分枝 + 叶簇 */
  broadleaf: {
    id: "broadleaf",
    height: [9, 16],
    trunkRadiusK: 0.024,
    crown: "ellipsoid",
    asym: 0.28,
    levels: [
      {
        density: 0, whorl: 0, childStart: 0, childEnd: 0,
        angleBase: 0, angleTip: 0, lenRatio: 0, lenJitter: 0, radRatio: 0,
        segs: 6, wander: 0.06, gravitropism: 0.03, droop: 0, tipCurl: 0,
        taper: 0.85,
      },
      {
        density: 2.5, whorl: 0, childStart: 0.34, childEnd: 0.92,
        angleBase: 1.05, angleTip: 0.62, lenRatio: 0.62, lenJitter: 0.24, radRatio: 0.42,
        segs: 5, wander: 0.12, gravitropism: 0.06, droop: 0.24, tipCurl: 0.06,
        taper: 1.0,
      },
      {
        density: 2.6, whorl: 0, childStart: 0.25, childEnd: 0.95,
        angleBase: 0.95, angleTip: 0.6, lenRatio: 0.46, lenJitter: 0.3, radRatio: 0.42,
        segs: 3, wander: 0.18, gravitropism: 0, droop: 0.32, tipCurl: 0,
        taper: 1.0,
      },
    ],
    foliage: {
      kind: "leafCluster",
      anchorLevel: 2,
      spacing: 0.32,
      tStart: 0.18,
      scale: [0.62, 0.95],
      tilt: 0.72,
      clusterSize: [6, 9],
      normalBend: 0.55,
      color: [0.2, 0.34, 0.11],
      hueVar: 0.35,
      anchorTarget: 1400,
      card: { mode: "cross", sizeK: 1.6 },
      leaf: { len: 0.2, width: 0.1, shapePow: 1.15, fold: 0.3, curl: 0.28, needleCount: 0, brush: 0 },
    },
    flare: { amp: 0.5, height: 0.9, lobes: 4 },
    bark: [0.32, 0.26, 0.2],
    barkStyle: "beech",
  },

  /** 垂柳:穹顶冠,长垂小枝 + 窄长叶两列互生 */
  willow: {
    id: "willow",
    height: [6, 10],
    trunkRadiusK: 0.03,
    crown: "dome",
    asym: 0.2,
    levels: [
      {
        density: 0, whorl: 0, childStart: 0, childEnd: 0,
        angleBase: 0, angleTip: 0, lenRatio: 0, lenJitter: 0, radRatio: 0,
        segs: 5, wander: 0.1, gravitropism: 0.02, droop: 0, tipCurl: 0,
        taper: 0.8,
      },
      {
        density: 2.6, whorl: 0, childStart: 0.3, childEnd: 0.92,
        angleBase: 1.0, angleTip: 0.7, lenRatio: 0.72, lenJitter: 0.22, radRatio: 0.4,
        segs: 5, wander: 0.1, gravitropism: 0.02, droop: 0.55, tipCurl: 0,
        taper: 1.0,
      },
      {
        density: 3.0, whorl: 0, childStart: 0.3, childEnd: 0.98,
        angleBase: 1.15, angleTip: 0.9, lenRatio: 0.6, lenJitter: 0.28, radRatio: 0.36,
        segs: 4, wander: 0.08, gravitropism: -0.16, droop: 1.5, tipCurl: 0,
        taper: 1.0,
      },
    ],
    foliage: {
      kind: "leafCluster",
      anchorLevel: 2,
      spacing: 0.2,
      tStart: 0.1,
      scale: [0.46, 0.7],
      tilt: 0.5,
      clusterSize: [5, 8],
      normalBend: 0.4,
      planarLeaves: true,
      color: [0.28, 0.42, 0.16],
      hueVar: 0.3,
      anchorTarget: 1600,
      card: { mode: "cross", sizeK: 1.3 },
      leaf: { len: 0.17, width: 0.024, shapePow: 1.7, fold: 0.25, curl: 0.4, needleCount: 0, brush: 0 },
    },
    flare: { amp: 0.4, height: 0.7, lobes: 3 },
    bark: [0.34, 0.28, 0.21],
    barkStyle: "beech",
  },

  /** 杉:锥形冠,轮生近水平枝 + 平面针叶梳 */
  conifer: {
    id: "conifer",
    height: [10, 18],
    trunkRadiusK: 0.02,
    crown: "cone",
    asym: 0.12,
    levels: [
      {
        density: 0, whorl: 0, childStart: 0, childEnd: 0,
        angleBase: 0, angleTip: 0, lenRatio: 0, lenJitter: 0, radRatio: 0,
        segs: 7, wander: 0.02, gravitropism: 0.05, droop: 0, tipCurl: 0,
        taper: 0.9,
      },
      {
        density: 3.6, whorl: 5, childStart: 0.16, childEnd: 0.97,
        angleBase: 1.5, angleTip: 1.05, lenRatio: 0.32, lenJitter: 0.18, radRatio: 0.34,
        segs: 4, wander: 0.06, gravitropism: 0, droop: 0.36, tipCurl: 0.16,
        taper: 1.0, planar: 0.15,
      },
    ],
    foliage: {
      kind: "needleSpray",
      anchorLevel: 1,
      spacing: 0.14,
      tStart: 0.14,
      scale: [0.52, 0.78],
      tilt: 0.5,
      clusterSize: [0, 0],
      normalBend: 0.45,
      planarLeaves: true,
      color: [0.11, 0.2, 0.09],
      hueVar: 0.25,
      anchorTarget: 1200,
      card: { mode: "lying", sizeK: 2.0 },
      leaf: { len: 0.105, width: 0.013, shapePow: 1, fold: 0, curl: 0, needleCount: 26, brush: 0 },
    },
    flare: { amp: 0.35, height: 0.8, lobes: 5 },
    bark: [0.28, 0.22, 0.16],
    barkStyle: "spruce",
  },

  /** 高山冷杉:窄锥冠,密轮生短枝,针叶半刷状,梢端上翘 */
  alpineFir: {
    id: "alpineFir",
    height: [6, 11],
    trunkRadiusK: 0.022,
    crown: "cone",
    asym: 0.08,
    levels: [
      {
        density: 0, whorl: 0, childStart: 0, childEnd: 0,
        angleBase: 0, angleTip: 0, lenRatio: 0, lenJitter: 0, radRatio: 0,
        segs: 7, wander: 0.015, gravitropism: 0.06, droop: 0, tipCurl: 0,
        taper: 0.95,
      },
      {
        density: 4.4, whorl: 6, childStart: 0.12, childEnd: 0.98,
        angleBase: 1.38, angleTip: 0.95, lenRatio: 0.24, lenJitter: 0.16, radRatio: 0.32,
        segs: 4, wander: 0.05, gravitropism: 0, droop: 0.5, tipCurl: 0.3,
        taper: 1.0, planar: 0.2,
      },
    ],
    foliage: {
      kind: "needleSpray",
      anchorLevel: 1,
      spacing: 0.12,
      tStart: 0.12,
      scale: [0.38, 0.58],
      tilt: 0.42,
      clusterSize: [0, 0],
      normalBend: 0.5,
      planarLeaves: true,
      color: [0.09, 0.17, 0.09],
      hueVar: 0.2,
      anchorTarget: 1200,
      card: { mode: "lying", sizeK: 1.8 },
      leaf: { len: 0.075, width: 0.011, shapePow: 1, fold: 0, curl: 0, needleCount: 30, brush: 0.35 },
    },
    flare: { amp: 0.3, height: 0.6, lobes: 4 },
    bark: [0.24, 0.2, 0.16],
    barkStyle: "spruce",
  },

  /** 梭梭:不规则多歧矮树,细碎刷状叶(干旱生境) */
  saxaul: {
    id: "saxaul",
    height: [2.5, 4.5],
    trunkRadiusK: 0.05,
    crown: "irregular",
    asym: 0.35,
    levels: [
      {
        density: 0, whorl: 0, childStart: 0, childEnd: 0,
        angleBase: 0, angleTip: 0, lenRatio: 0, lenJitter: 0, radRatio: 0,
        segs: 5, wander: 0.28, gravitropism: 0.02, droop: 0, tipCurl: 0,
        taper: 0.75,
      },
      {
        density: 4.5, whorl: 0, childStart: 0.12, childEnd: 0.85,
        angleBase: 1.15, angleTip: 0.75, lenRatio: 0.75, lenJitter: 0.35, radRatio: 0.45,
        segs: 4, wander: 0.28, gravitropism: 0.04, droop: 0.16, tipCurl: 0,
        taper: 0.9,
      },
      {
        density: 3.2, whorl: 0, childStart: 0.3, childEnd: 0.95,
        angleBase: 0.9, angleTip: 0.6, lenRatio: 0.55, lenJitter: 0.4, radRatio: 0.42,
        segs: 3, wander: 0.34, gravitropism: -0.04, droop: 0.28, tipCurl: 0,
        taper: 1.0,
      },
    ],
    foliage: {
      kind: "needleSpray",
      anchorLevel: 2,
      spacing: 0.2,
      tStart: 0.25,
      scale: [0.2, 0.34],
      tilt: 0.8,
      clusterSize: [0, 0],
      normalBend: 0.3,
      color: [0.32, 0.36, 0.2],
      hueVar: 0.35,
      anchorTarget: 500,
      card: { mode: "cross", sizeK: 1.2 },
      leaf: { len: 0.06, width: 0.009, shapePow: 1, fold: 0, curl: 0, needleCount: 14, brush: 1 },
    },
    flare: { amp: 0.25, height: 0.35, lobes: 3 },
    bark: [0.42, 0.36, 0.28],
    barkStyle: "gnarl",
  },
};

/** 每树种结构变体数(变体 = 不同生长 seed → 不同分枝结构) */
export const VARIANTS_PER_SPECIES = 4;

/** 灌木:从近地面多歧分枝的小型穹顶冠(同一套文法) */
export const SHRUB: SpeciesParams = {
  id: "broadleaf",
  height: [0.8, 1.8],
  trunkRadiusK: 0.035,
  crown: "dome",
  asym: 0.25,
  levels: [
    {
      density: 0, whorl: 0, childStart: 0, childEnd: 0,
      angleBase: 0, angleTip: 0, lenRatio: 0, lenJitter: 0, radRatio: 0,
      segs: 3, wander: 0.14, gravitropism: 0.02, droop: 0, tipCurl: 0,
      taper: 0.7,
    },
    {
      density: 13.0, whorl: 0, childStart: 0.04, childEnd: 0.78,
      angleBase: 1.05, angleTip: 0.7, lenRatio: 0.95, lenJitter: 0.3, radRatio: 0.5,
      segs: 3, wander: 0.2, gravitropism: 0.05, droop: 0.3, tipCurl: 0,
      taper: 0.9,
    },
  ],
  foliage: {
    kind: "leafCluster",
    anchorLevel: 1,
    spacing: 0.05,
    tStart: 0.08,
    scale: [0.3, 0.48],
    tilt: 0.7,
    clusterSize: [5, 8],
    normalBend: 0.5,
    color: [0.24, 0.36, 0.14],
    hueVar: 0.35,
    anchorTarget: 600,
    card: { mode: "cross", sizeK: 1.8 },
    leaf: { len: 0.1, width: 0.055, shapePow: 1.1, fold: 0.3, curl: 0.25, needleCount: 0, brush: 0 },
  },
  flare: { amp: 0.2, height: 0.2, lobes: 3 },
  bark: [0.3, 0.25, 0.18],
  barkStyle: "beech",
};
