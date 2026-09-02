/**
 * FishSchools — 专用 TSL 淡水鱼群系统。
 *
 * 每条鱼是一个带截面轮廓的纺锤形网格(吻/尾盖 + 8 边截面 × 11 站位 +
 * 叉形尾鳍/背鳍/臀鳍/胸鳍),全部姿态在顶点着色器里由专用 TSL 驱动:
 *   - 游泳行波:沿体轴的正弦行波,幅度向尾部平方增长,频率随游速自适应;
 *   - 转向弯体:由路径曲率(数值微分)得到偏航率,施加沿体轴的静态弯曲;
 *   - 俯仰/侧倾:朝向基 = 路径切线的正交标架,转弯时向弯心滚转(banking);
 *   - 鳍摆:尾鳍幅度增益、胸鳍独立拍动(顶点属性 aFin 区分部位)。
 *
 * 鱼群控制:boot 时在深水 texel 选聚集点,按水深分配鱼种(8 种常见淡水鱼:
 * 草鱼/青鱼/鲢/鳙/鲤/鲫/鲈/锦鲤),每群约十余至上百条。每群独立采样一族控制算法:
 *   0 椭圆巡游(草/青/鲢,鲢为小半径快转的"盘旋群");
 *   1 Lissajous 游弋(鳙/鲤/鲫/锦鲤,双频不可通约 → 不重复的漫游路径);
 *   2 伏击冲刺(鲈:原地小幅游弋 + 周期性向随机方向的快速突刺)。
 * 群内个体 = 领队路径的"时滞采样"(follow-the-leader)+ 队形横/纵向偏移
 * (纵队/球群/环游/散层/猎群五种分布),天然形成真实的跟随转弯。
 *
 * 每个鱼群上方竖一根加色混合光柱(按鱼种配色),实时跟踪群中心,方便寻找。
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  DoubleSide,
  FloatType,
  Group,
  InstancedMesh,
  LinearFilter,
  Mesh,
  NearestFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  attribute,
  clamp,
  cos,
  float,
  instanceIndex,
  ivec2,
  mix,
  normalLocal,
  positionLocal,
  sin,
  smoothstep,
  texture,
  textureLoad,
  uv,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import { hash2 } from "../gpu/noise";
import { WATER_NONE } from "../gpu/pipeline";
import type { NF, NV3, NV4 } from "../gpu/tsl-types";
import type { EnvState } from "../render/env";
import {
  sampleFloatBilinear,
  sampleWaterLevel,
  type WorldTextures,
} from "../render/fields";
import type { WorldFields } from "../types";
import { makeRng } from "../veg/treeBuilder";

// ---------------------------------------------------------------------------
// 鱼种定义
// ---------------------------------------------------------------------------

type Formation = "column" | "ball" | "mill" | "layer" | "pack";

type SpeciesDef = {
  name: string;
  /** 体长范围 m */
  len: [number, number];
  /** 体高/体宽系数(相对基准纺锤) */
  heightK: [number, number];
  widthK: [number, number];
  back: [number, number, number];
  belly: [number, number, number];
  accent: [number, number, number];
  /** 0 素色 1 锦鲤斑块 2 深色横带 3 深色云斑 */
  pattern: number;
  school: [number, number];
  formation: Formation;
  /** 0 椭圆巡游 1 Lissajous 游弋 2 伏击冲刺 */
  behavior: 0 | 1 | 2;
  /** 线速度范围 m/s */
  speed: [number, number];
  /** 最小水深要求 */
  minDepth: number;
  /** 巡游深度系数(0 贴水面 ~ 1 贴底) */
  cruiseK: number;
  beam: [number, number, number];
  /** 鳞片纹理强度 0..1(无鳞鱼 = 0) */
  rim: number;
};

const SPECIES: SpeciesDef[] = [
  {
    name: "草鱼",
    len: [0.5, 0.85],
    heightK: [0.92, 1.02],
    widthK: [1.0, 1.12],
    back: [0.2, 0.26, 0.1],
    belly: [0.9, 0.88, 0.74],
    accent: [0.1, 0.12, 0.06],
    pattern: 0,
    school: [12, 24],
    formation: "column",
    behavior: 0,
    speed: [0.45, 0.75],
    minDepth: 1.2,
    cruiseK: 0.55,
    beam: [0.3, 1.0, 0.45],
    rim: 0.85,
  },
  {
    name: "青鱼",
    len: [0.6, 1.0],
    heightK: [0.95, 1.05],
    widthK: [1.0, 1.1],
    back: [0.05, 0.07, 0.1],
    belly: [0.4, 0.44, 0.48],
    accent: [0.03, 0.04, 0.05],
    pattern: 0,
    school: [8, 14],
    formation: "pack",
    behavior: 0,
    speed: [0.4, 0.65],
    minDepth: 2.2,
    cruiseK: 0.75,
    beam: [0.25, 0.5, 1.0],
    rim: 0.7,
  },
  {
    name: "鲢鱼",
    len: [0.45, 0.7],
    heightK: [1.05, 1.18],
    widthK: [0.82, 0.92],
    back: [0.3, 0.4, 0.48],
    belly: [0.95, 0.96, 0.97],
    accent: [0.2, 0.25, 0.28],
    pattern: 0,
    school: [36, 64],
    formation: "mill",
    behavior: 0,
    speed: [0.7, 1.1],
    minDepth: 1.5,
    cruiseK: 0.35,
    beam: [0.3, 0.95, 1.0],
    rim: 0.55,
  },
  {
    name: "鳙鱼",
    len: [0.55, 0.85],
    heightK: [1.12, 1.25],
    widthK: [0.95, 1.05],
    back: [0.2, 0.22, 0.24],
    belly: [0.58, 0.6, 0.58],
    accent: [0.06, 0.07, 0.08],
    pattern: 3,
    school: [14, 24],
    formation: "ball",
    behavior: 1,
    speed: [0.35, 0.6],
    minDepth: 2.0,
    cruiseK: 0.55,
    beam: [0.7, 0.4, 1.0],
    rim: 0.5,
  },
  {
    name: "鲤鱼",
    len: [0.4, 0.7],
    heightK: [1.1, 1.22],
    widthK: [1.05, 1.18],
    back: [0.4, 0.22, 0.07],
    belly: [0.92, 0.8, 0.5],
    accent: [0.72, 0.28, 0.1],
    pattern: 0,
    school: [10, 20],
    formation: "pack",
    behavior: 1,
    speed: [0.3, 0.55],
    minDepth: 1.0,
    cruiseK: 0.7,
    beam: [1.0, 0.65, 0.2],
    rim: 0.95,
  },
  {
    name: "鲫鱼",
    len: [0.15, 0.28],
    heightK: [1.15, 1.3],
    widthK: [0.85, 0.95],
    back: [0.33, 0.36, 0.34],
    belly: [0.78, 0.8, 0.78],
    accent: [0.2, 0.22, 0.2],
    pattern: 0,
    school: [24, 42],
    formation: "ball",
    behavior: 1,
    speed: [0.3, 0.55],
    minDepth: 0.15, // 鲫鱼耐浅水:浅湖/溪流的兜底鱼种
    cruiseK: 0.45,
    beam: [0.9, 0.95, 1.0],
    rim: 0.7,
  },
  {
    name: "鲈鱼",
    len: [0.3, 0.5],
    heightK: [1.0, 1.1],
    widthK: [0.9, 1.0],
    back: [0.17, 0.21, 0.17],
    belly: [0.66, 0.7, 0.66],
    accent: [0.05, 0.06, 0.05],
    pattern: 2,
    school: [8, 14],
    formation: "pack",
    behavior: 2,
    speed: [0.25, 0.45],
    minDepth: 1.2,
    cruiseK: 0.65,
    beam: [1.0, 0.3, 0.25],
    rim: 0.45,
  },
  {
    name: "锦鲤",
    len: [0.35, 0.6],
    heightK: [1.08, 1.2],
    widthK: [1.05, 1.15],
    back: [0.94, 0.92, 0.88],
    belly: [0.97, 0.95, 0.92],
    accent: [0.86, 0.14, 0.05],
    pattern: 1,
    school: [12, 26],
    formation: "layer",
    behavior: 1,
    speed: [0.25, 0.45],
    minDepth: 0.4,
    cruiseK: 0.25,
    beam: [1.0, 0.8, 0.25],
    rim: 0.6,
  },
  {
    name: "鳊鱼",
    len: [0.3, 0.5],
    heightK: [1.35, 1.5],
    widthK: [0.68, 0.78],
    back: [0.32, 0.36, 0.38],
    belly: [0.8, 0.83, 0.84],
    accent: [0.15, 0.18, 0.2],
    pattern: 0,
    school: [18, 32],
    formation: "layer",
    behavior: 1,
    speed: [0.3, 0.5],
    minDepth: 1.0,
    cruiseK: 0.5,
    beam: [0.6, 1.0, 0.7],
    rim: 0.65,
  },
  {
    name: "翘嘴鲌",
    len: [0.35, 0.65],
    heightK: [0.78, 0.88],
    widthK: [0.72, 0.82],
    back: [0.38, 0.44, 0.5],
    belly: [0.85, 0.88, 0.9],
    accent: [0.25, 0.3, 0.35],
    pattern: 0,
    school: [12, 22],
    formation: "pack",
    behavior: 2,
    speed: [0.55, 0.95],
    minDepth: 1.2,
    cruiseK: 0.2,
    beam: [0.5, 0.8, 1.0],
    rim: 0.5,
  },
  {
    name: "鳜鱼",
    len: [0.25, 0.45],
    heightK: [1.15, 1.28],
    widthK: [0.95, 1.05],
    back: [0.34, 0.27, 0.12],
    belly: [0.7, 0.62, 0.42],
    accent: [0.1, 0.08, 0.04],
    pattern: 3,
    school: [6, 10],
    formation: "pack",
    behavior: 2,
    speed: [0.2, 0.35],
    minDepth: 1.5,
    cruiseK: 0.85,
    beam: [1.0, 0.5, 0.15],
    rim: 0.3,
  },
  {
    name: "黄颡鱼",
    len: [0.15, 0.3],
    heightK: [0.95, 1.05],
    widthK: [1.0, 1.15],
    back: [0.3, 0.26, 0.08],
    belly: [0.75, 0.65, 0.3],
    accent: [0.12, 0.1, 0.03],
    pattern: 3,
    school: [10, 18],
    formation: "pack",
    behavior: 1,
    speed: [0.2, 0.4],
    minDepth: 0.4,
    cruiseK: 0.95,
    beam: [1.0, 0.95, 0.3],
    rim: 0, // 无鳞
  },
];

// ---------------------------------------------------------------------------
// CPU 程序绘制皮肤图集(百科/FishBase 侧面作色参考,不采样照片):
// 与 buildTreeGeometry(species, seed) 相同:每种只给调色板/鳞式,每条鱼一颗种子单独画完。
//   u: 0 吻 → 1 尾; v: 0~0.80 身体展开(0 背、0.5 腹),0.82~1.0 鳍条带
// ---------------------------------------------------------------------------

const TILE_W = 128;
const TILE_H = 80;
const ATLAS_MAX = 4096;
/** 参数纹理高度 = 鱼数,必须 < 默认 maxTextureDimension2D(8192) */
const MAX_FISH = 4096;
/** 每种独立皮肤块数(种子长出,不是 4 套轮换) */
const SKIN_PER_SPEC = 16;

function packSkinAtlas(n: number): {
  cols: number;
  rows: number;
  tw: number;
  th: number;
} {
  let tw = TILE_W;
  let th = TILE_H;
  let count = Math.max(n, 1);
  for (let i = 0; i < 12; i++) {
    const cols = Math.max(1, Math.min(count, Math.floor(ATLAS_MAX / tw)));
    const rows = Math.ceil(count / cols);
    if (cols * tw <= ATLAS_MAX && rows * th <= ATLAS_MAX) {
      return { cols, rows, tw, th };
    }
    if (th > 40) th = Math.floor(th / 2);
    else if (tw > 40) tw = Math.floor(tw / 2);
    else {
      const maxTiles = Math.max(1, Math.floor(ATLAS_MAX / tw) * Math.floor(ATLAS_MAX / th));
      count = Math.min(count, maxTiles);
      const c = Math.max(1, Math.min(count, Math.floor(ATLAS_MAX / tw)));
      return { cols: c, rows: Math.ceil(count / c), tw, th };
    }
  }
  return { cols: 1, rows: 1, tw: 64, th: 40 };
}

function hash01(x: number, y: number, s: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + s * 17.17) * 43758.5453;
  return n - Math.floor(n);
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

function fbmCpu(x: number, y: number, s: number): number {
  return (
    vnoise(x, y, s) * 0.5 +
    vnoise(x * 2.1, y * 2.1, s + 3) * 0.25 +
    vnoise(x * 4.3, y * 4.3, s + 7) * 0.125
  );
}

type Rgb = [number, number, number];

type ScaleStyle = "net" | "crescent" | "fine" | "none";

type SkinPal = {
  back: Rgb;
  side: Rgb;
  belly: Rgb;
  fin: Rgb;
  iris: Rgb;
  /** 沿体轴鳞数;0 = 无鳞 */
  nU: number;
  nV: number;
  /** 鳞后缘压暗 0..1 */
  edge: number;
  /** 银白金属光泽 0..1 */
  metallic: number;
  scale: ScaleStyle;
  /** plain / koi / bars / mottle / mandarin / catfish */
  kind: "plain" | "koi" | "bars" | "mottle" | "mandarin" | "catfish";
};

/** 体色对照百科/FishBase 侧面:只作绘制参考,不采样照片 */
function skinPal(name: string): SkinPal {
  switch (name) {
    case "草鱼":
      // 橄榄褐背→青铜侧→乳白腹,大圆鳞后缘成网
      return {
        back: [0.26, 0.28, 0.16],
        side: [0.7, 0.58, 0.28],
        belly: [0.94, 0.9, 0.78],
        fin: [0.3, 0.28, 0.18],
        iris: [0.52, 0.38, 0.1],
        nU: 38,
        nV: 11,
        edge: 0.78,
        metallic: 0.2,
        scale: "net",
        kind: "plain",
      };
    case "青鱼":
      // 铅黑背侧、灰白腹、各鳍近黑,鳞后缘新月
      return {
        back: [0.07, 0.08, 0.11],
        side: [0.16, 0.2, 0.24],
        belly: [0.48, 0.52, 0.56],
        fin: [0.05, 0.055, 0.07],
        iris: [0.34, 0.28, 0.1],
        nU: 38,
        nV: 11,
        edge: 0.94,
        metallic: 0.08,
        scale: "crescent",
        kind: "plain",
      };
    case "鲢鱼":
      // 橄榄灰背、通体亮银、极细鳞、鳍浅灰
      return {
        back: [0.28, 0.32, 0.3],
        side: [0.86, 0.9, 0.93],
        belly: [0.96, 0.97, 0.97],
        fin: [0.7, 0.72, 0.74],
        iris: [0.78, 0.78, 0.8],
        nU: 100,
        nV: 30,
        edge: 0.12,
        metallic: 0.42,
        scale: "fine",
        kind: "plain",
      };
    case "鳙鱼":
      // 花鲢:铅褐背、银白侧、上半部不规则墨斑、细鳞
      return {
        back: [0.16, 0.16, 0.15],
        side: [0.72, 0.74, 0.74],
        belly: [0.94, 0.94, 0.92],
        fin: [0.22, 0.22, 0.22],
        iris: [0.42, 0.32, 0.1],
        nU: 92,
        nV: 28,
        edge: 0.14,
        metallic: 0.22,
        scale: "fine",
        kind: "mottle",
      };
    case "鲤鱼":
      // 橄榄褐背、金铜侧、乳白腹,大鳞后缘黑新月,鳍橙红
      return {
        back: [0.28, 0.22, 0.1],
        side: [0.78, 0.52, 0.16],
        belly: [0.94, 0.86, 0.6],
        fin: [0.78, 0.28, 0.1],
        iris: [0.62, 0.42, 0.08],
        nU: 24,
        nV: 10,
        edge: 0.96,
        metallic: 0.22,
        scale: "crescent",
        kind: "plain",
      };
    case "鲫鱼":
      // 橄榄褐背、金银侧、白腹,规则网鳞
      return {
        back: [0.28, 0.26, 0.16],
        side: [0.72, 0.68, 0.42],
        belly: [0.93, 0.93, 0.9],
        fin: [0.36, 0.3, 0.2],
        iris: [0.55, 0.5, 0.28],
        nU: 34,
        nV: 14,
        edge: 0.7,
        metallic: 0.24,
        scale: "net",
        kind: "plain",
      };
    case "鲈鱼":
      // 加州鲈:橄榄背、银灰侧、不规则纵带、乳白腹
      return {
        back: [0.16, 0.2, 0.12],
        side: [0.58, 0.6, 0.42],
        belly: [0.9, 0.9, 0.84],
        fin: [0.18, 0.2, 0.16],
        iris: [0.62, 0.46, 0.1],
        nU: 58,
        nV: 18,
        edge: 0.28,
        metallic: 0.1,
        scale: "fine",
        kind: "bars",
      };
    case "锦鲤":
      // 红白 Kohaku:奶油白底 + 朱红大斑
      return {
        back: [0.95, 0.93, 0.88],
        side: [0.97, 0.95, 0.9],
        belly: [0.98, 0.97, 0.94],
        fin: [0.94, 0.9, 0.86],
        iris: [0.62, 0.42, 0.1],
        nU: 24,
        nV: 11,
        edge: 0.48,
        metallic: 0.14,
        scale: "net",
        kind: "koi",
      };
    case "鳊鱼":
      // 橄榄背、亮银侧、白腹,中鳞网纹,尾缘略深
      return {
        back: [0.28, 0.3, 0.26],
        side: [0.82, 0.84, 0.84],
        belly: [0.95, 0.96, 0.96],
        fin: [0.55, 0.52, 0.5],
        iris: [0.7, 0.62, 0.28],
        nU: 48,
        nV: 16,
        edge: 0.38,
        metallic: 0.32,
        scale: "fine",
        kind: "plain",
      };
    case "翘嘴鲌":
      // 炭黑背脊、铬银体侧、尾鳍深、腹鳍浅黄
      return {
        back: [0.18, 0.2, 0.22],
        side: [0.88, 0.9, 0.93],
        belly: [0.96, 0.97, 0.97],
        fin: [0.22, 0.24, 0.26],
        iris: [0.78, 0.78, 0.8],
        nU: 64,
        nV: 16,
        edge: 0.18,
        metallic: 0.4,
        scale: "fine",
        kind: "plain",
      };
    case "鳜鱼":
      // 黄褐底、不规则暗云斑、过眼斜纹、细鳞、斑鳍
      return {
        back: [0.42, 0.34, 0.14],
        side: [0.72, 0.58, 0.26],
        belly: [0.9, 0.84, 0.62],
        fin: [0.62, 0.5, 0.22],
        iris: [0.62, 0.46, 0.1],
        nU: 72,
        nV: 24,
        edge: 0.16,
        metallic: 0.08,
        scale: "fine",
        kind: "mandarin",
      };
    case "黄颡鱼":
      // 无鳞:橄榄背、饱和黄侧、三道断续暗带、鳍灰黑
      return {
        back: [0.32, 0.28, 0.1],
        side: [0.9, 0.72, 0.16],
        belly: [0.96, 0.9, 0.55],
        fin: [0.1, 0.09, 0.07],
        iris: [0.5, 0.36, 0.08],
        nU: 0,
        nV: 0,
        edge: 0,
        metallic: 0.1,
        scale: "none",
        kind: "catfish",
      };
    default:
      return {
        back: [0.3, 0.3, 0.28],
        side: [0.55, 0.55, 0.5],
        belly: [0.8, 0.8, 0.78],
        fin: [0.3, 0.3, 0.28],
        iris: [0.55, 0.45, 0.14],
        nU: 30,
        nV: 14,
        edge: 0.4,
        metallic: 0.1,
        scale: "net",
        kind: "plain",
      };
  }
}

function lerp3(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.min(Math.max(t, 0), 1);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

type MouthSpec = {
  /** 张度 */
  gape: number;
  /** -1 下位口, 0 端位, 1 上位口 */
  pitch: number;
  /** 口裂后延(鲈/鳜大) */
  reach: number;
  /** 须 0 无, 1 口角一对, 2 多对 */
  barb: number;
  tSnout: number;
  tCorner: number;
  uCorner: number;
  cavity: number;
};

function mouthSpec(name: string): MouthSpec {
  switch (name) {
    case "翘嘴鲌":
      return { gape: 1.42, pitch: 1.0, reach: 1.3, barb: 0, tSnout: 0.32, tCorner: 0.22, uCorner: 0.11, cavity: 0.032 };
    case "鳜鱼":
      return { gape: 1.92, pitch: 0.42, reach: 1.55, barb: 0, tSnout: 0.4, tCorner: 0.31, uCorner: 0.16, cavity: 0.04 };
    case "鲈鱼":
      return { gape: 1.82, pitch: 0.36, reach: 1.5, barb: 0, tSnout: 0.4, tCorner: 0.32, uCorner: 0.15, cavity: 0.036 };
    case "鲤鱼":
      return { gape: 1.12, pitch: -0.82, reach: 1.06, barb: 1, tSnout: 0.52, tCorner: 0.47, uCorner: 0.078, cavity: 0.02 };
    case "锦鲤":
      return { gape: 1.06, pitch: -0.64, reach: 1.04, barb: 1, tSnout: 0.5, tCorner: 0.46, uCorner: 0.074, cavity: 0.018 };
    case "黄颡鱼":
      return { gape: 0.9, pitch: -0.8, reach: 0.9, barb: 2, tSnout: 0.53, tCorner: 0.49, uCorner: 0.055, cavity: 0.014 };
    case "鲢鱼":
      return { gape: 1.2, pitch: 0.62, reach: 1.16, barb: 0, tSnout: 0.35, tCorner: 0.28, uCorner: 0.088, cavity: 0.022 };
    case "鳙鱼":
      return { gape: 1.5, pitch: 0.28, reach: 1.32, barb: 0, tSnout: 0.39, tCorner: 0.33, uCorner: 0.118, cavity: 0.028 };
    case "鳊鱼":
      return { gape: 0.78, pitch: 0.1, reach: 0.84, barb: 0, tSnout: 0.4, tCorner: 0.37, uCorner: 0.05, cavity: 0.011 };
    case "鲫鱼":
      return { gape: 0.88, pitch: 0.12, reach: 0.9, barb: 0, tSnout: 0.4, tCorner: 0.36, uCorner: 0.058, cavity: 0.013 };
    case "青鱼":
      return { gape: 0.98, pitch: 0.0, reach: 1.02, barb: 0, tSnout: 0.41, tCorner: 0.37, uCorner: 0.062, cavity: 0.014 };
    default:
      return { gape: 0.94, pitch: 0.06, reach: 0.96, barb: 0, tSnout: 0.4, tCorner: 0.36, uCorner: 0.062, cavity: 0.014 };
  }
}

/** 鳍形对照 FishBase / 鱼类志侧面:只作轮廓参考,不采样照片 */
type FinSpec = {
  /** 尾叉深度 0 圆尾 ~ 1.4 深叉 */
  fork: number;
  /** 尾叶外缘变圆 */
  round: number;
  /** 下叶相对上叶 */
  lower: number;
  /** 尾展 */
  span: number;
  /** 背鳍前缘 x(吻 +0.5) */
  d0: number;
  dLen: number;
  dH: number;
  /** 鲈/鳜:背鳍缺刻 0~1 */
  notch: number;
  a0: number;
  aLen: number;
  aH: number;
  adipose: number;
  pect: number;
  pelv: number;
  /** 腹鳍前移(鲈/鳜胸位) */
  pelvX: number;
  pectR: number;
};

function finSpec(name: string): FinSpec {
  switch (name) {
    case "鲤鱼":
      // FishBase: D 17–23 软条、长背鳍;尾深凹而非深叉
      return { fork: 0.72, round: 0.38, lower: 1.0, span: 1.02, d0: 0.18, dLen: 0.44, dH: 0.15, notch: 0, a0: -0.14, aLen: 0.17, aH: 0.11, adipose: 0, pect: 0.95, pelv: 1.0, pelvX: 0, pectR: 0.55 };
    case "锦鲤":
      return { fork: 0.52, round: 0.55, lower: 1.02, span: 1.12, d0: 0.17, dLen: 0.46, dH: 0.17, notch: 0, a0: -0.14, aLen: 0.2, aH: 0.13, adipose: 0, pect: 1.08, pelv: 1.12, pelvX: 0, pectR: 0.62 };
    case "鲫鱼":
      return { fork: 0.68, round: 0.42, lower: 1.0, span: 0.98, d0: 0.16, dLen: 0.4, dH: 0.16, notch: 0, a0: -0.14, aLen: 0.16, aH: 0.11, adipose: 0, pect: 0.92, pelv: 0.95, pelvX: 0, pectR: 0.5 };
    case "鲢鱼":
      // FishBase: D 7–10 无硬刺, A 11–17, 尾深叉, 胸鳍长镰刀
      return { fork: 1.22, round: 0.06, lower: 1.04, span: 1.08, d0: 0.06, dLen: 0.22, dH: 0.13, notch: 0, a0: -0.12, aLen: 0.24, aH: 0.12, adipose: 0, pect: 1.38, pelv: 1.15, pelvX: 0, pectR: 0.22 };
    case "鳙鱼":
      return { fork: 1.18, round: 0.08, lower: 1.02, span: 1.06, d0: 0.04, dLen: 0.22, dH: 0.13, notch: 0, a0: -0.12, aLen: 0.24, aH: 0.12, adipose: 0, pect: 1.52, pelv: 1.12, pelvX: 0, pectR: 0.2 };
    case "鳊鱼":
      // 体高菱形,背鳍高镰,臀鳍长
      return { fork: 1.12, round: 0.12, lower: 1.0, span: 1.06, d0: 0.1, dLen: 0.28, dH: 0.22, notch: 0, a0: -0.06, aLen: 0.34, aH: 0.17, adipose: 0, pect: 1.05, pelv: 1.0, pelvX: 0, pectR: 0.28 };
    case "翘嘴鲌":
      // 志:背鳍后位具硬刺,臀鳍 21–25,尾深叉下叶长,偶鳍浅黄、背尾灰黑
      return { fork: 1.38, round: 0.02, lower: 1.2, span: 1.04, d0: 0.0, dLen: 0.22, dH: 0.135, notch: 0, a0: -0.08, aLen: 0.36, aH: 0.145, adipose: 0, pect: 1.12, pelv: 0.92, pelvX: 0, pectR: 0.18 };
    case "鳜鱼":
      // FishBase/志:背鳍长前棘后软,胸鳍圆,尾圆形
      return { fork: 0.22, round: 0.88, lower: 1.0, span: 0.96, d0: 0.18, dLen: 0.42, dH: 0.185, notch: 0.72, a0: -0.14, aLen: 0.24, aH: 0.135, adipose: 0, pect: 0.88, pelv: 1.05, pelvX: 0.12, pectR: 0.7 };
    case "鲈鱼":
      return { fork: 0.58, round: 0.32, lower: 1.0, span: 1.0, d0: 0.17, dLen: 0.4, dH: 0.17, notch: 0.78, a0: -0.16, aLen: 0.22, aH: 0.12, adipose: 0, pect: 1.05, pelv: 1.08, pelvX: 0.1, pectR: 0.45 };
    case "黄颡鱼":
      // 鲿科:背鳍短具棘,脂鳍,尾中等分叉,胸鳍具棘
      return { fork: 0.82, round: 0.28, lower: 1.0, span: 0.92, d0: 0.12, dLen: 0.16, dH: 0.15, notch: 0, a0: -0.12, aLen: 0.26, aH: 0.12, adipose: 1, pect: 1.18, pelv: 0.9, pelvX: 0.04, pectR: 0.25 };
    case "青鱼":
      return { fork: 1.05, round: 0.12, lower: 1.0, span: 0.98, d0: 0.08, dLen: 0.24, dH: 0.125, notch: 0, a0: -0.12, aLen: 0.18, aH: 0.105, adipose: 0, pect: 1.0, pelv: 0.95, pelvX: 0, pectR: 0.4 };
    default:
      // 草鱼 FishBase: D 短 7–8 分枝,位于体中,尾深叉
      return { fork: 1.08, round: 0.14, lower: 1.0, span: 0.96, d0: 0.09, dLen: 0.23, dH: 0.12, notch: 0, a0: -0.12, aLen: 0.18, aH: 0.1, adipose: 0, pect: 0.98, pelv: 0.95, pelvX: 0, pectR: 0.42 };
  }
}

const DORSAL_X0 = 0.2;
const DORSAL_SPAN = 0.52;
const ANAL_X0 = -0.04;
const ANAL_SPAN = 0.36;
const FIN_COLS = 4;

function buildFinTex(): DataTexture {
  const n = SPECIES.length;
  const data = new Float32Array(n * FIN_COLS * 4);
  for (let i = 0; i < n; i++) {
    const f = finSpec((SPECIES[i] as SpeciesDef).name);
    const put = (col: number, x: number, y: number, z: number, w: number) => {
      const o = (i * FIN_COLS + col) * 4;
      data[o] = x;
      data[o + 1] = y;
      data[o + 2] = z;
      data[o + 3] = w;
    };
    put(0, f.fork, f.round, f.lower, f.span);
    put(1, f.d0, f.dLen, f.dH, f.notch);
    put(2, f.a0, f.aLen, f.aH, f.adipose);
    put(3, f.pect, f.pelv, f.pelvX, f.pectR);
  }
  const tex = new DataTexture(data, FIN_COLS, n, RGBAFormat, FloatType);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function distSeg(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let tt = l2 < 1e-10 ? 0 : ((px - ax) * dx + (py - ay) * dy) / l2;
  tt = Math.min(Math.max(tt, 0), 1);
  return Math.hypot(px - (ax + dx * tt), py - (ay + dy * tt));
}

function paintSkinTile(
  pix: Uint8Array,
  atlasW: number,
  ox: number,
  oy: number,
  tw: number,
  th: number,
  spec: SpeciesDef,
  vs: number,
): void {
  const pal = skinPal(spec.name);
  const sm = (t: number) => {
    const c = Math.min(Math.max(t, 0), 1);
    return c * c * (3 - 2 * c);
  };
  const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
  const mix = (a: number, b: number, k: number) => a + (b - a) * clamp01(k);
  // 与 buildTreeGeometry(sp, seed) 相同:种类只给调色板/鳞式,结构由种子长出
  const rng = makeRng(vs >>> 0);
  const nU0 = pal.nU * (0.42 + rng() * 1.35);
  const nV0 = pal.nV * (0.48 + rng() * 1.2);
  const uPh = (rng() - 0.5) * 0.28;
  const tPh = (rng() - 0.5) * 0.22;
  const stagK = 0.05 + rng() * 0.78;
  const eccX = 0.72 + rng() * 0.7;
  const eccY = 0.95 + rng() * 0.7;
  const shear = (rng() - 0.5) * 0.42;
  const hueJ = (rng() - 0.5) * 0.2;
  const lumJ = 0.84 + rng() * 0.34;
  const fbmSu = 1.2 + rng() * 3.6;
  const fbmSt = 0.7 + rng() * 2.8;
  const fbmOff = rng() * 90;
  const grainAmt = 0.08 + rng() * 0.18;
  const edgeMul = 0.62 + rng() * 0.7;
  const gillU0 = 0.108 + rng() * 0.04;
  const gillW = 4.4 + rng() * 2.8;
  const poreN = 18 + rng() * 42;
  const motFu = 1.4 + rng() * 3.2;
  const motFt = 0.9 + rng() * 2.6;
  const motThr = 0.36 + rng() * 0.28;
  const barUs: number[] = [];
  if (pal.kind === "bars") {
    const nBar = 3 + Math.floor(rng() * 6);
    for (let k = 0; k < nBar; k++) barUs.push(0.16 + rng() * 0.72);
  }
  const catUs: number[] = [];
  if (pal.kind === "catfish") {
    const nBar = 2 + Math.floor(rng() * 4);
    for (let k = 0; k < nBar; k++) catUs.push(0.22 + rng() * 0.62);
  }
  type KoiBlob = {
    cu: number;
    ct: number;
    rx: number;
    ry: number;
    rad: number;
    cr: number;
    cg: number;
    cb: number;
  };
  const koiBlobs: KoiBlob[] = [];
  if (pal.kind === "koi") {
    const nBlobs = 2 + Math.floor(rng() * 7);
    for (let k = 0; k < nBlobs; k++) {
      const black = rng() < 0.24;
      koiBlobs.push({
        cu: 0.1 + rng() * 0.78,
        ct: 0.03 + rng() * 0.44,
        rx: 1.05 + rng() * 2.5,
        ry: 1.15 + rng() * 2.3,
        rad: 0.1 + rng() * 0.4,
        cr: black ? 0.07 + rng() * 0.05 : 0.76 + rng() * 0.18,
        cg: black ? 0.05 + rng() * 0.04 : 0.07 + rng() * 0.14,
        cb: black ? 0.04 + rng() * 0.03 : 0.03 + rng() * 0.05,
      });
    }
  }

  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
        const u = x / (tw - 1);
        const fv = y / (th - 1);
        let r = 0;
        let g = 0;
        let b = 0;

        if (fv < 0.8) {
          const t = fv / 0.8;
          // t=0 背缝、t=0.5 腹、t=1 另一侧背缝 — 两侧必须对称,否则一半鱼只剩腹色
          const td = Math.min(t, 1 - t) * 2;
          const toSide = sm(td * 1.08);
          const toBelly = sm((td - 0.42) / 0.3);
          const colA = lerp3(pal.back, pal.side, toSide);
          const col = lerp3(colA, pal.belly, toBelly);
          r = col[0];
          g = col[1];
          b = col[2];

          // —— 斑纹:种子长出的斑块,不是 4 套预制图 ——
          if (pal.kind === "koi") {
            const halfT = Math.min(t, 1 - t);
            const w = fbmCpu(u * (1.2 + fbmSu * 0.2), halfT * 1.25, fbmOff + 4);
            let hi = 0;
            let cr = r;
            let cg = g;
            let cb = b;
            for (const blob of koiBlobs) {
              const k = sm(
                (blob.rad -
                  Math.hypot((u - blob.cu - w * 0.08) * blob.rx, (halfT - blob.ct) * blob.ry)) /
                  0.07,
              );
              hi = Math.min(1, hi + k);
              cr = mix(cr, blob.cr, k);
              cg = mix(cg, blob.cg, k);
              cb = mix(cb, blob.cb, k);
            }
            const wrap = 0.75 + 0.25 * sm(0.55 - halfT);
            r = mix(r, cr, hi * wrap);
            g = mix(g, cg, hi * wrap);
            b = mix(b, cb, hi * wrap);
            const rim = sm((hi - 0.12) / 0.08) * (1 - sm((hi - 0.55) / 0.1)) * wrap;
            r = mix(r, 0.52, rim * 0.55);
            g = mix(g, 0.06, rim * 0.55);
            b = mix(b, 0.02, rim * 0.55);
          } else if (pal.kind === "bars") {
            const blot =
              fbmCpu(u * motFu, t * motFt * 0.55, fbmOff + 9) * 0.7 +
              fbmCpu(u * motFu * 1.8, t * motFt, fbmOff + 13) * 0.3;
            let lat = 0;
            for (const uc of barUs) {
              lat = Math.max(lat, sm(1 - Math.abs(u - uc) * (4.2 + motFu)));
            }
            lat *=
              Math.max(
                sm(1 - Math.abs(t - 0.3) * 4.6),
                sm(1 - Math.abs(t - 0.7) * 4.6),
              ) *
              sm((u - 0.16) * 7) *
              sm((0.92 - u) * 7);
            const stripe = lat * sm((blot - motThr) / 0.14);
            r *= 1 - stripe * 0.68;
            g *= 1 - stripe * 0.58;
            b *= 1 - stripe * 0.62;
          } else if (pal.kind === "mottle") {
            const mot = fbmCpu(u * motFu, t * motFt, fbmOff + 19);
            const k = sm((mot - motThr) / 0.12) * sm(1.05 - td);
            r = mix(r, 0.12, k);
            g = mix(g, 0.12, k);
            b = mix(b, 0.11, k);
          } else if (pal.kind === "mandarin") {
            const blot = fbmCpu(u * motFu, t * motFt, fbmOff + 21);
            const k = sm((blot - motThr) / 0.09);
            r = mix(r, 0.15, k);
            g = mix(g, 0.09, k);
            b = mix(b, 0.035, k);
            const cellN = 8 + Math.floor(fbmSu * 3);
            const cellU = Math.floor(u * cellN);
            const cellT = Math.floor(t * (cellN * 0.7));
            const sp = Math.hypot(u * cellN - cellU - 0.5, t * (cellN * 0.7) - cellT - 0.5);
            const on = hash01(cellU, cellT, vs + 27) > 0.4 + hash01(vs, 2, 8) * 0.28;
            const dot = on ? sm((0.28 - sp) / 0.07) * 0.7 : 0;
            r *= 1 - dot;
            g *= 1 - dot;
            b *= 1 - dot * 0.9;
            const eyeSt =
              (sm(1 - Math.abs(t - 0.3) * 8.5) + sm(1 - Math.abs(t - 0.7) * 8.5)) *
              sm((0.3 - u) / 0.12) *
              sm((u - 0.05) / 0.04);
            r *= 1 - eyeSt * 0.82;
            g *= 1 - eyeSt * 0.82;
            b *= 1 - eyeSt * 0.74;
          } else if (pal.kind === "catfish") {
            for (const uc of catUs) {
              const broken = sm((fbmCpu(u * motFu * 1.6, t * motFt, fbmOff + 33) - 0.42) / 0.14);
              const bar =
                sm(1 - Math.abs(u - uc) * 6.4) *
                sm(1 - Math.abs(t - 0.5) * 1.35) *
                broken;
              r = mix(r, 0.2, bar);
              g = mix(g, 0.15, bar);
              b = mix(b, 0.05, bar);
            }
          } else {
            const mot = fbmCpu(u * fbmSu, t * fbmSt, fbmOff + 41);
            const k = (mot - 0.5) * grainAmt * sm(1.02 - td) * sm((u - 0.14) / 0.08);
            r += k * 0.35;
            g += k * 0.28;
            b += k * 0.18;
          }

          if (pal.metallic > 0.05) {
            const sheen =
              pal.metallic *
              Math.max(
                sm(1 - Math.abs(t - 0.28) * 3.4),
                sm(1 - Math.abs(t - 0.72) * 3.4),
              ) *
              (0.6 + 0.4 * sm(fbmCpu(u * 3.2, t * 1.4, vs + 8) - 0.35));
            r += sheen * 0.14;
            g += sheen * 0.17;
            b += sheen * 0.2;
          }

          // 叠瓦圆鳞:最近+次近距离 → 鳞缝成网,后缘加重新月
          if (pal.scale !== "none" && pal.nU > 0 && u > 0.135 && u < 0.94) {
            const fade = sm((u - 0.135) / 0.045) * sm((0.94 - u) / 0.05);
            const nU =
              nU0 * (1 + 0.38 * sm((0.26 - u) / 0.1) + 0.7 * sm((u - 0.8) / 0.1));
            const nV =
              nV0 * (1 + 0.3 * sm(Math.abs(t - 0.5) * 2.05 - 0.5));
            const uS = u + uPh;
            const tS = ((t + tPh) % 1 + 1) % 1;
            let bestD = 9;
            let secondD = 9;
            let bestFx = 0;
            let bestFy = 0;
            let bestSeed = 0.5;
            const row0 = Math.floor(tS * nV);
            const col0 = Math.floor(uS * nU);
            for (let dr = -1; dr <= 1; dr++) {
              for (let dc = -1; dc <= 1; dc++) {
                const row = row0 + dr;
                const stagger = (row & 1) * stagK;
                const col = col0 + dc;
                const cx = (col + 0.5 + stagger) / nU;
                const cy = (row + 0.5) / nV;
                const dx = (uS - cx) * nU + (tS - cy) * nV * shear;
                const dy = (tS - cy) * nV;
                const d = Math.hypot(dx * eccX, dy * eccY);
                if (d < bestD) {
                  secondD = bestD;
                  bestD = d;
                  bestFx = dx;
                  bestFy = dy;
                  bestSeed = hash01(col, row, vs + 5);
                } else if (d < secondD) {
                  secondD = d;
                }
              }
            }
            const gap = Math.max(secondD - bestD, 1e-4);
            const seam = sm(1 - gap * 6.4);
            const rear = sm((bestFx + 0.04) / 0.4);
            const dorsK = 0.4 + 0.6 * sm(Math.abs(t - 0.5) * 1.65);
            const varK = (bestSeed - 0.5) * 0.08 * fade;
            r += varK;
            g += varK * 0.9;
            b += varK * 0.75;
            if (pal.scale === "crescent") {
              const cres =
                rear *
                sm((bestD - 0.3) / 0.2) *
                (1 - sm((bestD - 0.8) / 0.1)) *
                pal.edge *
                edgeMul *
                fade *
                dorsK;
              const k = Math.max(cres, seam * rear * pal.edge * edgeMul * fade * 0.5);
              r *= 1 - k * 0.9;
              g *= 1 - k * 0.86;
              b *= 1 - k * 0.74;
            } else if (pal.scale === "net") {
              const k = seam * pal.edge * edgeMul * fade * dorsK * (0.38 + 0.62 * rear);
              r *= 1 - k * 0.82;
              g *= 1 - k * 0.76;
              b *= 1 - k * 0.64;
            } else {
              const k = seam * pal.edge * edgeMul * fade * 0.26;
              r *= 1 - k;
              g *= 1 - k;
              b *= 1 - k * 0.9;
            }
            const hl =
              sm((0.26 - Math.hypot(bestFx + 0.2, bestFy + 0.1)) / 0.22) *
              fade *
              (0.05 + pal.metallic * 0.18);
            r += hl * 0.9;
            g += hl;
            b += hl * 0.72;
            const lift = sm(0.5 - bestD) * fade * 0.07;
            r += lift;
            g += lift * 0.95;
            b += lift * 0.8;
          }

          if (pal.kind !== "catfish") {
            const side =
              Math.max(
                1 - Math.min(Math.abs(t - 0.28) * 42, 1),
                1 - Math.min(Math.abs(t - 0.72) * 42, 1),
              ) *
              sm((u - 0.2) * 10) *
              sm((0.88 - u) * 10);
            const pores = 0.45 + 0.55 * Math.sin(u * poreN * 2.1);
            r *= 1 - side * pores * 0.16;
            g *= 1 - side * pores * 0.16;
            b *= 1 - side * pores * 0.13;
          }

          const eyeT = spec.name === "鲢鱼" || spec.name === "鳙鱼" ? 0.35 : 0.26;

          // 头部:无鳞骨板,吻部略深
          const headK = sm((0.16 - u) / 0.045);
          if (headK > 0.02) {
            const hcol = lerp3(pal.back, pal.side, sm(td * 1.05));
            r = mix(r, hcol[0] * 0.92, headK * 0.55);
            g = mix(g, hcol[1] * 0.92, headK * 0.55);
            b = mix(b, hcol[2] * 0.92, headK * 0.55);
          }

          // 鳃盖画在体侧(t≈0.28/0.72),不是腹面
          const opT = t < 0.5 ? 0.28 : 0.72;
          const opU = gillU0 + 0.03 * Math.cos((t - opT) * 8);
          const opC = Math.hypot((u - (gillU0 - 0.037)) * gillW, (t - opT) * 2.4);
          const plate =
            sm((0.42 - opC) / 0.1) *
            sm((u - 0.075) / 0.02) *
            sm((opU + 0.02 - u) / 0.022) *
            sm(1 - Math.abs(t - opT) * 5.2);
          const gGold =
            spec.name === "鲤鱼" || spec.name === "鲫鱼" || spec.name === "草鱼"
              ? 0.2
              : 0.06;
          r = mix(r, pal.side[0] * 0.62 + 0.16 + gGold, plate * 0.58);
          g = mix(g, pal.side[1] * 0.62 + 0.12 + gGold * 0.7, plate * 0.58);
          b = mix(b, pal.side[2] * 0.62 + 0.05, plate * 0.58);
          const ring = 0.5 + 0.5 * Math.sin(opC * 24);
          r *= 1 - plate * ring * 0.11;
          g *= 1 - plate * ring * 0.11;
          b *= 1 - plate * ring * 0.08;
          const slit =
            (1 - Math.min(Math.abs(u - opU) * 78, 1)) * sm(1 - Math.abs(t - opT) * 5.5);
          r *= 1 - slit * 0.72;
          g *= 1 - slit * 0.72;
          b *= 1 - slit * 0.68;

          // 鼻孔:眼前方小凹
          for (const nt of [eyeT - 0.03, 1 - (eyeT - 0.03)]) {
            const nd = Math.hypot((u - 0.046) * 16, (t - nt) * 11);
            const naris = sm((0.032 - nd) / 0.012);
            r = mix(r, 0.07, naris);
            g = mix(g, 0.05, naris);
            b = mix(b, 0.04, naris);
          }

          // 口裂:上下颌夹出口腔,口角后延随种。上位口朝背、下位口朝腹
          const mo = mouthSpec(spec.name);
          const lipFlesh: Rgb =
            mo.pitch < -0.3
              ? [0.66, 0.42, 0.32]
              : mo.pitch > 0.5
                ? [0.74, 0.76, 0.78]
                : mo.gape > 1.4
                  ? [0.44, 0.34, 0.24]
                  : [pal.side[0] * 0.5 + 0.24, pal.side[1] * 0.4 + 0.17, pal.side[2] * 0.35 + 0.13];
          const lipW = 0.016 + mo.cavity * 0.7;
          for (const flank of [1, -1]) {
            const tS = flank > 0 ? mo.tSnout : 1 - mo.tSnout;
            const tC = flank > 0 ? mo.tCorner : 1 - mo.tCorner;
            const tU0 = tS - flank * mo.cavity * 0.55;
            const tU1 = tC - flank * mo.cavity * 0.38;
            const tL0 = tS + flank * mo.cavity * 0.95;
            const tL1 = tC + flank * mo.cavity * 0.78;
            const dU = distSeg(u, t, 0.006, tU0, mo.uCorner, tU1);
            const dL = distSeg(u, t, 0.008, tL0, mo.uCorner, tL1);
            if (u > 0.002 && u < mo.uCorner + 0.016) {
              const k = Math.min(Math.max(u / mo.uCorner, 0), 1);
              const tU = tU0 + (tU1 - tU0) * k;
              const tL = tL0 + (tL1 - tL0) * k;
              const lo = Math.min(tU, tL);
              const hi = Math.max(tU, tL);
              const cav =
                sm((t - lo) / 0.01) *
                sm((hi - t) / 0.01) *
                sm((mo.uCorner + 0.008 - u) / 0.014);
              r = mix(r, 0.04, cav * 0.98);
              g = mix(g, 0.018, cav * 0.98);
              b = mix(b, 0.014, cav * 0.98);
              const floor = cav * sm((t - lo) / (hi - lo + 1e-4)) * 0.4;
              r = mix(r, 0.2, floor);
              g = mix(g, 0.07, floor);
              b = mix(b, 0.05, floor);
            }
            const dLip = Math.min(dU, dL);
            const lip = sm((lipW - dLip) / (lipW * 0.62));
            r = mix(r, lipFlesh[0], lip * 0.94);
            g = mix(g, lipFlesh[1], lip * 0.94);
            b = mix(b, lipFlesh[2], lip * 0.94);
            const inner =
              sm((lipW * 0.42 - dLip) / (lipW * 0.2)) *
              (1 - sm((lipW * 0.16 - dLip) / 0.004));
            r *= 1 - inner * 0.38;
            g *= 1 - inner * 0.42;
            b *= 1 - inner * 0.45;
            const wet = sm((lipW * 0.2 - Math.abs(dLip - lipW * 0.55)) / 0.004);
            r = mix(r, Math.min(1, lipFlesh[0] + 0.22), wet * 0.48);
            g = mix(g, Math.min(1, lipFlesh[1] + 0.18), wet * 0.48);
            b = mix(b, Math.min(1, lipFlesh[2] + 0.14), wet * 0.48);
            const maxilla = sm((0.0042 - dU) / 0.0024) * sm((u - 0.01) / 0.012);
            r *= 1 - maxilla * 0.48;
            g *= 1 - maxilla * 0.5;
            b *= 1 - maxilla * 0.52;
            if (mo.gape > 1.45) {
              const dent = sm((0.007 - dU) / 0.0034) * (0.5 + 0.5 * Math.sin(u * 110));
              r = mix(r, 0.8, dent * 0.4);
              g = mix(g, 0.76, dent * 0.4);
              b = mix(b, 0.7, dent * 0.4);
            }
          }
          const corner =
            sm((0.02 - Math.hypot(u - mo.uCorner, t - mo.tCorner)) / 0.008) +
            sm((0.02 - Math.hypot(u - mo.uCorner, t - (1 - mo.tCorner))) / 0.008);
          r = mix(r, 0.045, corner * 0.82);
          g = mix(g, 0.025, corner * 0.82);
          b = mix(b, 0.018, corner * 0.82);
          if (mo.pitch < -0.3) {
            const pad =
              sm((0.078 - u) / 0.05) *
              sm(1 - Math.abs(Math.min(t, 1 - t) - 0.4) * 8);
            r = mix(r, pal.side[0] * 0.72 + 0.16, pad * 0.55);
            g = mix(g, pal.side[1] * 0.66 + 0.1, pad * 0.55);
            b = mix(b, pal.side[2] * 0.6 + 0.06, pad * 0.55);
          }
          if (mo.barb > 0) {
            const pairs =
              mo.barb > 1
                ? ([
                    [mo.uCorner, mo.tCorner, mo.uCorner + 0.075, mo.tCorner + 0.055],
                    [mo.uCorner - 0.008, mo.tCorner - 0.035, mo.uCorner + 0.055, mo.tCorner + 0.1],
                  ] as const)
                : ([[mo.uCorner, mo.tCorner, mo.uCorner + 0.06, mo.tCorner + 0.075]] as const);
            for (const [ax, ay, bx, by] of pairs) {
              for (const flip of [0, 1]) {
                const ta = flip ? 1 - ay : ay;
                const tb = flip ? 1 - by : by;
                const bd = distSeg(u, t, ax, ta, bx, tb);
                const barb = sm((0.0065 - bd) / 0.0035);
                r = mix(r, pal.side[0] * 0.32 + 0.08, barb);
                g = mix(g, pal.side[1] * 0.26 + 0.05, barb);
                b = mix(b, pal.side[2] * 0.18 + 0.03, barb);
              }
            }
          }

          // 眼:巩膜环 + 放射虹膜 + 瞳孔 + 湿高光
          for (const tc of [eyeT, 1 - eyeT]) {
            const eu = 0.086;
            const dx = (u - eu) * 6.6;
            const dy = (t - tc) * 4.5;
            const d = Math.hypot(dx, dy);
            const orbit = sm((0.108 - d) / 0.018) * (1 - sm((0.072 - d) / 0.016));
            r = mix(r, pal.back[0] * 0.28, orbit);
            g = mix(g, pal.back[1] * 0.28, orbit);
            b = mix(b, pal.back[2] * 0.28, orbit);
            const sclera = sm((0.072 - d) / 0.014) * (1 - sm((0.05 - d) / 0.01));
            r = mix(r, 0.78, sclera * 0.9);
            g = mix(g, 0.74, sclera * 0.9);
            b = mix(b, 0.64, sclera * 0.9);
            const iris = sm((0.05 - d) / 0.01) * (1 - sm((0.02 - d) / 0.008));
            const fiber = 0.82 + 0.18 * Math.sin(Math.atan2(dy, dx) * 10);
            r = mix(r, pal.iris[0] * fiber, iris);
            g = mix(g, pal.iris[1] * fiber, iris);
            b = mix(b, pal.iris[2] * fiber * 0.85, iris);
            const pupil = sm((0.019 - d) / 0.009);
            r = mix(r, 0.012, pupil);
            g = mix(g, 0.012, pupil);
            b = mix(b, 0.016, pupil);
            const spark = sm((0.011 - Math.hypot(dx + 0.012, dy + 0.01)) / 0.007);
            r = mix(r, 1, spark);
            g = mix(g, 1, spark);
            b = mix(b, 0.94, spark);
          }
          const grain = fbmCpu(u * fbmSu, t * fbmSt, fbmOff);
          const gk = 1 + (grain - 0.5) * grainAmt * 1.6;
          r = (r + hueJ * 0.08) * lumJ * gk;
          g = (g + hueJ * 0.02) * lumJ * gk;
          b = (b - hueJ * 0.05) * lumJ * gk;
        } else {
          const fv2 = (fv - 0.8) / 0.2;
          const caudal = u > 0.78;
          const dorsalU = u < 0.4;
          const analU = u >= 0.4 && u < 0.62;
          const tip = sm((fv2 - 0.12) / 0.75);
          r = pal.fin[0] * 0.55 + pal.side[0] * 0.28 + 0.08;
          g = pal.fin[1] * 0.55 + pal.side[1] * 0.28 + 0.07;
          b = pal.fin[2] * 0.55 + pal.side[2] * 0.24 + 0.06;
          if (spec.name === "翘嘴鲌") {
            if (caudal || dorsalU) {
              r = 0.16; g = 0.17; b = 0.19;
            } else {
              r = 0.9; g = 0.84; b = 0.62;
            }
          } else if (spec.name === "鲤鱼") {
            r = mix(0.72, 0.88, caudal ? 0.7 : 0.35);
            g = mix(0.22, 0.32, 0.4);
            b = mix(0.08, 0.1, 0.2);
          } else if (spec.name === "锦鲤") {
            r = mix(0.9, 0.78, tip);
            g = mix(0.78, 0.42, tip * 0.55);
            b = mix(0.72, 0.38, tip * 0.5);
          } else if (spec.name === "青鱼") {
            r = 0.07; g = 0.08; b = 0.1;
          } else if (spec.name === "鲢鱼") {
            r = 0.78; g = 0.82; b = 0.86;
          } else if (spec.name === "鳙鱼") {
            r = 0.28; g = 0.28; b = 0.3;
          } else if (spec.name === "草鱼") {
            r = 0.32; g = 0.3; b = 0.2;
          } else if (spec.name === "鲫鱼") {
            r = 0.38; g = 0.34; b = 0.22;
          } else if (spec.name === "鳊鱼") {
            r = mix(0.55, 0.78, analU ? 0.45 : 0.15);
            g = mix(0.5, 0.42, analU ? 0.4 : 0.1);
            b = mix(0.48, 0.32, 0.15);
          } else if (spec.name === "鳜鱼") {
            r = 0.62; g = 0.5; b = 0.22;
          } else if (spec.name === "鲈鱼") {
            r = 0.2; g = 0.22; b = 0.16;
          } else if (spec.name === "黄颡鱼") {
            r = 0.1; g = 0.09; b = 0.07;
          }
          const base = sm((0.18 - fv2) / 0.16);
          r = mix(r, pal.side[0] * 0.7, base * 0.45);
          g = mix(g, pal.side[1] * 0.7, base * 0.45);
          b = mix(b, pal.side[2] * 0.65, base * 0.45);
          if (pal.kind === "koi") {
            const kn = fbmCpu(u * 1.6, fv2 * 1.3, vs + 4);
            const hi = sm((kn - 0.48) / 0.07);
            r = mix(r, 0.84, hi * 0.5);
            g = mix(g, 0.12, hi * 0.5);
            b = mix(b, 0.05, hi * 0.5);
          } else if (pal.kind === "mandarin") {
            const blot = fbmCpu(u * 6.5, fv2 * 5.2, vs + 44);
            const bar = sm((blot - 0.42) / 0.1) * (0.4 + 0.6 * tip);
            r *= 1 - bar * 0.72;
            g *= 1 - bar * 0.72;
            b *= 1 - bar * 0.65;
          } else if (pal.kind === "catfish") {
            r *= 0.55; g *= 0.5; b *= 0.42;
            if (caudal) {
              const rim = sm((fv2 - 0.78) / 0.12);
              r = mix(r, 0.82, rim * 0.55);
              g = mix(g, 0.78, rim * 0.55);
              b = mix(b, 0.62, rim * 0.55);
            }
          }
          const nRay = caudal ? 8 : dorsalU ? 7 : analU ? 8 : 7;
          const rayU = caudal
            ? fv2
            : dorsalU || analU
              ? (u - (dorsalU ? 0.02 : 0.42)) * 2.6
              : u * 2.4 + fv2 * 0.35;
          const rayF = rayU * nRay - Math.floor(rayU * nRay);
          const rayW = 0.22 + 0.1 * (1 - tip);
          const rayK = sm(1 - Math.abs(rayF - 0.5) / rayW);
          const membrane = 0.52 + 0.48 * rayK + (1 - tip) * 0.12;
          r *= membrane;
          g *= membrane;
          b *= membrane * 1.04;
          const rayEdge =
            sm(1 - Math.abs(Math.abs(rayF - 0.5) - rayW * 0.52) / 0.07) *
            (0.55 + 0.45 * (1 - tip));
          r *= 1 - rayEdge * 0.38;
          g *= 1 - rayEdge * 0.36;
          b *= 1 - rayEdge * 0.32;
          const lead = sm((0.16 - fv2) / 0.12);
          r += lead * 0.07;
          g += lead * 0.06;
          b += lead * 0.045;
          const edge = sm((fv2 - 0.86) / 0.1) + sm((0.02 - fv2) / 0.03);
          r = mix(r, r * 0.48, edge * 0.62);
          g = mix(g, g * 0.48, edge * 0.62);
          b = mix(b, b * 0.45, edge * 0.62);
          r *= 0.74 + 0.26 * (1 - tip * 0.4);
          g *= 0.74 + 0.26 * (1 - tip * 0.4);
          b *= 0.78 + 0.22 * (1 - tip * 0.4);
        }

        const o = ((oy + y) * atlasW + (ox + x)) * 4;
        pix[o] = Math.round(clamp01(r) * 255);
        pix[o + 1] = Math.round(clamp01(g) * 255);
        pix[o + 2] = Math.round(clamp01(b) * 255);
        pix[o + 3] = 255;
    }
  }
}

function fishGeometry(): BufferGeometry {
  const pos: number[] = [];
  const uvA: number[] = [];
  const fin: number[] = [];
  const idx: number[] = [];

  const push = (x: number, y: number, z: number, u: number, v: number, f: number) => {
    pos.push(x, y, z);
    uvA.push(u, v);
    fin.push(f);
    return pos.length / 3 - 1;
  };

  const T = [0, 0.04, 0.1, 0.18, 0.28, 0.4, 0.52, 0.64, 0.75, 0.85, 0.93, 1];
  const HY = [0.02, 0.058, 0.082, 0.1, 0.114, 0.116, 0.106, 0.088, 0.066, 0.044, 0.027, 0.015];
  const HW = [0.014, 0.036, 0.05, 0.06, 0.066, 0.064, 0.056, 0.044, 0.032, 0.022, 0.014, 0.009];
  const K = 14;

  const lipU0 = push(0.544, 0.02, 0, 0.01, 0.28, 0);
  const lipU1 = push(0.54, 0.01, 0.016, 0.016, 0.25, 0);
  const lipU2 = push(0.54, 0.01, -0.016, 0.016, 0.75, 0);
  const lipD0 = push(0.52, -0.03, 0, 0.026, 0.44, 0);
  const lipD1 = push(0.526, -0.02, 0.018, 0.024, 0.4, 0);
  const lipD2 = push(0.526, -0.02, -0.018, 0.024, 0.6, 0);
  const comL = push(0.516, -0.008, 0.026, 0.055, 0.32, 0);
  const comR = push(0.516, -0.008, -0.026, 0.055, 0.68, 0);
  const mouthIn = push(0.5, -0.01, 0, 0.032, 0.4, 0);
  idx.push(
    mouthIn, lipU1, lipU0,
    mouthIn, lipU0, lipU2,
    mouthIn, lipU2, comR,
    mouthIn, comR, lipD2,
    mouthIn, lipD2, lipD0,
    mouthIn, lipD0, lipD1,
    mouthIn, lipD1, comL,
    mouthIn, comL, lipU1,
  );

  const ring0 = pos.length / 3;
  const RV = K + 1;
  for (let st = 0; st < T.length; st++) {
    const x = 0.5 - (T[st] as number);
    for (let k = 0; k <= K; k++) {
      const a = (k / K) * Math.PI * 2;
      push(
        x,
        Math.cos(a) * (HY[st] as number),
        Math.sin(a) * (HW[st] as number),
        T[st] as number,
        (k / K) * 0.8,
        0,
      );
    }
  }
  const tail = push(-0.52, 0.004, 0, 0.98, 0.4, 0);

  const lipAt = (k: number) => {
    const a = ((k + 0.5) / K) * Math.PI * 2;
    const y = Math.cos(a);
    const z = Math.sin(a);
    if (y >= Math.abs(z) * 1.1) return lipU0;
    if (y <= -Math.abs(z) * 1.1) return lipD0;
    if (z > 0) return y > 0 ? lipU1 : comL;
    return y > 0 ? lipU2 : comR;
  };
  for (let k = 0; k < K; k++) {
    idx.push(lipAt(k), ring0 + k, ring0 + k + 1);
  }
  const last = ring0 + (T.length - 1) * RV;
  for (let k = 0; k < K; k++) {
    idx.push(tail, last + k + 1, last + k);
  }
  for (let st = 0; st < T.length - 1; st++) {
    for (let k = 0; k < K; k++) {
      const a = ring0 + st * RV + k;
      const b = a + 1;
      const c = a + RV;
      const d = b + RV;
      idx.push(a, c, b, b, c, d);
    }
  }

  const hyAt = (x: number) => {
    const tt = Math.min(Math.max(0.5 - x, 0), 1);
    let i = 0;
    while (i < T.length - 2 && (T[i + 1] as number) < tt) i++;
    const t0 = T[i] as number;
    const t1 = T[i + 1] as number;
    const k = (tt - t0) / Math.max(t1 - t0, 1e-6);
    return (HY[i] as number) + ((HY[i + 1] as number) - (HY[i] as number)) * k;
  };

  const addRibbon = (
    x0: number,
    x1: number,
    ySign: number,
    n: number,
    hAt: (t: number) => number,
    aFin: number,
    u0: number,
    u1: number,
  ) => {
    const row: number[][] = [[], [], []];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t;
      const yb = hyAt(x) * ySign * 0.98;
      const h = hAt(t);
      const ray = Math.abs(Math.sin(t * n * Math.PI));
      const lead = 1 - t;
      const zb = ySign * 0.0025 * lead;
      const zRay = ySign * (0.003 + 0.012 * ray);
      const u = u0 + (u1 - u0) * t;
      const dx = Math.sign(x1 - x0) * (1 - ray) * 0.018 * t;
      row[0].push(push(x, yb, zb, u, 0.822, aFin));
      row[1].push(
        push(x + dx * 0.35, yb + h * ySign * 0.5, zRay * 0.55, u, 0.9, aFin),
      );
      row[2].push(
        push(x + dx, yb + h * ySign * (0.86 + 0.14 * ray), zRay, u, 0.988, aFin),
      );
    }
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < n; i++) {
        const a0 = row[r][i] as number;
        const a1 = row[r][i + 1] as number;
        const b0 = row[r + 1][i] as number;
        const b1 = row[r + 1][i + 1] as number;
        if (ySign > 0) idx.push(a0, b0, a1, b0, b1, a1);
        else idx.push(a0, a1, b0, b0, a1, b1);
      }
    }
  };

  // 背鳍条带覆盖最长种(鲤),顶点着色器按种裁切/缩放
  addRibbon(
    DORSAL_X0,
    DORSAL_X0 - DORSAL_SPAN,
    1,
    18,
    (t) => {
      const peak = Math.sin(Math.PI * Math.min(t * 1.15, 1));
      const falc = Math.sin(Math.PI * Math.pow(Math.min(t, 1), 0.72));
      return 0.032 + 0.2 * (0.4 * peak + 0.6 * falc) * (1 - 0.28 * t);
    },
    2,
    0.02,
    0.38,
  );
  // 臀鳍条带覆盖最长种(翘嘴/鳊)
  addRibbon(
    ANAL_X0,
    ANAL_X0 - ANAL_SPAN,
    -1,
    16,
    (t) => {
      const falc = Math.sin(Math.PI * Math.pow(Math.min(t, 1), 0.65));
      return 0.028 + 0.155 * falc * (1 - 0.22 * t);
    },
    5,
    0.42,
    0.6,
  );

  // 脂鳍(黄颡):短肉质,无鳍条;其它种顶点塌缩隐藏
  {
    const x0 = -0.26;
    const x1 = -0.36;
    const y0 = hyAt(-0.3);
    const a0 = push(x0, y0, 0.003, 0.34, 0.83, 7);
    const a1 = push(x1, y0 * 0.92, 0.002, 0.37, 0.83, 7);
    const a2 = push((x0 + x1) * 0.5, y0 + 0.055, 0.006, 0.355, 0.96, 7);
    idx.push(a0, a2, a1);
  }

  // 尾鳍:鳍条网格 + 末梢分叉,种间 fork/round 再塑
  {
    const RAYS = 15;
    const RINGS = 4;
    for (const zS of [-1, 1]) {
      const grid: number[][] = [];
      for (let ring = 0; ring <= RINGS; ring++) {
        const line: number[] = [];
        const tSpan = ring / RINGS;
        const ease = tSpan * tSpan * (3 - 2 * tSpan);
        for (let i = 0; i <= RAYS; i++) {
          const tt = i / RAYS;
          const lobe = Math.abs(tt - 0.5) * 2;
          const y0 = (0.5 - tt) * 0.4;
          const fork = 0.18 + 0.82 * (lobe * 0.32 + lobe * lobe * 0.68);
          const xRoot = -0.498;
          const xTip = -0.56 - 0.22 * fork;
          const ray = Math.abs(Math.sin(tt * RAYS * Math.PI));
          const x = xRoot + (xTip - xRoot) * ease + (1 - ray) * 0.03 * ease;
          const y = y0 * (0.2 + 0.8 * ease);
          const z =
            zS *
            (0.006 * (1 - lobe * 0.7) * (1 - ease * 0.45) + ray * 0.005 * ease);
          line.push(push(x, y, z, 0.8 + ease * 0.18, 0.825 + tt * 0.16, 1));
        }
        grid.push(line);
      }
      for (let ring = 0; ring < RINGS; ring++) {
        for (let i = 0; i < RAYS; i++) {
          const a = grid[ring][i] as number;
          const b = grid[ring][i + 1] as number;
          const c = grid[ring + 1][i] as number;
          const d = grid[ring + 1][i + 1] as number;
          if (zS > 0) idx.push(a, c, b, c, d, b);
          else idx.push(a, b, c, c, b, d);
        }
      }
    }
  }

  const addFan = (
    rx: number,
    ry: number,
    rz: number,
    nRays: number,
    nRings: number,
    len: number,
    sweep: number,
    aFin: number,
    u0: number,
    sgn: number,
  ) => {
    const grid: number[][] = [];
    for (let ring = 0; ring <= nRings; ring++) {
      const line: number[] = [];
      const tR = ring / nRings;
      for (let i = 0; i <= nRays; i++) {
        const t = i / nRays;
        const ang = -0.28 + t * sweep;
        const ray = Math.abs(Math.sin(t * nRays * Math.PI));
        const r = len * tR * (0.68 + 0.32 * Math.sin(t * Math.PI));
        const sc = (1 - ray) * 0.014 * tR;
        const x = rx - Math.cos(ang) * (r - sc) * 0.95 - r * 0.12;
        const y = ry - Math.sin(Math.abs(ang) * 0.7) * r * 0.42 - r * 0.08 * t;
        const z =
          rz * sgn +
          sgn * r * (0.55 + 0.25 * Math.sin(t * Math.PI)) +
          sgn * ray * 0.007 * tR;
        line.push(push(x, y, z, u0 + t * 0.12, 0.83 + tR * 0.155, aFin));
      }
      grid.push(line);
    }
    for (let ring = 0; ring < nRings; ring++) {
      for (let i = 0; i < nRays; i++) {
        const a = grid[ring][i] as number;
        const b = grid[ring][i + 1] as number;
        const c = grid[ring + 1][i] as number;
        const d = grid[ring + 1][i + 1] as number;
        if (sgn > 0) idx.push(a, c, b, c, d, b);
        else idx.push(a, b, c, c, b, d);
      }
    }
  };
  for (const sgn of [1, -1]) {
    addFan(0.26, -0.028, 0.05, 10, 3, 0.17, 1.28, 3, 0.64, sgn);
    addFan(0.04, -0.072, 0.032, 8, 3, 0.105, 1.08, 6, 0.64, sgn);
  }

  for (const sgn of [1, -1]) {
    const vv = sgn > 0 ? 0.3 : 0.7;
    const root = push(0.528, -0.012, 0.018 * sgn, 0.048, vv, 4);
    const r2 = push(0.527, -0.01, 0.014 * sgn, 0.048, vv, 4);
    const tip = push(0.504, -0.05, 0.026 * sgn, 0.1, vv, 4);
    const t2 = push(0.506, -0.046, 0.03 * sgn, 0.1, vv, 4);
    idx.push(root, r2, tip, r2, t2, tip);
    const n0 = push(0.534, 0.002, 0.012 * sgn, 0.038, vv - 0.03 * sgn, 4);
    const n1 = push(0.52, -0.012, 0.02 * sgn, 0.06, vv - 0.03 * sgn, 4);
    idx.push(n0, n1, root);
  }

  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uvA), 2));
  g.setAttribute("aFin", new BufferAttribute(new Float32Array(fin), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// 聚集点选取(深水 texel,深度加权 + 最小间距)
// ---------------------------------------------------------------------------

const MAX_SPOTS = 144;

type Habitat = "lake" | "stream" | "junction" | "river";

type FishSpot = {
  x: number;
  z: number;
  wy: number;
  bed: number;
  depth: number;
  /** 富饶度 0.55~2.1:驱动鱼群规模与双群 */
  rich: number;
  habitat: Habitat;
};

const HABITAT_BUDGET: Record<Habitat, { max: number; spacing: number }> = {
  junction: { max: 32, spacing: 12 },
  lake: { max: 28, spacing: 14 },
  stream: { max: 36, spacing: 10 },
  river: { max: 48, spacing: 26 },
};

/**
 * 按栖息地配额选点:主河道不能占满名额。
 * 湖泊、窄溪、溪流-河道交汇口各自保底,再把剩余名额给干流。
 */
function pickFishSpots(fields: WorldFields): FishSpot[] {
  const { res, size, masks } = fields;
  const stride = Math.max(2, Math.floor(res / 180));
  const thresh = WATER_NONE * 0.5;
  const rt = Math.max(2, Math.round((14 / size) * res));
  const rj = Math.max(2, Math.round((12 / size) * res));
  const waterAt = (px: number, pz: number): boolean => {
    if (px < 0 || pz < 0 || px >= res || pz >= res) return false;
    return (fields.waterY[pz * res + px] as number) > thresh;
  };
  const idx = (px: number, pz: number) => pz * res + px;

  const buckets: Record<Habitat, (FishSpot & { w: number })[]> = {
    lake: [],
    stream: [],
    junction: [],
    river: [],
  };

  for (let pz = 2; pz < res - 2; pz += stride) {
    for (let px = 2; px < res - 2; px += stride) {
      const i = idx(px, pz);
      const wy = fields.waterY[i] as number;
      if (wy <= thresh) continue;
      const bed = fields.heights[i] as number;
      const depth = wy - bed;
      if (depth < 0.08) continue;

      let nb = 0;
      nb += waterAt(px + rt, pz) ? 1 : 0;
      nb += waterAt(px - rt, pz) ? 1 : 0;
      nb += waterAt(px, pz + rt) ? 1 : 0;
      nb += waterAt(px, pz - rt) ? 1 : 0;
      nb += waterAt(px + rt, pz + rt) ? 1 : 0;
      nb += waterAt(px - rt, pz - rt) ? 1 : 0;
      nb += waterAt(px + rt, pz - rt) ? 1 : 0;
      nb += waterAt(px - rt, pz + rt) ? 1 : 0;
      const waterFrac = nb / 8;
      const lakeM = masks.water[i] as number;
      const prof = masks.riverProfile[i] as number;
      const inRiver = prof > 0.32;
      const inLake = lakeM > 0.4;

      let dMin = 99;
      let dMax = 0;
      let fx = 0;
      let fz = 0;
      let fm = 0;
      const dirs = [
        [rj, 0],
        [-rj, 0],
        [0, rj],
        [0, -rj],
        [rj, rj],
        [-rj, -rj],
        [rj, -rj],
        [-rj, rj],
      ] as const;
      for (const [dx, dz] of dirs) {
        const qx = px + dx;
        const qz = pz + dz;
        if (qx < 0 || qz < 0 || qx >= res || qz >= res) continue;
        const j = idx(qx, qz);
        if ((fields.waterY[j] as number) <= thresh) continue;
        const rd = masks.riverDepth[j] as number;
        if ((masks.riverProfile[j] as number) > 0.3 && rd > 0.05) {
          if (rd < dMin) dMin = rd;
          if (rd > dMax) dMax = rd;
        }
        const vx = masks.flowX[j] as number;
        const vz = masks.flowZ[j] as number;
        const mag = Math.hypot(vx, vz);
        if (mag > 1e-4) {
          fx += vx;
          fz += vz;
          fm += mag;
        }
      }
      const widthJump = dMax > 1.35 && dMin < dMax * 0.5 && dMin < 99;
      const confluence = fm > 0.4 && Math.hypot(fx, fz) < fm * 0.55;
      const lakeMouth = inLake && inRiver;

      let habitat: Habitat;
      if (lakeMouth || (inRiver && (widthJump || confluence))) habitat = "junction";
      else if (inLake && !inRiver) habitat = "lake";
      else if (inRiver && waterFrac < 0.55) habitat = "stream";
      else habitat = "river";

      const weedK =
        Math.max(0, Math.min(1, (depth - 0.08) / 0.25)) *
        Math.max(0, Math.min(1, (3.4 - depth) / 0.8));
      const moist = fields.moisture[i] as number;
      const x = (px / res - 0.5) * size;
      const z = (pz / res - 0.5) * size;
      const w =
        depth +
        waterFrac * 1.4 +
        weedK * 1.2 +
        moist * 0.4 +
        lakeM * 2.4 +
        (habitat === "junction" ? 8 : habitat === "lake" ? 5 : habitat === "stream" ? 3 : 0);
      let rich = Math.min(
        Math.max(
          0.55 + weedK * 0.7 + waterFrac * 0.55 + Math.min(depth, 6) * 0.06,
          0.55,
        ),
        2.1,
      );
      if (habitat === "junction") rich = Math.max(rich, 1.95);
      else if (habitat === "lake") rich = Math.max(rich, 1.75);
      else if (habitat === "stream") rich = Math.max(rich, 1.4);

      buckets[habitat].push({ x, z, wy, bed, depth, rich, habitat, w });
    }
  }

  const spots: FishSpot[] = [];
  const farEnough = (cd: FishSpot, spacing: number): boolean => {
    for (const sp of spots) {
      if (Math.hypot(sp.x - cd.x, sp.z - cd.z) < spacing) return false;
    }
    return true;
  };

  for (const habitat of ["junction", "lake", "stream", "river"] as const) {
    const { max, spacing } = HABITAT_BUDGET[habitat];
    const list = buckets[habitat];
    list.sort((a, b) => b.w - a.w);
    let n = 0;
    for (const cd of list) {
      if (n >= max || spots.length >= MAX_SPOTS) break;
      if (!farEnough(cd, spacing)) continue;
      spots.push({
        x: cd.x,
        z: cd.z,
        wy: cd.wy,
        bed: cd.bed,
        depth: cd.depth,
        rich: cd.rich,
        habitat: cd.habitat,
      });
      n++;
    }
  }
  return spots;
}

// ---------------------------------------------------------------------------
// 每群控制算法(CPU 侧:参数生成;GPU 侧:路径求值)
// ---------------------------------------------------------------------------

type SchoolCfg = {
  spot: FishSpot;
  spec: SpeciesDef;
  count: number;
  /** 巡游中心高度 */
  y: number;
  rx: number;
  rz: number;
  /** 有符号角速度 rad/s */
  angSpeed: number;
  phase: number;
  behavior: number;
  /** behavior1: 双频比;behavior2: 冲刺周期 s */
  aux0: number;
  /** behavior2: 冲刺距离 m */
  aux1: number;
  bobAmp: number;
  /** 轨道朝向(椭圆长轴旋转角 rad):每群独立游向 */
  rot: number;
  /** 是否挂光柱(富饶点的次级群不重复挂) */
  beacon: boolean;
};

/** 按水深挑鱼种,偏向还没出现过的种类(保证多样性) */
function chooseSpecies(depth: number, rng: () => number, used: number[]): number {
  const cand: number[] = [];
  for (let i = 0; i < SPECIES.length; i++) {
    if (depth >= (SPECIES[i] as SpeciesDef).minDepth) cand.push(i);
  }
  if (cand.length === 0) return 5; // 最浅处兜底:鲫鱼
  cand.sort((a, b) => (used[a] as number) - (used[b] as number));
  const lowest = used[cand[0] as number] as number;
  const pool = cand.filter((i) => (used[i] as number) === lowest);
  const pick = pool[Math.floor(rng() * pool.length)] as number;
  used[pick] = (used[pick] as number) + 1;
  return pick;
}

function buildSchools(spots: FishSpot[], rng: () => number): SchoolCfg[] {
  const used = SPECIES.map(() => 0);
  const schools: SchoolCfg[] = [];

  const makeSchool = (spot: FishSpot, beacon: boolean): void => {
    const spec = SPECIES[chooseSpecies(spot.depth, rng, used)] as SpeciesDef;
    // 规模随富饶度缩放:深潭/湖泊/水草丰富处成大群,上限 4 倍
    const base =
      spec.school[0] + rng() * (spec.school[1] - spec.school[0] + 1);
    const count = Math.max(
      Math.min(Math.round(base * spot.rich * 2.1), spec.school[1] * 4),
      spec.school[0],
      8,
    );
    // 半径随富饶度与群规模放大,避免鱼挤成一团
    const crowd = 1 + Math.min(count, 80) * 0.012;
    const rMax =
      (1.8 + Math.min(spot.depth * 1.9, 5.6)) * (0.8 + spot.rich * 0.5) * crowd;
    let rx = (0.55 + rng() * 0.45) * rMax;
    let rz = rx * (0.5 + rng() * 0.45);
    if (spec.formation === "mill") {
      rx *= 0.78;
      rz = rx * (0.85 + rng() * 0.15);
    }
    if (spot.habitat === "stream") {
      rx = Math.min(rx, 3.2);
      rz = Math.min(rz, 2.1);
    } else if (spot.habitat === "junction") {
      rx = Math.max(rx, 3.2);
      rz = Math.max(rz, 2.2);
    }
    const linSpeed = spec.speed[0] + rng() * (spec.speed[1] - spec.speed[0]);
    const angSpeed = (linSpeed / Math.max(rx, 1)) * (rng() < 0.5 ? -1 : 1);
    const y = Math.max(
      spot.wy - Math.min(spot.depth * spec.cruiseK, 2.2) - 0.15,
      spot.bed + 0.25,
    );
    schools.push({
      spot,
      spec,
      count,
      y,
      rx,
      rz,
      angSpeed,
      phase: rng(),
      behavior: spec.behavior,
      aux0: spec.behavior === 2 ? 6 + rng() * 7 : 0.55 + rng() * 0.35,
      aux1: Math.min(2.5 + rng() * 4, rMax + 2),
      bobAmp: 0.05 + rng() * 0.12,
      rot: rng() * Math.PI * 2, // 每群独立游向
      beacon,
    });
  };

  for (const spot of spots) {
    makeSchool(spot, true);
    const extra =
      spot.habitat === "junction"
        ? 3
        : spot.habitat === "lake"
          ? 2
          : spot.habitat === "stream"
            ? 1
            : spot.rich > 1.25
              ? 1
              : 0;
    for (let k = 0; k < extra; k++) {
      const ang = rng() * Math.PI * 2;
      const off =
        spot.habitat === "stream"
          ? 1.2 + rng() * 1.6
          : spot.habitat === "lake"
            ? 2 + rng() * 3
            : 3.5 + rng() * 4.5;
      makeSchool(
        {
          ...spot,
          x: spot.x + Math.cos(ang) * off,
          z: spot.z + Math.sin(ang) * off,
        },
        false,
      );
    }
  }
  const total = schools.reduce((s, c) => s + c.count, 0);
  if (total > MAX_FISH) {
    const k = MAX_FISH / total;
    let used = 0;
    for (let i = 0; i < schools.length; i++) {
      const sc = schools[i] as SchoolCfg;
      if (i === schools.length - 1) {
        sc.count = Math.max(3, MAX_FISH - used);
      } else {
        sc.count = Math.max(3, Math.round(sc.count * k));
        used += sc.count;
      }
    }
  }
  return schools;
}

/** 队形分布:返回单条鱼的 [时滞 s, 横向偏移 m, 纵向偏移 m] */
function formationOffset(
  f: Formation,
  i: number,
  count: number,
  angSpeed: number,
  rng: () => number,
): [number, number, number] {
  const g = () => (rng() + rng() + rng()) / 3 - 0.5; // 近高斯
  switch (f) {
    case "column": {
      const span = 6.5 + Math.min(count, 40) * 0.08;
      return [(i / Math.max(count - 1, 1)) * span, g() * 1.9, (rng() - 0.5) * 2.2];
    }
    case "ball": {
      const s = 1 + Math.min(count, 60) * 0.018;
      return [rng() * 0.9, g() * 3.2 * s, g() * 2.25 * s];
    }
    case "mill": {
      // 均匀铺满整个环 → 转动的"鱼柱"
      const period = (Math.PI * 2) / Math.max(Math.abs(angSpeed), 0.05);
      const s = 1 + Math.min(count, 80) * 0.012;
      return [(i / count) * period + rng() * 0.3, (rng() - 0.5) * 1.6 * s, (rng() - 0.5) * 2.4 * s];
    }
    case "layer": {
      const s = 1 + Math.min(count, 50) * 0.016;
      return [rng() * 1.6, g() * 3.6 * s, (rng() - 0.5) * 1.7 * s];
    }
    case "pack": {
      const s = 1 + Math.min(count, 40) * 0.02;
      return [rng() * 0.8, g() * 2.8 * s, (rng() - 0.5) * 2.05 * s];
    }
  }
}

// ---------------------------------------------------------------------------
// TSL 路径求值(鱼与光柱共用):t → 群中心世界坐标
// ---------------------------------------------------------------------------

/**
 * aN: (cx, cy, cz, -) bN: (rx, rz, angSpeed, phase) dN: (behavior, aux0, aux1, bobAmp)
 * rN: (cos 轨道旋转角, sin 轨道旋转角, -, -) — 每群独立游向,轨迹互不平行
 * 三族算法在此展开,由 behavior id 选择:
 *   0 椭圆巡游 1 Lissajous 双频游弋 2 伏击冲刺(小幅游弋 + 周期突刺)
 */
function pathEval(aN: NV4, bN: NV4, dN: NV4, rN: NV4, t: NF): NV3 {
  const ang = t.mul(bN.z).add(bN.w.mul(6.2831853)).toVar();
  const ell = vec2(cos(ang).mul(bN.x), sin(ang).mul(bN.y));

  const ang2 = t.mul(bN.z.mul(dN.y)).add(bN.w.mul(11.31));
  const lis = vec2(sin(ang).mul(bN.x), sin(ang2).mul(bN.y));

  const per = dN.y.max(2);
  const cyc = t.div(per).floor();
  const ph = t.div(per).fract();
  const dirA = hash2(vec2(cyc, bN.w.mul(97)), 7).mul(6.2831853);
  const pulse = smoothstep(0.02, 0.1, ph).mul(smoothstep(0.62, 0.2, ph));
  const idle = vec2(
    cos(t.mul(0.5).add(bN.w.mul(6.28))).mul(bN.x.mul(0.35)),
    sin(t.mul(0.41).add(bN.w.mul(9.4))).mul(bN.y.mul(0.35)),
  );
  const dart = idle.add(vec2(cos(dirA), sin(dirA)).mul(dN.z.mul(pulse)));

  // 无分支行为混合(向量 select 在部分 WebGPU 实现上易编译失败)
  const bid = dN.x;
  const w0 = float(1).sub(bid.abs().min(1));
  const w1 = float(1).sub(bid.sub(1).abs().min(1));
  const w2 = float(1).sub(bid.sub(2).abs().min(1));
  const xz = ell.mul(w0).add(lis.mul(w1)).add(dart.mul(w2)).toVar();
  // 轨道旋转:每群独立朝向
  const rxz = vec2(
    xz.x.mul(rN.x).sub(xz.y.mul(rN.y)),
    xz.x.mul(rN.y).add(xz.y.mul(rN.x)),
  ).toVar();
  const y = aN.y.add(sin(t.mul(0.5).add(bN.w.mul(6.2831853))).mul(dN.w));
  return vec3(aN.x.add(rxz.x), y, aN.z.add(rxz.y)).toVar() as unknown as NV3;
}

// ---------------------------------------------------------------------------
// 鱼群网格
// ---------------------------------------------------------------------------

function createFishMesh(
  tex: WorldTextures,
  env: EnvState,
  schools: SchoolCfg[],
): InstancedMesh {
  const total = Math.min(
    schools.reduce((s, c) => s + c.count, 0),
    MAX_FISH,
  );
  const n = Math.max(total, 1);
  const nSp = SPECIES.length;
  const skinTiles = nSp * SKIN_PER_SPEC;
  const pack = packSkinAtlas(skinTiles);
  const atlasW = pack.cols * pack.tw;
  const atlasH = pack.rows * pack.th;
  if (atlasW > ATLAS_MAX || atlasH > ATLAS_MAX) {
    throw new Error(`fish skin atlas ${atlasW}x${atlasH} exceeds ${ATLAS_MAX}`);
  }
  const pix = new Uint8Array(atlasW * atlasH * 4);
  for (let si = 0; si < nSp; si++) {
    const spec = SPECIES[si] as SpeciesDef;
    for (let v = 0; v < SKIN_PER_SPEC; v++) {
      const tile = si * SKIN_PER_SPEC + v;
      if (tile >= pack.cols * pack.rows) break;
      paintSkinTile(
        pix,
        atlasW,
        (tile % pack.cols) * pack.tw,
        Math.floor(tile / pack.cols) * pack.th,
        pack.tw,
        pack.th,
        spec,
        ((si + 1) * 104729 + (v + 1) * 7919) >>> 0,
      );
    }
  }
  // WebGPU 顶点缓冲上限为 8,逐鱼参数全部打进一张 9×N 浮点纹理,
  // 顶点着色器用 instanceIndex 按行读取(行 = 鱼,列 = 参数组 0..8)。
  const ROWS = 9;
  const data = new Float32Array(n * ROWS * 4);

  const rng = makeRng(20260817);
  let fi = 0;
  outer: for (const sc of schools) {
    const { spec } = sc;
    for (let i = 0; i < sc.count; i++) {
      if (fi >= n) break outer;
      const put = (row: number, x: number, y: number, z: number, w: number) => {
        const o = (fi * ROWS + row) * 4;
        data[o] = x;
        data[o + 1] = y;
        data[o + 2] = z;
        data[o + 3] = w;
      };
      const [lag, lat, vert] = formationOffset(
        spec.formation,
        i,
        sc.count,
        sc.angSpeed,
        rng,
      );
      // 领队偏大,其余铺满体长区间,避免同群克隆
      const lenT = i === 0 ? 0.72 + rng() * 0.28 : rng();
      const len = spec.len[0] + (spec.len[1] - spec.len[0]) * lenT;
      const depthBias = (rng() - 0.5) * Math.min(sc.spot.depth * 0.55, 1.75);

      // 0: cx, cy, cz, 体长
      put(0, sc.spot.x, sc.y + depthBias, sc.spot.z, len);
      // 1: rx, rz, angSpeed, phase
      put(1, sc.rx, sc.rz, sc.angSpeed, sc.phase);
      // 2: 时滞, 横偏, 纵偏, 摆尾相位
      put(2, lag, lat * (0.5 + len), vert, rng());
      // 3: behavior, aux0, aux1, 逐鱼起伏(不再整群同相)
      put(3, sc.behavior, sc.aux0, sc.aux1, 0.1 + rng() * 0.38);

      const specIdx = SPECIES.indexOf(spec);
      const tint = 0.9 + rng() * 0.18;
      const hSpan = Math.max(spec.heightK[1] - spec.heightK[0], 0.05);
      const wSpan = Math.max(spec.widthK[1] - spec.widthK[0], 0.04);
      const skinVar = Math.floor(rng() * SKIN_PER_SPEC);
      const tileIdx = Math.max(0, specIdx) * SKIN_PER_SPEC + skinVar;
      // 4: heightK, widthK, tint, 鱼种行号(鳍形纹理)
      put(
        4,
        spec.heightK[0] - hSpan * 0.22 + rng() * hSpan * 1.44,
        spec.widthK[0] - wSpan * 0.22 + rng() * wSpan * 1.44,
        tint,
        specIdx < 0 ? 0 : specIdx,
      );
      // 5: 口裂张度, 俯仰(-1下位..1上位), 口角后延, 须
      const mth = mouthSpec(spec.name);
      put(
        5,
        mth.gape * (0.84 + rng() * 0.36),
        Math.min(1, Math.max(-1, mth.pitch + (rng() - 0.5) * 0.24)),
        mth.reach * (0.88 + rng() * 0.28),
        mth.barb,
      );
      const filter = spec.name === "鲢鱼" || spec.name === "鳙鱼";
      const ambush = spec.name === "鳜鱼" || spec.name === "鲈鱼";
      const mouthFreq = filter
        ? 0.85 + rng() * 1.55
        : ambush
          ? 0.1 + rng() * 0.38
          : 0.22 + rng() * 1.25;
      const mouthBias = filter
        ? 0.06 + rng() * 0.22
        : ambush
          ? 0.4 + rng() * 0.38
          : 0.16 + rng() * 0.52;
      // 6: 口开合阈值, 动画相位, 水深游移 m, 摆幅增益
      put(6, mouthBias, rng(), 0.55 + rng() * 1.4, 0.8 + rng() * 0.4);
      // 7: 口开合频率, 口相位, 腹背丰满度
      put(7, mouthFreq, rng(), 0.7 + rng() * 0.58, 0.76 + rng() * 0.52);
      // 8: 轨道旋转 cos/sin, 逐鱼漫游扰动幅度 m, 皮肤图块索引
      put(8, Math.cos(sc.rot), Math.sin(sc.rot), 0.25 + rng() * 0.55, tileIdx);
      fi++;
    }
  }

  const pTex = new DataTexture(data, ROWS, n, RGBAFormat, FloatType);
  pTex.magFilter = NearestFilter;
  pTex.minFilter = NearestFilter;
  pTex.wrapS = ClampToEdgeWrapping;
  pTex.wrapT = ClampToEdgeWrapping;
  pTex.generateMipmaps = false;
  pTex.needsUpdate = true;

  const skinAtlas = new DataTexture(pix, atlasW, atlasH, RGBAFormat, UnsignedByteType);
  skinAtlas.magFilter = LinearFilter;
  skinAtlas.minFilter = LinearFilter;
  skinAtlas.wrapS = ClampToEdgeWrapping;
  skinAtlas.wrapT = ClampToEdgeWrapping;
  skinAtlas.colorSpace = SRGBColorSpace;
  skinAtlas.generateMipmaps = false;
  skinAtlas.flipY = false;
  skinAtlas.needsUpdate = true;
  const finTex = buildFinTex();
  const geo = fishGeometry();

  const mat = new MeshBasicNodeMaterial();
  mat.side = DoubleSide;
  mat.fog = true;

  const fp = (row: number) =>
    textureLoad(pTex, ivec2(row, instanceIndex.toInt())).toVar() as unknown as NV4;
  const a = fp(0);
  const b = fp(1);
  const c = fp(2);
  const d = fp(3);
  const e = fp(4);
  const mC = fp(5);
  const gC = fp(6);
  const t7 = fp(7);
  const rC = fp(8);
  const specI = e.w.toInt();
  const f0 = textureLoad(finTex, ivec2(0, specI)).toVar() as unknown as NV4;
  const f1 = textureLoad(finTex, ivec2(1, specI)).toVar() as unknown as NV4;
  const f2 = textureLoad(finTex, ivec2(2, specI)).toVar() as unknown as NV4;
  const f3 = textureLoad(finTex, ivec2(3, specI)).toVar() as unknown as NV4;
  const finB = attribute("aFin") as unknown as NF;

  // --- 路径 + 朝向标架(领队时滞采样 → 真实跟随转弯) ---
  const tf = env.time.sub(c.x).toVar();
  const p0 = pathEval(a, b, d, rC, tf);
  const p1 = pathEval(a, b, d, rC, tf.add(0.18));
  const p2 = pathEval(a, b, d, rC, tf.add(0.72));
  const vel = p1.sub(p0).div(0.18).toVar();
  const speed = vel.length().max(0.02).toVar();
  const F = vel.div(speed).toVar();
  // 归一化全部加防除零(路径瞬时静止时避免 NaN 扩散)
  const r0 = vec3(F.z, 0, F.x.negate()).toVar();
  const R = r0.div(r0.length().max(0.0001)).toVar();
  const u0 = vec3(
    F.y.mul(R.z),
    F.z.mul(R.x).sub(F.x.mul(R.z)),
    F.y.mul(R.x).negate(),
  ).toVar();
  const U = u0.div(u0.length().max(0.0001)).toVar();
  // 偏航率(叉积 y 分量)→ 弯体 + 向弯心滚转
  const dh = p2.sub(p1).toVar();
  const h2 = dh.div(dh.length().max(0.0001)).toVar();
  const yawP = clamp(F.x.mul(h2.z).sub(F.z.mul(h2.x)).mul(2.2), -0.6, 0.6).toVar();
  const roll = yawP.mul(0.8);
  const cr = cos(roll);
  const sr = sin(roll);
  const R2 = R.mul(cr).add(U.mul(sr)).toVar();
  const U2 = U.mul(cr).sub(R.mul(sr)).toVar();

  // 鱼中心 = 路径点 + 队形偏移 + 逐鱼低频漫游(打散僵硬的直线队列);
  // 夹在河床与水面之间
  const wanL = sin(tf.mul(0.45).add(c.w.mul(6.2831853))).mul(rC.z);
  const wanV = cos(tf.mul(0.33).add(c.w.mul(9.7))).mul(rC.z.mul(0.25));
  const depthN = sin(tf.mul(0.23).add(c.w.mul(6.2831853)))
    .mul(gC.z)
    .add(sin(tf.mul(0.11).add(gC.y.mul(8.4))).mul(gC.z.mul(0.65)));
  const c0 = p0
    .add(R.mul(c.y.add(wanL)))
    .add(U.mul(c.z.add(wanV)))
    .add(vec3(0, depthN, 0))
    .toVar();
  const cxz = vec2(c0.x, c0.z).toVar();
  const bedH = sampleFloatBilinear(tex.heightTex, cxz, tex.res, tex.size);
  const wl = sampleWaterLevel(tex.waterExtTex, cxz, tex.res, tex.size);
  const yMin = bedH.add(0.12).add(a.w.mul(0.2)).toVar();
  const yMax = wl.y.sub(0.1).sub(a.w.mul(0.15)).max(yMin).toVar();
  const center = vec3(c0.x, clamp(c0.y, yMin, yMax), c0.z).toVar();

  // --- 姿态:种间鳍形 + 游泳行波 + 转向弯体 + 鳍摆 ---
  const s = float(0.5).sub(positionLocal.x).toVar();
  const wCaudal = float(1).sub(finB.sub(1).abs().min(1)).toVar();
  const wPect = float(1).sub(finB.sub(3).abs().min(1)).toVar();
  const wDors = float(1).sub(finB.sub(2).abs().min(1)).toVar();
  const wAnal = float(1).sub(finB.sub(5).abs().min(1)).toVar();
  const wPelv = float(1).sub(finB.sub(6).abs().min(1)).toVar();
  const wAdip = float(1).sub(finB.sub(7).abs().min(1)).toVar();
  const wBody = float(1).sub(finB.abs().min(1));
  const wBarb = float(1).sub(finB.sub(4).abs().min(1));
  const dT = float(DORSAL_X0).sub(positionLocal.x).div(DORSAL_SPAN);
  const dT0 = float(DORSAL_X0).sub(f1.x).div(DORSAL_SPAN);
  const dT1 = float(DORSAL_X0).sub(f1.x.sub(f1.y)).div(DORSAL_SPAN);
  const dLive = smoothstep(dT0.sub(0.05), dT0.add(0.02), dT).mul(
    smoothstep(dT1.add(0.05), dT1.sub(0.02), dT),
  );
  const aT = float(ANAL_X0).sub(positionLocal.x).div(ANAL_SPAN);
  const aT0 = float(ANAL_X0).sub(f2.x).div(ANAL_SPAN);
  const aT1 = float(ANAL_X0).sub(f2.x.sub(f2.y)).div(ANAL_SPAN);
  const aLive = smoothstep(aT0.sub(0.05), aT0.add(0.02), aT).mul(
    smoothstep(aT1.add(0.05), aT1.sub(0.02), aT),
  );
  const dTip = smoothstep(0.08, 0.15, positionLocal.y.abs());
  const dNotch = smoothstep(0.08, 0, dT.sub(0.38).abs().sub(0.02));
  const fromR = positionLocal.x.add(0.5);
  const lobe = positionLocal.y.abs().div(0.2);
  const cX = float(-0.5)
    .add(fromR.mul(f0.x))
    .add(lobe.mul(lobe).mul(f0.y).mul(0.16));
  const cY = positionLocal.y
    .mul(f0.w)
    .mul(mix(float(1), f0.z, smoothstep(0.015, -0.02, positionLocal.y)));
  const px = mix(positionLocal.x, cX, wCaudal)
    .add(wPelv.mul(f3.z))
    .add(wPect.mul(positionLocal.x.sub(0.26).mul(f3.x.sub(1))));
  const py = mix(positionLocal.y, cY, wCaudal)
    .mul(float(1).sub(wDors).sub(wAnal))
    .add(
      wDors.mul(
        mix(
          mix(positionLocal.y, positionLocal.y.mul(0.36), dTip),
          positionLocal.y.mul(f1.z.div(0.23)),
          dLive,
        ).mul(float(1).sub(f1.w.mul(dNotch).mul(dTip).mul(0.82))),
      ),
    )
    .add(
      wAnal.mul(
        mix(
          mix(positionLocal.y, positionLocal.y.mul(0.36), dTip),
          positionLocal.y.mul(f2.z.div(0.18)),
          aLive,
        ),
      ),
    );
  const pz = mix(
    mix(positionLocal.z, positionLocal.z.mul(f3.x), wPect),
    positionLocal.z.mul(f3.y),
    wPelv,
  );
  const freq = clamp(speed.mul(2.4).add(1.6), 1.5, 9);
  const wig = sin(env.time.mul(freq).add(c.w.mul(6.2831853)).sub(s.mul(2.8)));
  const amp = s.mul(s).mul(0.14).add(0.01);
  const gain = clamp(speed.mul(0.7).add(0.4), 0.45, 1.3).mul(gC.w);
  const lat = wig.mul(amp).mul(gain).mul(wCaudal.mul(0.55).add(1));
  const zBend = yawP.mul(s.sub(0.3)).mul(0.35);
  const flap = sin(env.time.mul(c.w.mul(1.6).add(1.8)).add(gC.y.mul(12)).add(t7.y.mul(3.4)));
  const finTip = clamp(positionLocal.y.abs().mul(5.5), 0, 1);
  const dWave = sin(env.time.mul(freq.mul(0.95)).add(gC.y.mul(11.3)).sub(s.mul(3.4)));
  const aWave = sin(env.time.mul(freq.mul(1.2)).add(gC.y.mul(14.8)).add(s.mul(2.6)));
  const chewOsc = sin(env.time.mul(t7.x).add(t7.y.mul(17.13)).add(c.w.mul(4.1)));
  const chew = clamp(chewOsc.sub(gC.x.mul(1.7).sub(0.4)).mul(2.1), 0, 1);
  const finRipple = sin(
    uv().x.mul(38).add(env.time.mul(freq.mul(0.9))).add(gC.y.mul(8.7)),
  );
  const finSoft = wCaudal.add(wDors).add(wAnal).add(wPect.mul(0.7)).add(wPelv.mul(0.55));
  const finTipV = smoothstep(0.84, 0.97, uv().y);
  const snout = smoothstep(0.472, 0.548, px).mul(wBody);
  const lower = smoothstep(0.006, -0.02, py);
  const upper = smoothstep(-0.006, 0.018, py);
  const barbOn = smoothstep(0.08, 0.28, mC.w);
  const hideB = wBarb.mul(float(1).sub(barbOn));
  const hideA = wAdip.mul(float(1).sub(smoothstep(0.08, 0.32, f2.w)));
  const hideFin = hideB.add(hideA).min(1);
  const bellyK = smoothstep(0.012, -0.055, py).mul(wBody);
  const backK = smoothstep(-0.012, 0.07, py).mul(wBody);
  const lx = mix(
    px
      .add(snout.mul(lower).mul(mC.y.max(float(0))).mul(0.042))
      .add(snout.mul(upper).mul(mC.y.min(float(0)).abs()).mul(0.028))
      .add(snout.mul(mC.z.sub(1)).mul(0.03))
      .sub(
        snout
          .mul(smoothstep(0.02, 0, py.abs()))
          .mul(mC.x.sub(0.9).max(float(0)))
          .mul(0.042),
      )
      .sub(snout.mul(smoothstep(0.02, 0, py.abs())).mul(chew).mul(0.05)),
    float(0.52),
    hideFin,
  );
  const ly = mix(
    py
      .mul(e.x)
      .mul(mix(float(1), t7.w, bellyK.mul(0.85)))
      .add(backK.mul(t7.w.sub(1)).mul(0.07))
      .add(flap.mul(wPect).mul(pz.abs()).mul(0.55))
      .add(flap.mul(wPelv).mul(pz.abs()).mul(0.4))
      .add(wDors.mul(dWave).mul(finTip).mul(0.024))
      .add(wAnal.mul(aWave).mul(finTip).mul(-0.02))
      .add(finRipple.mul(wDors.add(wAnal)).mul(finTipV).mul(0.012))
      .add(snout.mul(lower).mul(mC.y).mul(0.058))
      .sub(snout.mul(upper).mul(mC.y).mul(0.024))
      .add(snout.mul(upper.sub(lower)).mul(mC.x.sub(1)).mul(0.038))
      .add(snout.mul(upper.sub(lower)).mul(chew).mul(0.058))
      .add(snout.mul(lower).mul(chew).mul(-0.03))
      .add(wBarb.mul(barbOn).mul(mC.w.sub(0.45).max(float(0))).mul(py.abs()).mul(-0.4)),
    float(-0.01),
    hideFin,
  );
  const lz = mix(
    pz
      .mul(e.y)
      .mul(snout.mul(mC.x.sub(1).max(float(0))).mul(0.12).add(1))
      .add(lat)
      .add(zBend)
      .add(wDors.mul(dWave).mul(finTip).mul(gain).mul(0.058))
      .add(wAnal.mul(aWave).mul(finTip).mul(gain).mul(0.05))
      .add(finRipple.mul(finSoft).mul(finTipV).mul(gain).mul(0.018))
      .add(flap.mul(wPect).mul(0.04))
      .add(flap.mul(wPelv).mul(-0.03)),
    float(0),
    hideFin,
  );

  // 队形偏移把鱼推出有效水域时,几何塌缩隐藏(鱼永远只在水里)
  mat.positionNode = center.add(
    F.mul(lx).add(U2.mul(ly)).add(R2.mul(lz)).mul(a.w.mul(wl.valid)),
  );

  // --- 着色:CPU 皮肤图集 + 少量 varying(复杂片元图在 WebGPU 上会整段失败变灰) ---
  const tintV = varying(e.z) as unknown as NF;
  const nl = normalLocal;
  const nWv = varying(
    F.mul(nl.x).add(U2.mul(nl.y)).add(R2.mul(nl.z)),
  ) as unknown as NV3;
  const colsN = float(pack.cols);
  const rowsN = float(pack.rows);
  const tileI = rC.w;
  const rowF = tileI.div(colsN).floor();
  const colF = tileI.sub(rowF.mul(colsN));
  const uTile = uv().x.mul(0.992).add(0.004);
  const vTile = uv().y.mul(0.992).add(0.004);
  const skinUvV = varying(vec2(uTile.add(colF).div(colsN), vTile.add(rowF).div(rowsN)));
  let col = texture(skinAtlas, skinUvV).xyz.mul(tintV) as unknown as NV3;
  const nW = nWv.normalize().toVar();
  const sd = env.sunDir;
  const lam = nW.x.mul(sd.x).add(nW.y.mul(sd.y)).add(nW.z.mul(sd.z));
  const wrap = lam.mul(0.5).add(0.5);
  col = col.mul(wrap.mul(0.38).add(0.62)) as unknown as NV3;
  const spec = wrap.mul(wrap).mul(wrap).mul(wrap).mul(0.12);
  col = col.add(vec3(spec, spec.mul(0.92), spec.mul(0.8))) as unknown as NV3;
  col = col.mul(env.nightK.mul(0.75).oneMinus()) as unknown as NV3;
  mat.colorNode = col;

  const mesh = new InstancedMesh(geo, mat, n);
  mesh.count = n;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.skinAtlas = skinAtlas;
  return mesh;
}

// ---------------------------------------------------------------------------
// 鱼群光柱信标(按种类配色,实时跟踪群中心)
// ---------------------------------------------------------------------------

const BEAM_HEIGHT = 80;

/**
 * 静态烘焙光柱:每群一根(白热内核 + 种类色外晕),世界坐标直接写进顶点,
 * 着色器只做竖向渐隐 + 呼吸脉动。关闭深度测试 → 隔着地形/树木也直接可见。
 * (鱼群只在聚集点周围数米内巡游,柱子锚定聚集点即可标记位置)
 */
function createBeacons(env: EnvState, schools: SchoolCfg[]): Mesh {
  const pos: number[] = [];
  const col: number[] = [];
  const fad: number[] = [];
  const idx: number[] = [];
  const SEG = 12;

  /** 锥形柱壳:底半径 r → 顶半径 r*0.5,颜色可 >1(加色混合吃亮度) */
  const addCyl = (
    cx: number,
    cy: number,
    cz: number,
    r: number,
    c: [number, number, number],
    alpha: number,
  ) => {
    const v0 = pos.length / 3;
    for (let k = 0; k <= SEG; k++) {
      const a = (k / SEG) * Math.PI * 2;
      const x = Math.cos(a);
      const z = Math.sin(a);
      pos.push(cx + x * r, cy, cz + z * r);
      pos.push(cx + x * r * 0.5, cy + BEAM_HEIGHT, cz + z * r * 0.5);
      col.push(c[0], c[1], c[2], c[0], c[1], c[2]);
      fad.push(alpha, 0);
    }
    for (let k = 0; k < SEG; k++) {
      const a = v0 + k * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  };

  for (const sc of schools) {
    const [br, bg, bb] = sc.spec.beam;
    const y = sc.spot.wy + 0.05;
    // 内核:细、白热、近乎实心
    addCyl(sc.spot.x, y, sc.spot.z, 0.28, [br * 0.35 + 0.55, bg * 0.35 + 0.55, bb * 0.35 + 0.55], 0.22);
    addCyl(sc.spot.x, y, sc.spot.z, 1.15, [br * 1.1, bg * 1.1, bb * 1.1], 0.1);
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("aCol", new BufferAttribute(new Float32Array(col), 3));
  geo.setAttribute("aFade", new BufferAttribute(new Float32Array(fad), 1));
  geo.setIndex(idx);

  const mat = new MeshBasicNodeMaterial();
  mat.transparent = true;
  mat.blending = AdditiveBlending;
  mat.depthWrite = false;
  mat.depthTest = true;
  mat.side = DoubleSide;
  mat.fog = false;

  const aCol = attribute("aCol") as unknown as NV3;
  const aFade = attribute("aFade") as unknown as NF;
  const pulse = sin(env.time.mul(1.8)).mul(0.5).add(0.5);
  mat.colorNode = aCol;
  mat.opacityNode = aFade
    .mul(pulse.mul(0.25).add(0.75))
    .mul(env.nightK.mul(0.4).add(0.85));

  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 30; // 关闭深度测试后最后绘制,叠加在一切之上
  return mesh;
}

// ---------------------------------------------------------------------------
// 总装
// ---------------------------------------------------------------------------

export function createFishSchools(
  tex: WorldTextures,
  env: EnvState,
  fields: WorldFields,
): Group {
  const group = new Group();
  const spots = pickFishSpots(fields);
  if (spots.length === 0) return group;
  const schools = buildSchools(spots, makeRng(20260816));
  group.add(createFishMesh(tex, env, schools));
  group.add(createBeacons(env, schools.filter((s) => s.beacon)));
  return group;
}
