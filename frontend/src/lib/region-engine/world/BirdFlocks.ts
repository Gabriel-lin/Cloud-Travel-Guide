/**
 * BirdFlocks — 专用 TSL 鸟群系统(对照 FishSchools)。
 *
 * 每只鸟是头颅 + 眼 + 双颌喙 + 覆羽/次级/初级独立桨羽 + 尾羽条 + 收拢爪。姿态全在顶点着色器:
 *   - 振翅:绕肩上下拍,初级飞羽额外绕腕、上拍收拢后掠;各羽是分开的网格,不是整板折扇;
 *   - 尾扇随振翅张合/俯仰,转弯时侧偏;
 *   - 转向弯体 + 向弯心滚转(banking);
 *   - 队形:领队路径时滞采样(follow-the-leader)+ 横/纵/高度偏移。
 *
 * 翼面拓扑对照 Cornell Bird Academy / Sibley / USFWS Feather Atlas:
 * 张开时臂段后缘是次级飞羽(后羽),腕以外才是初级飞羽(外前羽);前缘覆羽盖住飞羽根。
 *
 * 场景选种:经纬度气候带 × 栖息地(城/田/林/湿/水/岸/草/雪) × 风/雪/昼夜。
 * 每个主群上方竖一根加色混合光柱(按鸟种配色),方便在空中寻找。
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
  LinearMipmapLinearFilter,
  Mesh,
  NearestFilter,
  PerspectiveCamera,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  attribute,
  cameraPosition,
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
import { BIOME } from "../const";
import { hash2 } from "../gpu/noise";
import { WATER_NONE } from "../gpu/pipeline";
import type { NF, NV3, NV4 } from "../gpu/tsl-types";
import type { EnvState } from "../render/env";
import {
  sampleFloatBilinear,
  sampleWaterLevel,
  type WorldTextures,
} from "../render/fields";
import type { RegionParams, WorldFields } from "../types";
import { makeRng } from "../veg/treeBuilder";
import type { BirdFlockEmitter } from "./birdKinematics";
import {
  paintBirdSkin,
  skinSheen,
  SKIN_LEG_V,
  SKIN_RACHIS_K,
  SKIN_SCAPULAR_UV,
  SKIN_TILE_H,
  SKIN_TILE_W,
  SKIN_VARIANTS,
  SKIN_ZONES,
} from "./birdSkins";
import type { BirdSpeciesId, Habitat } from "./birdSpecies";

// ---------------------------------------------------------------------------
// 鸟种
// ---------------------------------------------------------------------------

type Formation = "column" | "ball" | "mill" | "layer" | "pack" | "vee";

type SpeciesDef = {
  id: BirdSpeciesId;
  name: string;
  /** 体长 m(喙至尾基,不含尾流苏) */
  len: [number, number];
  heightK: [number, number];
  widthK: [number, number];
  wingSpan: number;
  wingSweep: number;
  /** 弦长相对基准网格,>1 更宽 */
  wingChord: number;
  /** 前缘弓起 0~1 */
  wingBow: number;
  tailLen: number;
  /** 0 圆尾 ~ 1.4 燕尾深叉 */
  tailFork: number;
  /** 尾扇横向展开 */
  tailFan: number;
  beakLen: number;
  flapHz: [number, number];
  flapAmp: number;
  /** 0 常振翅 ~ 1 以滑翔为主 */
  glide: number;
  school: [number, number];
  formation: Formation;
  /** 0 椭圆巡游 1 Lissajous 游弋 2 盘旋/俯冲 */
  behavior: 0 | 1 | 2;
  speed: [number, number];
  /** 巡航高度(相对地表或水面,m) */
  cruiseH: [number, number];
  habitats: Habitat[];
  /** 绝对纬度范围 */
  lat: [number, number];
  night: boolean;
  snowNeed: boolean;
  snowOk: boolean;
  windTol: number;
  beam: [number, number, number];
};

const SPECIES: SpeciesDef[] = [
  {
    id: "sparrow",
    name: "麻雀",
    len: [0.14, 0.17],
    heightK: [1.05, 1.18],
    widthK: [1.02, 1.12],
    wingSpan: 1.28,
    wingSweep: 0.18,
    wingChord: 1.14,
    wingBow: 0.22,
    tailLen: 0.88,
    tailFork: 0.1,
    tailFan: 1.35,
    beakLen: 1.04,
    flapHz: [7.5, 10.5],
    flapAmp: 0.72,
    glide: 0.08,
    school: [16, 36],
    formation: "ball",
    behavior: 1,
    speed: [4.5, 7.5],
    cruiseH: [3.5, 16],
    habitats: ["urban", "farmland", "meadow"],
    lat: [0, 70],
    night: false,
    snowNeed: false,
    snowOk: true,
    windTol: 0.55,
    beam: [1.0, 0.62, 0.22],
  },
  {
    id: "swallow",
    name: "家燕",
    len: [0.15, 0.19],
    heightK: [0.78, 0.88],
    widthK: [0.72, 0.84],
    wingSpan: 1.48,
    wingSweep: 0.58,
    wingChord: 0.84,
    wingBow: 0.42,
    tailLen: 1.62,
    tailFork: 1.42,
    tailFan: 0.62,
    beakLen: 0.55,
    flapHz: [6.2, 9.4],
    flapAmp: 0.85,
    glide: 0.22,
    school: [22, 52],
    formation: "mill",
    behavior: 0,
    speed: [7.5, 12],
    cruiseH: [10, 48],
    habitats: ["farmland", "meadow", "wetland", "water"],
    lat: [0, 68],
    night: false,
    snowNeed: false,
    snowOk: false,
    windTol: 0.62,
    beam: [0.22, 0.48, 1.0],
  },
  {
    id: "pigeon",
    name: "原鸽",
    len: [0.3, 0.36],
    heightK: [1.0, 1.1],
    widthK: [1.05, 1.16],
    wingSpan: 1.38,
    wingSweep: 0.22,
    wingChord: 1.2,
    wingBow: 0.26,
    tailLen: 0.95,
    tailFork: 0.06,
    tailFan: 1.22,
    beakLen: 0.7,
    flapHz: [4.2, 6.4],
    flapAmp: 0.62,
    glide: 0.28,
    school: [14, 34],
    formation: "mill",
    behavior: 0,
    speed: [8, 14],
    cruiseH: [12, 42],
    habitats: ["urban"],
    lat: [0, 65],
    night: false,
    snowNeed: false,
    snowOk: true,
    windTol: 0.75,
    beam: [0.42, 0.55, 0.88],
  },
  {
    id: "magpie",
    name: "喜鹊",
    len: [0.42, 0.5],
    heightK: [0.92, 1.02],
    widthK: [0.88, 0.98],
    wingSpan: 1.12,
    wingSweep: 0.28,
    wingChord: 1.04,
    wingBow: 0.2,
    tailLen: 1.95,
    tailFork: 0.12,
    tailFan: 0.72,
    beakLen: 0.92,
    flapHz: [3.4, 5.2],
    flapAmp: 0.55,
    glide: 0.35,
    school: [4, 10],
    formation: "pack",
    behavior: 1,
    speed: [6, 10],
    cruiseH: [6, 28],
    habitats: ["urban", "farmland", "meadow", "forest"],
    lat: [18, 66],
    night: false,
    snowNeed: false,
    snowOk: true,
    windTol: 0.7,
    beam: [0.18, 0.82, 0.72],
  },
  {
    id: "crow",
    name: "乌鸦",
    len: [0.44, 0.54],
    heightK: [1.02, 1.12],
    widthK: [1.0, 1.1],
    wingSpan: 1.45,
    wingSweep: 0.26,
    wingChord: 1.22,
    wingBow: 0.18,
    tailLen: 1.05,
    tailFork: 0.12,
    tailFan: 1.38,
    beakLen: 1.08,
    flapHz: [2.8, 4.4],
    flapAmp: 0.48,
    glide: 0.42,
    school: [8, 18],
    formation: "pack",
    behavior: 1,
    speed: [7, 12],
    cruiseH: [14, 55],
    habitats: ["urban", "forest", "farmland", "meadow"],
    lat: [0, 72],
    night: false,
    snowNeed: false,
    snowOk: true,
    windTol: 0.88,
    beam: [0.55, 0.28, 1.0],
  },
  {
    id: "mallard",
    name: "绿头鸭",
    len: [0.5, 0.65],
    heightK: [0.95, 1.08],
    widthK: [1.12, 1.28],
    wingSpan: 1.22,
    wingSweep: 0.18,
    wingChord: 1.28,
    wingBow: 0.14,
    tailLen: 0.68,
    tailFork: 0.05,
    tailFan: 1.02,
    beakLen: 1.15,
    flapHz: [4.8, 6.8],
    flapAmp: 0.58,
    glide: 0.18,
    school: [10, 24],
    formation: "layer",
    behavior: 1,
    speed: [12, 18],
    cruiseH: [2.5, 16],
    habitats: ["water", "wetland"],
    lat: [12, 72],
    night: false,
    snowNeed: false,
    snowOk: true,
    windTol: 0.72,
    beam: [0.18, 0.95, 0.38],
  },
  {
    id: "egret",
    name: "白鹭",
    len: [0.52, 0.65],
    heightK: [0.88, 0.98],
    widthK: [0.78, 0.88],
    wingSpan: 1.52,
    wingSweep: 0.36,
    wingChord: 1.12,
    wingBow: 0.28,
    tailLen: 0.78,
    tailFork: 0.08,
    tailFan: 1.05,
    beakLen: 1.35,
    flapHz: [2.6, 3.8],
    flapAmp: 0.52,
    glide: 0.48,
    school: [6, 16],
    formation: "pack",
    behavior: 0,
    speed: [7, 12],
    cruiseH: [5, 24],
    habitats: ["wetland", "water"],
    lat: [0, 52],
    night: false,
    snowNeed: false,
    snowOk: false,
    windTol: 0.58,
    beam: [0.95, 0.96, 1.0],
  },
  {
    id: "gull",
    name: "银鸥",
    len: [0.54, 0.68],
    heightK: [1.0, 1.1],
    widthK: [1.05, 1.16],
    wingSpan: 1.58,
    wingSweep: 0.32,
    wingChord: 1.02,
    wingBow: 0.26,
    tailLen: 0.88,
    tailFork: 0.06,
    tailFan: 1.2,
    beakLen: 1.18,
    flapHz: [2.2, 3.6],
    flapAmp: 0.42,
    glide: 0.72,
    school: [10, 26],
    formation: "mill",
    behavior: 0,
    speed: [9, 16],
    cruiseH: [18, 78],
    habitats: ["coast", "water", "urban"],
    lat: [18, 78],
    night: false,
    snowNeed: false,
    snowOk: true,
    windTol: 0.98,
    beam: [0.68, 0.84, 1.0],
  },
  {
    id: "goose",
    name: "鸿雁",
    len: [0.78, 0.95],
    heightK: [1.05, 1.16],
    widthK: [1.08, 1.2],
    wingSpan: 1.55,
    wingSweep: 0.38,
    wingChord: 1.16,
    wingBow: 0.24,
    tailLen: 0.75,
    tailFork: 0.08,
    tailFan: 1.08,
    beakLen: 1.22,
    flapHz: [2.4, 3.4],
    flapAmp: 0.45,
    glide: 0.55,
    school: [14, 34],
    formation: "vee",
    behavior: 0,
    speed: [14, 20],
    cruiseH: [28, 95],
    habitats: ["wetland", "water", "meadow"],
    lat: [22, 72],
    night: false,
    snowNeed: false,
    snowOk: true,
    windTol: 0.9,
    beam: [1.0, 0.68, 0.32],
  },
  {
    id: "kestrel",
    name: "红隼",
    len: [0.32, 0.39],
    heightK: [0.9, 1.0],
    widthK: [0.82, 0.92],
    wingSpan: 1.42,
    wingSweep: 0.52,
    wingChord: 0.88,
    wingBow: 0.38,
    tailLen: 1.32,
    tailFork: 0.16,
    tailFan: 0.88,
    beakLen: 0.88,
    flapHz: [4.0, 6.5],
    flapAmp: 0.5,
    glide: 0.62,
    school: [2, 6],
    formation: "pack",
    behavior: 2,
    speed: [8, 16],
    cruiseH: [16, 52],
    habitats: ["meadow", "farmland", "alpine"],
    lat: [8, 68],
    night: false,
    snowNeed: false,
    snowOk: true,
    windTol: 0.85,
    beam: [1.0, 0.38, 0.12],
  },
  {
    id: "eagle-owl",
    name: "雕鸮",
    len: [0.6, 0.75],
    heightK: [1.12, 1.28],
    widthK: [1.15, 1.32],
    wingSpan: 1.32,
    wingSweep: 0.16,
    wingChord: 1.3,
    wingBow: 0.12,
    tailLen: 0.92,
    tailFork: 0.04,
    tailFan: 1.42,
    beakLen: 0.95,
    flapHz: [2.0, 3.2],
    flapAmp: 0.4,
    glide: 0.38,
    school: [2, 5],
    formation: "pack",
    behavior: 1,
    speed: [5, 9],
    cruiseH: [6, 28],
    habitats: ["forest"],
    lat: [18, 66],
    night: true,
    snowNeed: false,
    snowOk: true,
    windTol: 0.7,
    beam: [1.0, 0.72, 0.18],
  },
  {
    id: "snowy-owl",
    name: "雪鸮",
    len: [0.52, 0.7],
    heightK: [1.15, 1.3],
    widthK: [1.18, 1.35],
    wingSpan: 1.36,
    wingSweep: 0.14,
    wingChord: 1.28,
    wingBow: 0.1,
    tailLen: 0.88,
    tailFork: 0.04,
    tailFan: 1.4,
    beakLen: 0.9,
    flapHz: [2.1, 3.3],
    flapAmp: 0.38,
    glide: 0.45,
    school: [2, 6],
    formation: "pack",
    behavior: 2,
    speed: [6, 12],
    cruiseH: [8, 36],
    habitats: ["alpine", "meadow"],
    lat: [48, 90],
    night: true,
    snowNeed: true,
    snowOk: true,
    windTol: 0.92,
    beam: [0.82, 0.94, 1.0],
  },
];

const SPARROW_I = 0;
const OWL_I = 10;
const SNOWY_I = 11;

// ---------------------------------------------------------------------------
// CPU 羽色图集:绘制见 birdSkins.ts。每个在场鸟种一个皮肤库(SKIN_VARIANTS 张
// 个体变体 tile),同种个体从本种库取 tile —— 基本纹理一致、个体细节各异。
//   u: 0 喙 → 1 尾; v: 0~0.52 身体展开(0 背、0.5 腹),0.54~0.975 翼/尾单片羽,>0.978 腿趾
// ---------------------------------------------------------------------------

const TILE_W = SKIN_TILE_W;
const TILE_H = SKIN_TILE_H;
const ATLAS_MAX = 4096;
const MAX_BIRDS = 2048;
/** 近景高模同时在场的上限;其余走低模,轮廓由后处理补 */
const HIGH_CAP = 96;
const HIGH_DIST = 80;

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

const MORPH_COLS = 3;

function buildMorphTex(): DataTexture {
  const n = SPECIES.length;
  const data = new Float32Array(n * MORPH_COLS * 4);
  for (let i = 0; i < n; i++) {
    const s = SPECIES[i] as SpeciesDef;
    const put = (col: number, x: number, y: number, z: number, w: number) => {
      const o = (i * MORPH_COLS + col) * 4;
      data[o] = x;
      data[o + 1] = y;
      data[o + 2] = z;
      data[o + 3] = w;
    };
    put(0, s.wingSpan, s.wingSweep, s.tailLen, s.tailFork);
    put(1, s.beakLen, s.wingChord, s.wingBow, s.night ? 1 : 0);
    // w = 羽色金属光泽(shader 高光增强并偏蓝绿:燕/鹊/鸦/鸽颈/雄鸭头)
    put(2, s.tailFan, s.flapAmp, s.glide, skinSheen(s.id));
  }
  const tex = new DataTexture(data, MORPH_COLS, n, RGBAFormat, FloatType);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// 鸟网格:头颅 + 眼 + 双颌喙 + 覆羽/次级飞羽(臂) + 初级飞羽(手) + 尾羽条 + 收拢爪
// aPart: 0 体 1 覆羽/次级 2 尾 3 喙 4 眼 5 初级飞羽 6 跗跖 7 爪
// ---------------------------------------------------------------------------

function birdGeometry(detail: "high" | "low"): BufferGeometry {
  const high = detail === "high";
  const pos: number[] = [];
  const uvA: number[] = [];
  const part: number[] = [];
  const spanA: number[] = [];
  const idx: number[] = [];

  const push = (
    x: number,
    y: number,
    z: number,
    u: number,
    v: number,
    p: number,
    span = 0,
  ) => {
    pos.push(x, y, z);
    uvA.push(u, v);
    part.push(p);
    spanA.push(span);
    return pos.length / 3 - 1;
  };

  // Cornell:麻雀 chunky, rounded head, full breast;额收到喙,颊最宽
  const T = [0, 0.05, 0.1, 0.17, 0.26, 0.38, 0.5, 0.62, 0.74, 0.86, 0.94, 1];
  const HY = [0.032, 0.07, 0.078, 0.052, 0.1, 0.122, 0.118, 0.092, 0.068, 0.046, 0.032, 0.024];
  const HW = [0.024, 0.066, 0.076, 0.05, 0.098, 0.118, 0.112, 0.086, 0.062, 0.044, 0.032, 0.022];
  const K = high ? 10 : 8;

  const ring0 = pos.length / 3;
  const RV = K + 1;
  for (let st = 0; st < T.length; st++) {
    const x = 0.5 - (T[st] as number);
    for (let k = 0; k <= K; k++) {
      const a = (k / K) * Math.PI * 2;
      const tu = T[st] as number;
      const uu = st < 3 ? 0.05 + tu * 1.35 : tu;
      push(
        x,
        Math.cos(a) * (HY[st] as number) + (st < 3 ? 0.012 : 0),
        Math.sin(a) * (HW[st] as number),
        uu,
        (k / K) * 0.52,
        0,
      );
    }
  }
  const last = ring0 + (T.length - 1) * RV;
  for (let st = 0; st < T.length - 1; st++) {
    for (let k = 0; k < K; k++) {
      const a = ring0 + st * RV + k;
      const b = a + 1;
      const c = a + RV;
      const d = b + RV;
      idx.push(a, c, b, b, c, d);
    }
  }
  const rump = push(-0.5, 0.012, 0, 0.98, 0.4, 0);
  for (let k = 0; k < K; k++) {
    idx.push(rump, last + k + 1, last + k);
  }

  // 颅顶:额接到喙,渚ч潰 UV 璧扮櫧棰?顶面走冠
  {
    const nLat = high ? 5 : 4;
    const nLon = high ? 8 : 6;
    const grid: number[][] = [];
    for (let i = 0; i <= nLat; i++) {
      const th = (i / nLat) * Math.PI;
      const st = Math.sin(th);
      const ct = Math.cos(th);
      const line: number[] = [];
      for (let j = 0; j <= nLon; j++) {
        const ph = (j / nLon) * Math.PI * 2;
        const cheek = 1 + 0.22 * Math.abs(Math.sin(ph));
        const side = Math.abs(Math.sin(ph));
        const fore = Math.max(Math.cos(ph), 0);
        line.push(
          push(
            0.44 + 0.052 * st * Math.cos(ph) * (0.78 + 0.36 * fore),
            0.026 + 0.058 * ct * (1 - 0.05 * st),
            0.068 * st * Math.sin(ph) * cheek,
            0.08 + side * 0.04,
            0.06 + side * 0.32,
            0,
          ),
        );
      }
      grid.push(line);
    }
    for (let i = 0; i < nLat; i++) {
      for (let j = 0; j < nLon; j++) {
        const a = grid[i][j] as number;
        const b = grid[i][j + 1] as number;
        const c = grid[i + 1][j] as number;
        const d = grid[i + 1][j + 1] as number;
        idx.push(a, c, b, b, c, d);
      }
    }
  }

  // 眼:侧前方突出,UV 钉在虹膜/颊白,侧面才能看见
  const addEye = (sgn: number) => {
    const cx = 0.488;
    const cy = 0.022;
    const cz = sgn * 0.07;
    const nLat = high ? 3 : 2;
    const nLon = high ? 6 : 5;
    const rr = high ? 0.015 : 0.013;
    const grid: number[][] = [];
    for (let i = 0; i <= nLat; i++) {
      const t = i / nLat;
      const th = t * Math.PI * 0.62;
      const line: number[] = [];
      for (let j = 0; j <= nLon; j++) {
        const ph = (j / nLon) * Math.PI * 2;
        line.push(
          push(
            cx + Math.sin(th) * Math.cos(ph) * rr * 0.72,
            cy + Math.sin(th) * Math.sin(ph) * rr,
            cz + Math.cos(th) * rr * 0.92 * sgn,
            0.105,
            sgn > 0 ? 0.146 : 0.374,
            4,
          ),
        );
      }
      grid.push(line);
    }
    for (let i = 0; i < nLat; i++) {
      for (let j = 0; j < nLon; j++) {
        const a = grid[i][j] as number;
        const b = grid[i][j + 1] as number;
        const c = grid[i + 1][j] as number;
        const d = grid[i + 1][j + 1] as number;
        if (sgn > 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
    }
    const addDisc = (r: number, dz: number, u: number, v: number) => {
      const n = 6;
      const iz = cz + sgn * dz;
      const ic = push(cx + 0.001, cy + 0.001, iz, u, v, 4);
      const ring: number[] = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        ring.push(push(cx + Math.cos(a) * r * 0.88, cy + Math.sin(a) * r, iz, u, v, 4));
      }
      for (let k = 0; k < n; k++) {
        const n1 = (k + 1) % n;
        if (sgn > 0) idx.push(ic, ring[k] as number, ring[n1] as number);
        else idx.push(ic, ring[n1] as number, ring[k] as number);
      }
    };
    addDisc(0.011, 0.0135, 0.12, sgn > 0 ? 0.14 : 0.38);
    addDisc(0.0072, 0.0146, 0.105, sgn > 0 ? 0.146 : 0.374);
    if (high) addDisc(0.0032, 0.0154, 0.1, sgn > 0 ? 0.146 : 0.374);
  };
  addEye(1);
  addEye(-1);

  // 喙:侧面尖锥+上下颌,俯视仍是短宽三角;UV 钉在角质/蜡膜
  const addMandible = (yBias: number, yHook: number, scale: number, tipX: number) => {
    const sides = 6;
    const rings = [
      { x: 0.486, hy: 0.03 * scale, hw: 0.026 * scale, u: 0.07 },
      { x: 0.522, hy: 0.02 * scale, hw: 0.017 * scale, u: 0.048 },
      { x: 0.554, hy: 0.011 * scale, hw: 0.009 * scale, u: 0.028 },
      { x: 0.58, hy: 0.0045 * scale, hw: 0.0038 * scale, u: 0.014 },
    ];
    const ids = rings.map((r) => {
      const row: number[] = [];
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        const culmen = Math.max(Math.cos(a), 0) * 0.007 * scale;
        const side = Math.abs(Math.sin(a));
        row.push(
          push(
            r.x,
            Math.cos(a) * r.hy + yBias + (r.x - 0.48) * yHook + culmen,
            Math.sin(a) * r.hw,
            r.u,
            0.05 + side * 0.1,
            3,
          ),
        );
      }
      return row;
    });
    const tip = push(tipX, yBias + (tipX - 0.48) * yHook, 0, 0.006, 0.08, 3);
    for (let r = 0; r < ids.length - 1; r++) {
      const a = ids[r] as number[];
      const b = ids[r + 1] as number[];
      for (let k = 0; k < sides; k++) {
        const n = (k + 1) % sides;
        idx.push(a[k] as number, b[k] as number, a[n] as number);
        idx.push(a[n] as number, b[k] as number, b[n] as number);
      }
    }
    const lastR = ids[ids.length - 1] as number[];
    for (let k = 0; k < sides; k++) {
      idx.push(lastR[k] as number, tip, lastR[(k + 1) % sides] as number);
    }
  };
  addMandible(0.008, -0.042, 1, 0.604);
  addMandible(-0.018, -0.078, 0.74, 0.586);

  const addNare = (sgn: number) => {
    const cx = 0.518;
    const cy = 0.014;
    const cz = sgn * 0.012;
    const c = push(cx, cy, cz, 0.042, 0.2, 3);
    const ring: number[] = [];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      ring.push(
        push(
          cx + Math.cos(a) * 0.0042,
          cy + Math.sin(a) * 0.0032,
          cz + sgn * 0.0015,
          0.042,
          0.2,
          3,
        ),
      );
    }
    for (let k = 0; k < 5; k++) {
      const n1 = (k + 1) % 5;
      if (sgn > 0) idx.push(c, ring[k] as number, ring[n1] as number);
      else idx.push(c, ring[n1] as number, ring[k] as number);
    }
  };
  if (high) {
    addNare(1);
    addNare(-1);
  }

  // 鍗曠墖缇?鍓嶇窘鐗囩獎銆佸悗缇界墖瀹?缇借酱鐣ラ殕璧枫€傜考涓庡熬鍏辩敤銆?
  // 皮肤 tile 翼/尾分区(与 birdSkins.SKIN_ZONES 对齐):每片羽把自身宽度映射到分区全宽
  const CV0 = SKIN_ZONES.covert[0];
  const CVW = SKIN_ZONES.covert[1] - SKIN_ZONES.covert[0];
  const TL0 = SKIN_ZONES.tail[0];
  const TLW = SKIN_ZONES.tail[1] - SKIN_ZONES.tail[0];
  const SC0 = SKIN_ZONES.secondary[0];
  const SCW = SKIN_ZONES.secondary[1] - SKIN_ZONES.secondary[0];
  const PR0 = SKIN_ZONES.primary[0];
  const PRW = SKIN_ZONES.primary[1] - SKIN_ZONES.primary[0];

  // pinUv 给定时整片羽钉到一个体区 texel(肩羽取背侧体色 / 喜鹊白肩斑)
  const addFeather = (
    x0: number,
    y0: number,
    z0: number,
    dirX: number,
    dirZ: number,
    len: number,
    halfW: number,
    span0: number,
    span1: number,
    part: number,
    uvU0: number,
    uvUW: number,
    segs: number,
    form: "oval" | "lance" | "blade",
    winding: number,
    cols = 2,
    pinUv?: readonly [number, number],
  ) => {
    const dirL = Math.hypot(dirX, dirZ) || 1;
    const fx = dirX / dirL;
    const fz = dirZ / dirL;
    let qx = -fz;
    let qz = fx;
    if (qx > 0) {
      qx = -qx;
      qz = -qz;
    }
    const gridF: number[][] = [];
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const belly = Math.sin(Math.PI * Math.min(t * 1.04, 1));
      const tipFade =
        form === "oval"
          ? 1 - t * t * t * 0.16
          : form === "blade"
            ? 1 - Math.pow(Math.max(t - 0.7, 0) / 0.3, 1.2) * 0.38
            : 1 - Math.pow(Math.max(t - 0.58, 0) / 0.42, 1.12) * 0.7;
      const w = halfW * (0.72 + 0.36 * belly) * tipFade;
      const bendAmt = form === "lance" ? 0.1 : form === "blade" ? 0.05 : 0.04;
      const bend = Math.sin(t * Math.PI) * halfW * bendAmt;
      const x = x0 + fx * t * len + qx * bend * 0.2;
      const z = z0 + fz * t * len + qz * bend * 0.2;
      const y = y0 + Math.sin(t * Math.PI) * (form === "lance" ? 0.014 : 0.011);
      const line: number[] = [];
      for (let c = 0; c <= cols; c++) {
        const tc = c / cols;
        const o = (tc - SKIN_RACHIS_K) * 2 * w;
        const rachisLift = Math.max(0, 1 - Math.abs(tc - SKIN_RACHIS_K) * 2.8) * 0.012;
        const trailDrop = tc * tc * 0.006;
        line.push(
          push(
            x + qx * o,
            y + rachisLift - trailDrop,
            z + qz * o,
            pinUv ? pinUv[0] : uvU0 + tc * uvUW,
            pinUv ? pinUv[1] : 0.555 + t * 0.42,
            part,
            span0 + t * (span1 - span0),
          ),
        );
      }
      gridF.push(line);
    }
    for (let s = 0; s < segs; s++) {
      for (let c = 0; c < cols; c++) {
        const a = gridF[s][c] as number;
        const b = gridF[s][c + 1] as number;
        const d0 = gridF[s + 1][c] as number;
        const d1 = gridF[s + 1][c + 1] as number;
        if (winding > 0) idx.push(a, d0, b, d0, d1, b);
        else idx.push(a, b, d0, d0, b, d1);
      }
    }
  };

  // 翼面:缈艰啘鍙摵鍒拌缇芥牴(鍓嶇紭涓版弧),鍚庣紭浜ょ粰鍙犵潃鐨勯缇?鎵嶇湅寰楀嚭鍗曠墖缇姐€?
  const addWing = (sgn: number) => {
    const zSh = 0.108;
    const zWr = 0.33;
    const zTip = 0.64;
    const xLeSh = 0.152;
    const xLeBow = 0.176;
    const xLeTip = 0.052;
    const xTeSh = -0.168;
    const xTeBow = -0.22;
    const xTeTip = -0.098;
    const yPlane = 0.036;
    const lerpN = (a: number, b: number, t: number) => a + (b - a) * t;
    const spanOf = (az: number) => Math.min(Math.max((az - zSh) / (zTip - zSh), 0), 1);
    const quad = (a: number, b: number, c: number, t: number) => {
      const u = 1 - t;
      return u * u * a + 2 * u * t * b + t * t * c;
    };
    const leX = (az: number) =>
      quad(xLeSh, xLeBow, xLeTip, spanOf(az)) + Math.sin(spanOf(az) * Math.PI) * 0.008;
    const teX = (az: number) => quad(xTeSh, xTeBow, xTeTip, spanOf(az));

    const place = (
      zRoot: number,
      chord0: number,
      zEnd: number,
      chord1: number,
      halfW: number,
      span0: number,
      span1: number,
      part: number,
      uvU0: number,
      uvUW: number,
      segs: number,
      form: "oval" | "lance" | "blade",
      yOff: number,
      cols = 2,
      pinUv?: readonly [number, number],
    ) => {
      const az0 = Math.max(zRoot, 0.04);
      const az1 = Math.max(zEnd, az0 + 0.005);
      const x0 = lerpN(leX(az0), teX(az0), chord0);
      const x1 = lerpN(leX(az1), teX(az1), chord1);
      addFeather(
        x0,
        yPlane + yOff,
        sgn * az0,
        x1 - x0,
        sgn * (az1 - az0),
        Math.hypot(x1 - x0, az1 - az0),
        halfW,
        span0,
        span1,
        part,
        uvU0,
        uvUW,
        segs,
        form,
        sgn,
        cols,
        pinUv,
      );
    };

    const addSail = (z0: number, z1: number, part: number, span0: number, span1: number) => {
      const nS = high ? 5 : 3;
      const nC = high ? 3 : 2;
      const grid: number[][] = [];
      for (let i = 0; i <= nS; i++) {
        const ts = i / nS;
        const az = lerpN(z0, z1, ts);
        const sp = lerpN(span0, span1, ts);
        const row: number[] = [];
        for (let j = 0; j <= nC; j++) {
          const tc = j / nC;
          const chord = tc * 0.38;
          const x = lerpN(leX(az), teX(az), chord);
          const camber = Math.sin(chord * Math.PI) * 0.038 * (1 - ts * 0.22);
          row.push(
            push(
              x,
              yPlane + 0.005 + camber,
              sgn * az,
              CV0 + 0.02 + chord * (CVW - 0.04),
              0.56 + ts * 0.22,
              part,
              sp,
            ),
          );
        }
        grid.push(row);
      }
      for (let i = 0; i < nS; i++) {
        for (let j = 0; j < nC; j++) {
          const a = grid[i][j] as number;
          const b = grid[i][j + 1] as number;
          const c = grid[i + 1][j] as number;
          const d = grid[i + 1][j + 1] as number;
          if (sgn > 0) idx.push(a, c, b, b, c, d);
          else idx.push(a, b, c, b, d, c);
        }
      }
    };
    addSail(zSh, zWr + 0.08, 1, 0.04, 0.56);
    addSail(zWr - 0.1, zTip, 5, 0.4, 1);

    if (!high) {
      for (let i = 0; i < 4; i++) {
        const k = i / 3;
        const z = zSh + 0.02 + k * (zWr - zSh);
        place(z, 0.24, z + 0.012, 0.94, 0.058, spanOf(z), spanOf(z) + 0.16, 1, SC0, SCW, 2, "blade", -0.003, 2);
      }
      const handLen = 0.15;
      for (let i = 0; i < 6; i++) {
        const k = i / 5;
        const slot = Math.max(k - 0.65, 0) / 0.35;
        const zRoot = zWr - 0.05 + k * handLen;
        const zEnd = zWr + 0.02 + k * (zTip - zWr) * (1 + slot * 0.06);
        place(
          zRoot,
          0.26 + k * 0.05,
          zEnd,
          0.95 + slot * 0.06,
          (0.056 - k * 0.008) * (1 - slot * 0.16),
          spanOf(zRoot),
          1,
          5,
          PR0,
          PRW,
          3,
          slot > 0.45 ? "lance" : "blade",
          -0.004,
          2,
        );
      }
    } else {
    for (let i = 0; i < 10; i++) {
      const k = i / 9;
      const az0 = lerpN(zSh, zTip * 0.94, k) + (i & 1 ? 0.004 : 0);
      const az1 = az0 + 0.02;
      const part = az0 < zWr ? 1 : 5;
      const sp = spanOf(az0);
      addFeather(
        leX(az0) + 0.002,
        yPlane + 0.012,
        sgn * az0,
        leX(az1) - leX(az0) - 0.004,
        sgn * (az1 - az0),
        Math.hypot(leX(az1) - leX(az0) - 0.004, az1 - az0),
        0.02,
        sp,
        sp + 0.04,
        part,
        CV0,
        CVW,
        2,
        "oval",
        sgn,
        2,
      );
    }

    // 肩羽盖住背与翼根:钉到体区背侧(体色;喜鹊此处为白肩斑)
    for (let i = 0; i < 5; i++) {
      const k = i / 4;
      place(0.076 + k * 0.014, 0.06 + k * 0.05, 0.112 + k * 0.024, 0.58, 0.032, 0.02, 0.16, 1, CV0, CVW, 3, "oval", 0.01, 2, SKIN_SCAPULAR_UV);
    }

    // 小覆羽:略往后指,盖住翼膜
    for (let i = 0; i < 10; i++) {
      const k = i / 9;
      const z = zSh + k * (zTip - zSh) * 0.93 + (i & 1 ? 0.005 : 0);
      const part = z < zWr ? 1 : 5;
      const sp = spanOf(z);
      place(z, 0.04, z + 0.01, 0.36, 0.028, sp, sp + 0.07, part, CV0, CVW, 2, "oval", 0.0095, 2);
    }

    // 中覆羽:斜向后,叠上大覆羽根
    for (let i = 0; i < 8; i++) {
      const k = i / 7;
      const z = zSh + 0.006 + k * (zTip - zSh) * 0.9 + (i & 1 ? 0.004 : -0.002);
      const part = z < zWr ? 1 : 5;
      const sp = spanOf(z);
      place(z, 0.12, z + 0.01, 0.52, 0.032, sp, sp + 0.09, part, CV0, CVW, 3, "oval", 0.0065, 2);
    }

    // 大覆羽:像缩短的飞羽,盖住后羽根(与次级飞羽共用分区)
    for (let i = 0; i < 10; i++) {
      const k = i / 9;
      const z = zSh + 0.008 + k * (zTip - zSh) * 0.88 + (i & 1 ? 0.004 : 0);
      const part = z < zWr + 0.015 ? 1 : 5;
      const sp = spanOf(z);
      place(z, 0.22, z + 0.008, 0.76, 0.036, sp, sp + 0.12, part, SC0, SCW, 3, "blade", 0.0032, 3);
    }

    // 三级飞羽:璐磋韩鐨勫悗缂?叠在次级内侧
    for (let i = 0; i < 3; i++) {
      const k = i / 2;
      addFeather(
        lerpN(leX(zSh + 0.01), teX(zSh + 0.01), 0.28),
        yPlane - 0.002 - i * 0.0012,
        sgn * (zSh + 0.002 + i * 0.02),
        -0.98 + k * 0.04,
        sgn * (0.08 + k * 0.12),
        0.16 + k * 0.02,
        0.028 - k * 0.002,
        0.06,
        0.2,
        1,
        SC0,
        SCW,
        3,
        "blade",
        sgn,
        3,
      );
    }

    // 次级飞羽:根伸进大覆羽下面
    for (let i = 0; i < 8; i++) {
      const k = i / 7;
      const scallop = 0.94 + 0.025 * Math.sin(i * 1.35 + 0.2);
      const z = zSh + 0.016 + k * (zWr - zSh) + (i & 1 ? 0.003 : 0);
      place(
        z,
        0.24,
        z + 0.01,
        scallop,
        0.056 - k * 0.002,
        spanOf(z),
        spanOf(z) + 0.14,
        1,
        SC0,
        SCW,
        3,
        "blade",
        -0.003 - i * 0.0004,
        3,
      );
    }

    // 小翼羽
    for (let i = 0; i < 3; i++) {
      const k = i / 2;
      addFeather(
        lerpN(leX(zWr), teX(zWr), 0.04),
        yPlane + 0.009,
        sgn * (zWr - 0.004 + i * 0.012),
        0.35 - k * 0.06,
        sgn * (0.92 + k * 0.04),
        0.044 + k * 0.012,
        0.015,
        0.44,
        0.54,
        5,
        CV0,
        CVW,
        2,
        "lance",
        sgn,
        2,
      );
    }

    // 初级覆羽:盖住初级羽根
    for (let i = 0; i < 7; i++) {
      const k = i / 6;
      const z = zWr - 0.04 + k * 0.22 + (i & 1 ? 0.003 : 0);
      place(z, 0.16, z + 0.008, 0.66, 0.034, spanOf(z), spanOf(z) + 0.1, 5, SC0, SCW, 3, "blade", 0.0035, 3);
    }

    // 初级飞羽:根扎进覆羽下;内侧密叠接次级
    const handLen = 0.15;
    for (let i = 0; i < 8; i++) {
      const k = i / 7;
      const slot = Math.max(k - 0.7, 0) / 0.3;
      const zRoot = zWr - 0.055 + k * handLen;
      const zEnd = zWr + 0.02 + k * (zTip - zWr) * (1 + slot * 0.06);
      place(
        zRoot,
        0.26 + k * 0.05,
        zEnd,
        0.95 + slot * 0.06,
        (0.056 - k * 0.008) * (1 - slot * 0.16),
        spanOf(zRoot),
        1,
        5,
        PR0,
        PRW,
        4,
        slot > 0.45 ? "lance" : "blade",
        -0.004 - i * 0.00045,
        3,
      );
    }
    }
  };
  addWing(1);
  addWing(-1);

  const sampleBody = (t: number): { hy: number; hw: number } => {
    const tt = Math.min(Math.max(t, 0), 0.999);
    for (let i = 0; i < T.length - 1; i++) {
      const t0 = T[i] as number;
      const t1 = T[i + 1] as number;
      if (tt <= t1) {
        const k = (tt - t0) / Math.max(t1 - t0, 1e-6);
        return {
          hy: (HY[i] as number) + ((HY[i + 1] as number) - (HY[i] as number)) * k,
          hw: (HW[i] as number) + ((HW[i + 1] as number) - (HW[i] as number)) * k,
        };
      }
    }
    return { hy: HY[HY.length - 1] as number, hw: HW[HW.length - 1] as number };
  };

  const addPlume = (t0: number, a0: number, len: number, halfW: number, lift: number) => {
    const ty = -Math.sin(a0);
    const tz = Math.cos(a0);
    const segs = 2;
    const gridF: number[][] = [];
    const v0 = ((((a0 / (Math.PI * 2)) % 1) + 1) % 1) * 0.52;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const w = halfW * (0.7 + 0.3 * Math.sin(Math.PI * t)) * (1 - t * t * 0.3);
      const tb = t0 + t * len;
      const { hy, hw } = sampleBody(tb);
      const x = 0.5 - tb;
      const y = Math.cos(a0) * (hy + lift) * (1 + Math.sin(t * Math.PI) * 0.03);
      const z = Math.sin(a0) * (hw + lift);
      const line: number[] = [];
      for (let c = 0; c <= 2; c++) {
        const tc = c / 2;
        const o = (tc - 0.5) * 2 * w;
        line.push(
          push(
            x,
            y + ty * o,
            z + tz * o,
            Math.min(tb, 0.97),
            Math.min(Math.max(v0 + (tc - 0.5) * 0.035, 0.01), 0.51),
            0,
          ),
        );
      }
      gridF.push(line);
    }
    for (let s = 0; s < segs; s++) {
      for (let c = 0; c < 2; c++) {
        const a = gridF[s][c] as number;
        const b = gridF[s][c + 1] as number;
        const d0 = gridF[s + 1][c] as number;
        const d1 = gridF[s + 1][c + 1] as number;
        idx.push(a, d0, b, d0, d1, b);
      }
    }
  };

  if (high) {
  // 浣撶窘鎸夌窘鍖?pterylae)閾?涓嶅洿鎴愮幆鑺?鍐犮€侀銆佽剨绱€佽儊銆佽吂绱€佸熬涓婅缇?
  for (let i = 0; i < 6; i++) {
    const k = i / 5 - 0.5;
    addPlume(0.04, k * 0.7, 0.045, 0.012, 0.007);
  }
  for (const side of [-1, 1]) {
    addPlume(0.06, side * 0.55, 0.04, 0.013, 0.005);
    addPlume(0.08, side * 0.95, 0.038, 0.012, 0.004);
  }
  for (let row = 0; row < 6; row++) {
    const t0 = 0.16 + row * 0.11;
    const stag = (row & 1) * 0.15;
    addPlume(t0, 0.04 * ((row & 1) * 2 - 1), 0.05, 0.018, 0.008);
    for (const side of [-1, 1]) {
      addPlume(t0, side * (0.22 + stag), 0.055, 0.018, 0.007);
      addPlume(t0 + 0.016, side * (0.52 + stag), 0.05, 0.016, 0.006);
    }
  }
  for (let row = 0; row < 4; row++) {
    const t0 = 0.26 + row * 0.12;
    const stag = (row & 1) * 0.16;
    for (const side of [-1, 1]) {
      addPlume(t0, Math.PI + side * (0.28 + stag), 0.062, 0.019, 0.006);
    }
  }
  for (let i = 0; i < 6; i++) {
    const k = i / 5 - 0.5;
    addPlume(0.72, k * 0.85, 0.12, 0.022, 0.01);
  }
  }

  // 灏?无整板垫,瑕嗙窘鐩栦綇鑵?舵羽叠成圆扇
  {
    if (high) {
    for (let i = 0; i < 8; i++) {
      const side = i / 7 - 0.5;
      const lobe = Math.abs(side) * 2;
      const ang = side * 0.28;
      addFeather(
        -0.42,
        0.022 - lobe * 0.003,
        side * 0.028,
        -Math.cos(ang),
        Math.sin(ang),
        0.12 + (1 - lobe) * 0.03,
        0.026,
        lobe * 0.25,
        lobe * 0.25,
        2,
        TL0,
        TLW,
        3,
        "oval",
        1,
        2,
      );
    }
    for (let i = 0; i < 6; i++) {
      const side = i / 5 - 0.5;
      const lobe = Math.abs(side) * 2;
      const ang = side * 0.24;
      addFeather(
        -0.45,
        0.008 - lobe * 0.002,
        side * 0.022,
        -Math.cos(ang),
        Math.sin(ang),
        0.1,
        0.022,
        lobe * 0.22,
        lobe * 0.22,
        2,
        TL0,
        TLW,
        3,
        "oval",
        1,
        2,
      );
    }
    }

    const RAYS = high ? 10 : 6;
    for (let i = 0; i < RAYS; i++) {
      const k = i / (RAYS - 1);
      const side = k - 0.5;
      const lobe = Math.abs(side) * 2;
      const ang = side * 0.52;
      const len = 0.22 * (1.04 - lobe * lobe * 0.28);
      addFeather(
        -0.48,
        0.011 - lobe * 0.004 + (0.5 - k) * 0.0015,
        side * 0.02,
        -Math.cos(ang),
        Math.sin(ang),
        len,
        0.024 * (1.08 - lobe * 0.2),
        lobe,
        lobe,
        2,
        TL0,
        TLW,
        4,
        "blade",
        1,
        3,
      );
    }
  }

  const addTube = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    r0: number,
    r1: number,
    u: number,
    v: number,
    p: number,
    sides: number,
  ) => {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz) || 1;
    const fx = dx / len;
    const fy = dy / len;
    const fz = dz / len;
    let px_ = fy;
    let py_ = -fx;
    let pz_ = 0;
    const ul = Math.hypot(px_, py_, pz_) || 1;
    px_ /= ul;
    py_ /= ul;
    pz_ /= ul;
    const sx = fy * pz_ - fz * py_;
    const sy = fz * px_ - fx * pz_;
    const sz = fx * py_ - fy * px_;
    const rings: number[][] = [];
    for (let s = 0; s <= 3; s++) {
      const t = s / 3;
      const x = ax + dx * t;
      const y = ay + dy * t;
      const z = az + dz * t;
      const rad = r0 + (r1 - r0) * t;
      const row: number[] = [];
      for (let k = 0; k <= sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        row.push(
          push(
            x + (px_ * ca + sx * sa) * rad,
            y + (py_ * ca + sy * sa) * rad,
            z + (pz_ * ca + sz * sa) * rad,
            u,
            v,
            p,
          ),
        );
      }
      rings.push(row);
    }
    for (let s = 0; s < 3; s++) {
      for (let k = 0; k < sides; k++) {
        const a = rings[s][k] as number;
        const b = rings[s][k + 1] as number;
        const c = rings[s + 1][k] as number;
        const d = rings[s + 1][k + 1] as number;
        idx.push(a, c, b, b, c, d);
      }
    }
  };

  const addLeg = (sgn: number) => {
    const hx = 0.04;
    const hy = -0.054;
    const hz = sgn * 0.02;
    const ax = -0.058;
    const ay = -0.09;
    const az = sgn * 0.018;
    // 腿 / 趾钉到皮肤 tile 底部色块(u<0.5 趾、u>0.5 腿:白鹭黑腿黄趾)
    addTube(hx, hy, hz, ax, ay, az, 0.009, 0.0055, 0.54, SKIN_LEG_V, 6, 4);
    const toes: [number, number, number][] = [
      [-0.042, -0.014, sgn * 0.011],
      [-0.05, -0.012, 0],
      [-0.04, -0.014, sgn * -0.01],
      [0.024, -0.01, sgn * -0.004],
    ];
    for (const [tdx, tdy, tdz] of toes) {
      addTube(ax, ay, az, ax + tdx, ay + tdy, az + tdz, 0.0044, 0.002, 0.46, SKIN_LEG_V, 7, 3);
    }
  };
  if (high) {
    addLeg(1);
    addLeg(-1);
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("uv", new BufferAttribute(new Float32Array(uvA), 2));
  geo.setAttribute("aPart", new BufferAttribute(new Float32Array(part), 1));
  geo.setAttribute("aSpan", new BufferAttribute(new Float32Array(spanA), 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// 鏍栨伅鍦伴€夌偣
// ---------------------------------------------------------------------------

const MAX_SPOTS = 96;

type BirdSpot = {
  x: number;
  z: number;
  ground: number;
  wy: number;
  rich: number;
  habitat: Habitat;
};

const HABITAT_BUDGET: Record<Habitat, { max: number; spacing: number }> = {
  urban: { max: 16, spacing: 42 },
  farmland: { max: 14, spacing: 48 },
  forest: { max: 14, spacing: 52 },
  meadow: { max: 12, spacing: 50 },
  wetland: { max: 12, spacing: 36 },
  water: { max: 14, spacing: 40 },
  coast: { max: 10, spacing: 48 },
  alpine: { max: 8, spacing: 58 },
};

type Climate = {
  absLat: number;
  lon: number;
  snow: number;
  moist: number;
  waterFrac: number;
  wind: number;
  night: boolean;
};

function sampleClimate(
  fields: WorldFields,
  lat: number,
  lon: number,
  env: EnvState,
): Climate {
  const { res } = fields;
  const stride = Math.max(8, Math.floor(res / 64));
  let snow = 0;
  let moist = 0;
  let n = 0;
  let waterN = 0;
  const thresh = WATER_NONE * 0.5;
  for (let z = 0; z < res; z += stride) {
    for (let x = 0; x < res; x += stride) {
      const i = z * res + x;
      snow += fields.snow[i] as number;
      moist += fields.moisture[i] as number;
      n++;
      if ((fields.waterY[i] as number) > thresh) waterN++;
    }
  }
  return {
    absLat: Math.abs(lat),
    lon,
    snow: n > 0 ? snow / n : 0,
    moist: n > 0 ? moist / n : 0,
    waterFrac: n > 0 ? waterN / n : 0,
    wind: env.windStrength.value as number,
    night: env.timeOfDay === "night",
  };
}

function pickBirdSpots(fields: WorldFields): BirdSpot[] {
  const { res, size, masks } = fields;
  const stride = Math.max(2, Math.floor(res / 160));
  const thresh = WATER_NONE * 0.5;
  const rt = Math.max(2, Math.round((16 / size) * res));
  const idx = (px: number, pz: number) => pz * res + px;
  const waterAt = (px: number, pz: number): boolean => {
    if (px < 0 || pz < 0 || px >= res || pz >= res) return false;
    return (fields.waterY[pz * res + px] as number) > thresh;
  };

  const buckets: Record<Habitat, (BirdSpot & { w: number })[]> = {
    urban: [],
    farmland: [],
    forest: [],
    meadow: [],
    wetland: [],
    water: [],
    coast: [],
    alpine: [],
  };

  for (let pz = 2; pz < res - 2; pz += stride) {
    for (let px = 2; px < res - 2; px += stride) {
      const i = idx(px, pz);
      const ground = fields.heights[i] as number;
      const wy = fields.waterY[i] as number;
      const inWater = wy > thresh && wy - ground > 0.08;
      const biome = fields.biome[i] as number;
      const snow = fields.snow[i] as number;
      const urban = masks.urban[i] as number;
      const farm = masks.farmland[i] as number;
      const forestM = masks.forest[i] as number;
      const wetM = masks.wetland[i] as number;
      const sand = masks.sand[i] as number;
      const grass = masks.grass[i] as number;

      let nearWater = inWater;
      if (!nearWater) {
        nearWater =
          waterAt(px + rt, pz) ||
          waterAt(px - rt, pz) ||
          waterAt(px, pz + rt) ||
          waterAt(px, pz - rt);
      }

      let habitat: Habitat | null = null;
      let w = 0;
      if (sand > 0.35 && nearWater) {
        habitat = "coast";
        w = 4 + sand * 3 + (inWater ? 2 : 0);
      } else if (inWater) {
        habitat = "water";
        w = 3 + Math.min(wy - ground, 6) * 0.35;
      } else if (biome === BIOME.wetland || wetM > 0.4) {
        habitat = "wetland";
        w = 3.5 + wetM * 2 + (fields.moisture[i] as number);
      } else if (biome === BIOME.alpine || snow > 0.45) {
        habitat = "alpine";
        w = 2.5 + snow * 2;
      } else if (urban > 0.45 || biome === BIOME.urban) {
        habitat = "urban";
        w = 3 + urban * 2.5;
      } else if (farm > 0.45 || biome === BIOME.farmland) {
        habitat = "farmland";
        w = 2.8 + farm * 2;
      } else if (
        biome === BIOME.forest ||
        biome === BIOME.rainforest ||
        forestM > 0.4
      ) {
        habitat = "forest";
        w = 3 + forestM * 2 + (fields.vegDensity[i] as number);
      } else if (biome === BIOME.meadow || grass > 0.35) {
        habitat = "meadow";
        w = 2.2 + grass + (fields.vegDensity[i] as number) * 0.8;
      }
      if (!habitat) continue;

      const x = (px / res - 0.5) * size;
      const z = (pz / res - 0.5) * size;
      const rich = Math.min(Math.max(0.6 + w * 0.18, 0.6), 2.0);
      buckets[habitat].push({
        x,
        z,
        ground,
        wy: inWater ? wy : ground,
        rich,
        habitat,
        w,
      });
    }
  }

  const spots: BirdSpot[] = [];
  const farEnough = (cd: BirdSpot, spacing: number): boolean => {
    for (const sp of spots) {
      if (Math.hypot(sp.x - cd.x, sp.z - cd.z) < spacing) return false;
    }
    return true;
  };

  for (const habitat of Object.keys(HABITAT_BUDGET) as Habitat[]) {
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
        ground: cd.ground,
        wy: cd.wy,
        rich: cd.rich,
        habitat: cd.habitat,
      });
      n++;
    }
  }
  return spots;
}

function speciesFits(spec: SpeciesDef, habitat: Habitat, climate: Climate): boolean {
  if (!spec.habitats.includes(habitat)) return false;
  if (climate.absLat < spec.lat[0] || climate.absLat > spec.lat[1]) return false;
  if (spec.snowNeed && climate.snow < 0.12 && climate.absLat < 55) return false;
  if (!spec.snowOk && climate.snow > 0.55) return false;
  if (spec.len[1] < 0.22 && climate.wind > spec.windTol + 0.08) return false;
  if (spec.name === "喜鹊") {
    const palearctic = climate.lon > -20 && climate.lon < 155;
    const westNA = climate.lon > -140 && climate.lon < -95 && climate.absLat > 32;
    if (!palearctic && !westNA) return false;
  }
  return true;
}

function chooseSpecies(
  habitat: Habitat,
  climate: Climate,
  rng: () => number,
  used: number[],
): number {
  const cand: number[] = [];
  for (let i = 0; i < SPECIES.length; i++) {
    if (speciesFits(SPECIES[i] as SpeciesDef, habitat, climate)) cand.push(i);
  }
  if (cand.length === 0) {
    if (climate.snow > 0.4 || climate.absLat > 55) return SNOWY_I;
    if (habitat === "forest") return OWL_I;
    return SPARROW_I;
  }
  cand.sort((a, b) => (used[a] as number) - (used[b] as number));
  const lowest = used[cand[0] as number] as number;
  const pool = cand.filter((i) => (used[i] as number) === lowest);
  const pick = pool[Math.floor(rng() * pool.length)] as number;
  used[pick] = (used[pick] as number) + 1;
  return pick;
}

type FlockCfg = {
  spot: BirdSpot;
  spec: SpeciesDef;
  count: number;
  y: number;
  rx: number;
  rz: number;
  angSpeed: number;
  phase: number;
  behavior: 0 | 1 | 2;
  aux0: number;
  aux1: number;
  bobAmp: number;
  rot: number;
  beacon: boolean;
};

function buildFlocks(
  spots: BirdSpot[],
  climate: Climate,
  rng: () => number,
): FlockCfg[] {
  const used = SPECIES.map(() => 0);
  const flocks: FlockCfg[] = [];

  const makeFlock = (spot: BirdSpot, beacon: boolean): void => {
    const spec = SPECIES[chooseSpecies(spot.habitat, climate, rng, used)] as SpeciesDef;
    const windCut = spec.len[1] < 0.25 ? Math.max(0.45, 1.15 - climate.wind) : 1;
    const nightCut = spec.night === climate.night ? 1 : 0.35;
    const wetBoost =
      spec.habitats.includes("wetland") || spec.habitats.includes("water")
        ? 0.8 + climate.moist * 0.45 + climate.waterFrac * 0.35
        : 1;
    const base = spec.school[0] + rng() * (spec.school[1] - spec.school[0] + 1);
    const count = Math.max(
      Math.min(
        Math.round(base * spot.rich * 1.6 * windCut * nightCut * wetBoost),
        spec.school[1] * 3,
      ),
      spec.school[0],
      2,
    );
    const crowd = 1 + Math.min(count, 60) * 0.02;
    const rMax = (8 + spec.cruiseH[1] * 0.18) * (0.7 + spot.rich * 0.45) * crowd;
    let rx = (0.55 + rng() * 0.5) * rMax;
    let rz = rx * (0.55 + rng() * 0.4);
    if (spec.formation === "mill") {
      rx *= 0.85;
      rz = rx * (0.88 + rng() * 0.12);
    }
    if (spec.formation === "vee") {
      rx *= 1.25;
      rz = rx * 0.45;
    }
    const linSpeed = spec.speed[0] + rng() * (spec.speed[1] - spec.speed[0]);
    const angSpeed = (linSpeed / Math.max(rx, 4)) * (rng() < 0.5 ? -1 : 1);
    const y0 = Math.max(spot.ground, spot.wy);
    const y = y0 + spec.cruiseH[0] + rng() * (spec.cruiseH[1] - spec.cruiseH[0]);
    flocks.push({
      spot,
      spec,
      count,
      y,
      rx,
      rz,
      angSpeed,
      phase: rng(),
      behavior: spec.behavior,
      aux0: spec.behavior === 2 ? 5 + rng() * 8 : 0.5 + rng() * 0.4,
      aux1: Math.min(6 + rng() * 10, rMax + 4),
      bobAmp: 0.4 + rng() * (spec.cruiseH[1] - spec.cruiseH[0]) * 0.18,
      rot: rng() * Math.PI * 2,
      beacon,
    });
  };

  for (const spot of spots) {
    makeFlock(spot, true);
    const extra =
      spot.habitat === "water" || spot.habitat === "wetland"
        ? 1
        : spot.habitat === "urban" && spot.rich > 1.2
          ? 1
          : 0;
    for (let k = 0; k < extra; k++) {
      const ang = rng() * Math.PI * 2;
      const off = 8 + rng() * 14;
      makeFlock(
        {
          ...spot,
          x: spot.x + Math.cos(ang) * off,
          z: spot.z + Math.sin(ang) * off,
        },
        false,
      );
    }
  }

  const total = flocks.reduce((s, c) => s + c.count, 0);
  if (total > MAX_BIRDS) {
    const k = MAX_BIRDS / total;
    let usedN = 0;
    for (let i = 0; i < flocks.length; i++) {
      const sc = flocks[i] as FlockCfg;
      if (i === flocks.length - 1) {
        sc.count = Math.max(2, MAX_BIRDS - usedN);
      } else {
        sc.count = Math.max(2, Math.round(sc.count * k));
        usedN += sc.count;
      }
    }
  }
  return flocks;
}

function formationOffset(
  f: Formation,
  i: number,
  count: number,
  angSpeed: number,
  rng: () => number,
): [number, number, number] {
  const g = () => (rng() + rng() + rng()) / 3 - 0.5;
  switch (f) {
    case "column": {
      const span = 4.5 + Math.min(count, 40) * 0.12;
      return [(i / Math.max(count - 1, 1)) * span, g() * 2.4, (rng() - 0.5) * 3.2];
    }
    case "vee": {
      const side = i % 2 === 0 ? 1 : -1;
      const rank = Math.floor((i + 1) / 2);
      return [rank * 0.55, side * rank * 1.15 + g() * 0.35, (rng() - 0.5) * 0.8];
    }
    case "ball": {
      const s = 1 + Math.min(count, 50) * 0.022;
      return [rng() * 0.8, g() * 3.6 * s, g() * 2.8 * s];
    }
    case "mill": {
      const period = (Math.PI * 2) / Math.max(Math.abs(angSpeed), 0.04);
      const s = 1 + Math.min(count, 70) * 0.014;
      return [(i / count) * period + rng() * 0.25, (rng() - 0.5) * 2.2 * s, (rng() - 0.5) * 3.4 * s];
    }
    case "layer": {
      const s = 1 + Math.min(count, 40) * 0.02;
      return [rng() * 1.4, g() * 4.2 * s, (rng() - 0.5) * 1.6 * s];
    }
    case "pack": {
      const s = 1 + Math.min(count, 30) * 0.025;
      return [rng() * 0.7, g() * 3.0 * s, (rng() - 0.5) * 2.4 * s];
    }
  }
}

function pathEval(aN: NV4, bN: NV4, dN: NV4, rN: NV4, t: NF): NV3 {
  const ang = t.mul(bN.z).add(bN.w.mul(6.2831853)).toVar();
  const ell = vec2(cos(ang).mul(bN.x), sin(ang).mul(bN.y));

  const ang2 = t.mul(bN.z.mul(dN.y)).add(bN.w.mul(11.31));
  const lis = vec2(sin(ang).mul(bN.x), sin(ang2).mul(bN.y));

  const per = dN.y.max(2);
  const cyc = t.div(per).floor();
  const ph = t.div(per).fract();
  const dirA = hash2(vec2(cyc, bN.w.mul(97)), 7).mul(6.2831853);
  const pulse = smoothstep(0.02, 0.12, ph).mul(smoothstep(0.7, 0.22, ph));
  const idle = vec2(
    cos(t.mul(0.42).add(bN.w.mul(6.28))).mul(bN.x.mul(0.32)),
    sin(t.mul(0.37).add(bN.w.mul(9.4))).mul(bN.y.mul(0.32)),
  );
  const dart = idle.add(vec2(cos(dirA), sin(dirA)).mul(dN.z.mul(pulse)));

  const bid = dN.x;
  const w0 = float(1).sub(bid.abs().min(1));
  const w1 = float(1).sub(bid.sub(1).abs().min(1));
  const w2 = float(1).sub(bid.sub(2).abs().min(1));
  const xz = ell.mul(w0).add(lis.mul(w1)).add(dart.mul(w2)).toVar();
  const rxz = vec2(
    xz.x.mul(rN.x).sub(xz.y.mul(rN.y)),
    xz.x.mul(rN.y).add(xz.y.mul(rN.x)),
  ).toVar();
  const y = aN.y
    .add(sin(t.mul(0.38).add(bN.w.mul(6.2831853))).mul(dN.w))
    .add(w2.mul(pulse).mul(dN.z).mul(0.35));
  return vec3(aN.x.add(rxz.x), y, aN.z.add(rxz.y)).toVar() as unknown as NV3;
}

function createBirdMesh(
  tex: WorldTextures,
  env: EnvState,
  flocks: FlockCfg[],
): {
  high: InstancedMesh;
  low: InstancedMesh;
  update: (camera: PerspectiveCamera) => void;
} {
  const total = Math.min(
    flocks.reduce((s, c) => s + c.count, 0),
    MAX_BIRDS,
  );
  const n = Math.max(total, 1);

  // 皮肤库:每个在场鸟种 SKIN_VARIANTS 张个体变体 tile,同种个体只从本种库取
  const bankOf = new Map<number, number>();
  for (const sc of flocks) {
    const si = Math.max(0, SPECIES.indexOf(sc.spec));
    if (!bankOf.has(si)) bankOf.set(si, bankOf.size * SKIN_VARIANTS);
  }
  const pack = packSkinAtlas(Math.max(1, bankOf.size * SKIN_VARIANTS));
  const atlasW = pack.cols * pack.tw;
  const atlasH = pack.rows * pack.th;
  if (atlasW > ATLAS_MAX || atlasH > ATLAS_MAX) {
    throw new Error(`bird skin atlas ${atlasW}x${atlasH} exceeds ${ATLAS_MAX}`);
  }
  const pix = new Uint8Array(atlasW * atlasH * 4);
  const maxTiles = pack.cols * pack.rows;
  for (const [si, start] of bankOf) {
    const spec = SPECIES[si] as SpeciesDef;
    for (let k = 0; k < SKIN_VARIANTS; k++) {
      const tile = (start + k) % maxTiles;
      paintBirdSkin(
        pix,
        atlasW,
        (tile % pack.cols) * pack.tw,
        Math.floor(tile / pack.cols) * pack.th,
        pack.tw,
        pack.th,
        spec.id,
        ((si + 1) * 7919 + (k + 1) * 104729 + 20260819) >>> 0,
      );
    }
  }

  const ROWS = 9;
  const data = new Float32Array(n * ROWS * 4);
  const rng = makeRng(20260819);
  const slices: { start: number; count: number; x: number; y: number; z: number; r: number }[] = [];
  let fi = 0;
  for (const sc of flocks) {
    const start = fi;
    const { spec } = sc;
    for (let i = 0; i < sc.count; i++) {
      if (fi >= n) break;
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
      const lenT = i === 0 ? 0.7 + rng() * 0.3 : rng();
      const len = spec.len[0] + (spec.len[1] - spec.len[0]) * lenT;
      const yBias = (rng() - 0.5) * Math.min(spec.cruiseH[1] * 0.12, 4);

      put(0, sc.spot.x, sc.y + yBias, sc.spot.z, len);
      put(1, sc.rx, sc.rz, sc.angSpeed, sc.phase);
      put(2, lag, lat * (0.45 + len), vert, rng());
      put(3, sc.behavior, sc.aux0, sc.aux1, sc.bobAmp * (0.7 + rng() * 0.6));

      const specIdx = Math.max(0, SPECIES.indexOf(spec));
      const tint = 0.9 + rng() * 0.18;
      const hSpan = Math.max(spec.heightK[1] - spec.heightK[0], 0.05);
      const wSpan = Math.max(spec.widthK[1] - spec.widthK[0], 0.04);
      // 从本种皮肤库随机取一张个体变体
      const tileIdx = ((bankOf.get(specIdx) ?? 0) + Math.floor(rng() * SKIN_VARIANTS)) % maxTiles;
      put(
        4,
        spec.heightK[0] - hSpan * 0.18 + rng() * hSpan * 1.36,
        spec.widthK[0] - wSpan * 0.18 + rng() * wSpan * 1.36,
        tint,
        specIdx,
      );
      const flapHz = spec.flapHz[0] + rng() * (spec.flapHz[1] - spec.flapHz[0]);
      put(5, flapHz, spec.glide * (0.85 + rng() * 0.3), spec.wingSpan, spec.tailLen);
      put(6, spec.night ? 1 : 0, spec.beakLen, 0.35 + rng() * 0.7, spec.flapAmp * (0.82 + rng() * 0.36));
      const floorPad = 1.1 + len * 0.8;
      const ceilPad = spec.cruiseH[1] + 8 + rng() * 6;
      // z/w:逐实例色相偏移(−1 冷 .. +1 暖)与饱和度(0.85..1.15)—— 同 tile 的个体也不完全相同
      put(7, floorPad, ceilPad, rng() * 2 - 1, 0.85 + rng() * 0.3);
      put(8, Math.cos(sc.rot), Math.sin(sc.rot), 0.4 + rng() * 1.1, tileIdx);
      fi++;
    }
    if (fi > start) {
      slices.push({
        start,
        count: fi - start,
        x: sc.spot.x,
        y: sc.y,
        z: sc.spot.z,
        r: Math.max(sc.rx, sc.rz) + 12,
      });
    }
    if (fi >= n) break;
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
  skinAtlas.minFilter = LinearMipmapLinearFilter;
  skinAtlas.wrapS = ClampToEdgeWrapping;
  skinAtlas.wrapT = ClampToEdgeWrapping;
  skinAtlas.colorSpace = SRGBColorSpace;
  skinAtlas.generateMipmaps = true;
  skinAtlas.flipY = false;
  skinAtlas.needsUpdate = true;
  const morphTex = buildMorphTex();

  const remapData = new Float32Array(HIGH_CAP * 4);
  const remapTex = new DataTexture(remapData, 1, HIGH_CAP, RGBAFormat, FloatType);
  remapTex.magFilter = NearestFilter;
  remapTex.minFilter = NearestFilter;
  remapTex.wrapS = ClampToEdgeWrapping;
  remapTex.wrapT = ClampToEdgeWrapping;
  remapTex.generateMipmaps = false;
  remapTex.needsUpdate = true;

  const lowRemapData = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) lowRemapData[i * 4] = i;
  const lowRemapTex = new DataTexture(lowRemapData, 1, n, RGBAFormat, FloatType);
  lowRemapTex.magFilter = NearestFilter;
  lowRemapTex.minFilter = NearestFilter;
  lowRemapTex.wrapS = ClampToEdgeWrapping;
  lowRemapTex.wrapT = ClampToEdgeWrapping;
  lowRemapTex.generateMipmaps = false;
  lowRemapTex.needsUpdate = true;

  const makeLayer = (
    detail: "high" | "low",
    cap: number,
    remap: DataTexture,
    isHigh: boolean,
  ): InstancedMesh => {
    const geo = birdGeometry(detail);
    const mat = new MeshBasicNodeMaterial();
    mat.side = DoubleSide;
    mat.fog = true;

    const instI = textureLoad(remap, ivec2(0, instanceIndex.toInt())).x.toInt();
    const fp = (row: number) =>
      textureLoad(pTex, ivec2(row, instI)).toVar() as unknown as NV4;
    const a = fp(0);
    const b = fp(1);
    const c = fp(2);
    const d = fp(3);
    const e = fp(4);
    const fP = fp(5);
    const gC = fp(6);
    const t7 = fp(7);
    const rC = fp(8);
    const specI = e.w.toInt();
    const m0 = textureLoad(morphTex, ivec2(0, specI)).toVar() as unknown as NV4;
    const m1 = textureLoad(morphTex, ivec2(1, specI)).toVar() as unknown as NV4;
    const m2 = textureLoad(morphTex, ivec2(2, specI)).toVar() as unknown as NV4;
    const aPart = attribute("aPart") as unknown as NF;
    const aSpan = attribute("aSpan") as unknown as NF;

    const tf = env.time.sub(c.x).toVar();
    const p0 = pathEval(a, b, d, rC, tf);
    const p1 = pathEval(a, b, d, rC, tf.add(0.16));
    const p2 = pathEval(a, b, d, rC, tf.add(0.64));
    const vel = p1.sub(p0).div(0.16).toVar();
    const speed = vel.length().max(0.04).toVar();
    const F = vel.div(speed).toVar();
    const r0 = vec3(F.z, 0, F.x.negate()).toVar();
    const R = r0.div(r0.length().max(0.0001)).toVar();
    const u0 = vec3(
      F.y.mul(R.z).sub(F.z.mul(R.y)),
      F.z.mul(R.x).sub(F.x.mul(R.z)),
      F.x.mul(R.y).sub(F.y.mul(R.x)),
    ).toVar();
    const U = u0.div(u0.length().max(0.0001)).toVar();
    const dh = p2.sub(p1).toVar();
    const h2 = dh.div(dh.length().max(0.0001)).toVar();
    const yawP = clamp(F.x.mul(h2.z).sub(F.z.mul(h2.x)).mul(1.8), -0.7, 0.7).toVar();
    const roll = yawP.mul(1.15);
    const cr = cos(roll);
    const sr = sin(roll);
    const R2 = R.mul(cr).add(U.mul(sr)).toVar();
    const U2 = U.mul(cr).sub(R.mul(sr)).toVar();

    const wanL = sin(tf.mul(0.38).add(c.w.mul(6.2831853))).mul(rC.z);
    const wanV = cos(tf.mul(0.29).add(c.w.mul(9.7))).mul(rC.z.mul(0.45));
    const c0 = p0.add(R.mul(c.y.add(wanL))).add(U.mul(c.z.add(wanV))).toVar();
    const cxz = vec2(c0.x, c0.z).toVar();
    const bedH = sampleFloatBilinear(tex.heightTex, cxz, tex.res, tex.size);
    const wl = sampleWaterLevel(tex.waterExtTex, cxz, tex.res, tex.size);
    const floorY = mix(bedH, bedH.max(wl.y), wl.valid).add(t7.x).toVar();
    const yMax = floorY.add(t7.y).toVar();
    const center = vec3(c0.x, clamp(c0.y, floorY, yMax), c0.z).toVar();

    const wArm = float(1).sub(aPart.sub(1).abs().min(1)).toVar();
    const wHand = float(1).sub(aPart.sub(5).abs().min(1)).toVar();
    const wTail = float(1).sub(aPart.sub(2).abs().min(1)).toVar();
    const wBeak = float(1).sub(aPart.sub(3).abs().min(1)).toVar();
    const wEye = float(1).sub(aPart.sub(4).abs().min(1)).toVar();
    const wFoot = float(1).sub(aPart.sub(6).abs().min(1)).toVar();
    const wClaw = float(1).sub(aPart.sub(7).abs().min(1)).toVar();
    const wWing = wArm.add(wHand).toVar();
    const wLeg = wFoot.add(wClaw).toVar();
    const wBody = float(1)
      .sub(wWing)
      .sub(wTail)
      .sub(wBeak)
      .sub(wEye)
      .sub(wLeg)
      .max(0);

    const glideK = fP.y.min(0.95);
    const flapPh = env.time.mul(fP.x).add(c.w.mul(6.2831853)).toVar();
    const burst = smoothstep(float(-0.12), float(0.38), sin(env.time.mul(0.31).add(c.w.mul(5.1))));
    const flapGain = mix(float(1), burst, glideK.mul(0.7)).mul(float(1).sub(glideK.mul(0.12)));
    const spanK = clamp(aSpan, 0, 1).toVar();
    const trailK = clamp(uv().y.sub(0.54).div(0.46), 0, 1);
    const wave = sin(flapPh.sub(spanK.mul(0.58)).sub(trailK.mul(0.32))).toVar();
    const waveA = wave.mul(0.96).sub(0.1).mul(flapGain).mul(gC.w).toVar();
    const amp = mix(float(0.5), float(1.48), spanK.mul(spanK.mul(0.42).add(0.58)));
    const theta = float(0.1)
      .add(waveA.mul(amp))
      .add(wHand.mul(waveA).mul(0.08))
      .mul(wWing)
      .toVar();
    const cFl = cos(theta);
    const sFl = sin(theta);
    const zAbs = positionLocal.z.abs();
    const tLobe = mix(zAbs.mul(4.2).min(1), clamp(aSpan, 0, 1), wTail).toVar();

    const px0 = positionLocal.x
      .add(wBeak.mul(m1.x.sub(1)).mul(positionLocal.x.sub(0.5).max(0)).mul(2.4))
      .add(wTail.mul(m0.z.sub(1)).mul(positionLocal.x.add(0.48)))
      .add(wTail.mul(m0.w).mul(tLobe).mul(positionLocal.x.add(0.42)).mul(1.15))
      .sub(wWing.mul(m0.y).mul(positionLocal.x.sub(0.1).max(0)).mul(0.48))
      .add(wWing.mul(m1.y.sub(1)).mul(positionLocal.x.sub(0.02)))
      .add(
        wWing
          .mul(m1.z)
          .mul(sin(spanK.mul(3.14159)))
          .mul(smoothstep(-0.02, 0.16, positionLocal.x))
          .mul(0.04),
      );
    const headK = smoothstep(0.34, 0.52, positionLocal.x).mul(wBody.add(wEye).add(wBeak.mul(0.35)));
    const py0 = positionLocal.y
      .mul(e.x)
      .mul(headK.mul(0.22).add(1))
      .add(wBeak.mul(m1.x.sub(1)).mul(-0.014))
      .add(wEye.mul(0.004));
    const pz0 = positionLocal.z
      .mul(e.y)
      .mul(headK.mul(0.18).add(1))
      .mul(wWing.mul(m0.x.sub(1)).add(1))
      .mul(wTail.mul(m2.x.sub(1)).add(1))
      .mul(wBeak.mul(0.12).add(1))
      .mul(wEye.mul(0.28).add(1));

    const ySh = float(0.036);
    const zSh = float(0.108);
    const yRel = py0.sub(ySh);
    const zRel = zAbs.sub(zSh);
    const upK = smoothstep(float(-0.1), float(0.68), theta);
    const downK = smoothstep(float(0.18), float(-0.52), theta);
    const wrist = smoothstep(0.36, 0.92, spanK);
    const fold = upK.mul(mix(wrist.mul(0.18), float(0.28), wHand));
    const pyW = ySh.add(yRel.mul(cFl)).add(zRel.mul(sFl));
    const zWabs = zSh
      .add(zRel.mul(cFl))
      .sub(yRel.mul(sFl))
      .mul(float(1).add(downK.mul(spanK).mul(0.11)))
      .mul(float(1).sub(fold.mul(0.22)));
    const zSgn = pz0.div(zAbs.max(0.0001));
    const pzW = zSgn.mul(zWabs.max(0.02));
    const pxW = px0.sub(fold.mul(spanK).mul(mix(float(0.045), float(0.12), wHand)));
    const flapIn = waveA;
    const flapOut = sin(flapPh.sub(0.5)).mul(flapGain).mul(gC.w);
    const tailSpread = float(0.96).add(flapIn.mul(0.08));
    const pyT = py0.add(flapIn.mul(0.04)).add(yawP.abs().mul(tLobe).mul(0.022));
    const pzT = pz0.mul(tailSpread).add(yawP.mul(0.07).mul(tLobe));
    const pxT = px0.add(flapIn.mul(m0.w).mul(tLobe).mul(-0.035));
    const pyL = py0.add(flapIn.mul(0.014)).add(wClaw.mul(flapOut).mul(0.008));
    const pxL = px0.add(flapIn.mul(-0.018));
    const pzL = pz0.mul(float(0.9).add(flapIn.mul(0.06)));

    const px = px0
      .add(wWing.mul(pxW.sub(px0)))
      .add(wTail.mul(pxT.sub(px0)))
      .add(wLeg.mul(pxL.sub(px0)));
    const py = py0
      .add(wWing.mul(pyW.sub(py0)))
      .add(wTail.mul(pyT.sub(py0)))
      .add(wLeg.mul(pyL.sub(py0)));
    const pz = pz0
      .add(wWing.mul(pzW.sub(pz0)))
      .add(wTail.mul(pzT.sub(pz0)))
      .add(wLeg.mul(pzL.sub(pz0)));

    const s = float(0.5).sub(px);
    const zBend = yawP.mul(s.sub(0.25)).mul(0.28);
    const visDay = env.nightK.oneMinus();
    const vis = mix(visDay, env.nightK, m1.w);
    const dist = cameraPosition.sub(center).length();
    const lodShow = isHigh
      ? smoothstep(66, 52, dist)
      : smoothstep(48, 62, dist);
    const show = smoothstep(0.06, 0.32, vis).mul(lodShow);

    mat.positionNode = center.add(
      F.mul(px).add(U2.mul(py)).add(R2.mul(pz.add(zBend))).mul(a.w.mul(show)),
    );

    const tintV = varying(e.z) as unknown as NF;
    const trailV = varying(trailK.mul(wWing)) as unknown as NF;
    const nl = normalLocal;
    const nWv = varying(F.mul(nl.x).add(U2.mul(nl.y)).add(R2.mul(nl.z))) as unknown as NV3;
    const colsN = float(pack.cols);
    const rowsN = float(pack.rows);
    const tileI = rC.w;
    const rowF = tileI.div(colsN).floor();
    const colF = tileI.sub(rowF.mul(colsN));
    const uTile = uv().x.mul(0.992).add(0.004);
    const vTile = uv().y.mul(0.992).add(0.004);
    const skinUvV = varying(vec2(uTile.add(colF).div(colsN), vTile.add(rowF).div(rowsN)));
    let col = texture(skinAtlas, skinUvV).xyz.mul(tintV) as unknown as NV3;
    // 逐实例色相 / 饱和度微调:同种基本纹理一致,每只略有差异
    const hueV = varying(t7.z) as unknown as NF;
    const satV = varying(t7.w) as unknown as NF;
    col = col.mul(
      vec3(hueV.mul(0.09).add(1), hueV.mul(0.02).add(1), hueV.mul(-0.09).add(1)),
    ) as unknown as NV3;
    const lumC = col.x.mul(0.3).add(col.y.mul(0.59)).add(col.z.mul(0.11));
    col = mix(vec3(lumC, lumC, lumC), col, satV) as unknown as NV3;
    const nW = nWv.normalize().toVar();
    const sd = env.sunDir;
    const lam = nW.x.mul(sd.x).add(nW.y.mul(sd.y)).add(nW.z.mul(sd.z));
    const wrap = lam.mul(0.5).add(0.5);
    col = col.mul(wrap.mul(0.42).add(0.58)) as unknown as NV3;
    // 高光:金属光泽种(燕/鹊/鸦/鸽)更强且偏蓝绿
    const sheenV = varying(m2.w) as unknown as NF;
    const spec = wrap.mul(wrap).mul(wrap).mul(sheenV.mul(0.45).add(0.1));
    col = col.add(
      vec3(
        spec.mul(sheenV.mul(-0.35).add(1)),
        spec.mul(sheenV.mul(0.1).add(0.95)),
        spec.mul(sheenV.mul(0.5).add(0.88)),
      ),
    ) as unknown as NV3;
    const rim = wrap.oneMinus().mul(trailV).mul(0.16);
    col = col.add(vec3(rim.mul(0.9), rim.mul(0.72), rim.mul(0.5))) as unknown as NV3;
    col = col.mul(env.nightK.mul(0.55).oneMinus()) as unknown as NV3;
    const faceV = varying(wBeak.mul(0.38).add(wEye.mul(0.55))) as unknown as NF;
    col = col.mul(faceV.add(1)) as unknown as NV3;
    mat.colorNode = col;

    const mesh = new InstancedMesh(geo, mat, cap);
    mesh.count = cap;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.skinAtlas = skinAtlas;
    return mesh;
  };

  const high = makeLayer("high", HIGH_CAP, remapTex, true);
  high.count = 0;
  high.renderOrder = 1;
  const low = makeLayer("low", n, lowRemapTex, false);

  let lastX = Infinity;
  let lastY = Infinity;
  let lastZ = Infinity;
  const inHigh = new Uint8Array(n);
  const update = (camera: PerspectiveCamera) => {
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    if (Number.isFinite(lastX) && Math.hypot(cx - lastX, cy - lastY, cz - lastZ) < 6) {
      return;
    }
    lastX = cx;
    lastY = cy;
    lastZ = cz;
    inHigh.fill(0);
    const ranked = slices
      .map((sl) => ({
        sl,
        d: Math.hypot(cx - sl.x, cy - sl.y, cz - sl.z) - sl.r,
      }))
      .sort((a, b) => a.d - b.d);
    let w = 0;
    for (const { sl, d } of ranked) {
      if (d > HIGH_DIST) break;
      for (let i = 0; i < sl.count && w < HIGH_CAP; i++) {
        const id = sl.start + i;
        remapData[w * 4] = id;
        inHigh[id] = 1;
        w++;
      }
      if (w >= HIGH_CAP) break;
    }
    high.count = w;
    remapTex.needsUpdate = true;

    let lw = 0;
    for (const { sl, d } of ranked) {
      for (let i = 0; i < sl.count; i++) {
        const id = sl.start + i;
        if (inHigh[id] && d < 48) continue;
        lowRemapData[lw * 4] = id;
        lw++;
      }
    }
    low.count = lw;
    lowRemapTex.needsUpdate = true;
  };

  return { high, low, update };
}
// ---------------------------------------------------------------------------
// 鸟群光柱信标(按种类配色,锚定聚集点)
// ---------------------------------------------------------------------------

const BEAM_HEIGHT = 110;

/**
 * 静态烘焙光柱:每群一根(白热内核 + 种类色外晕),世界坐标直接写进顶点,
 * 着色器只做竖向渐隐 + 呼吸脉动。柱子从地表/水面升到巡航高度以上,
 * 与鱼群信标同一套加色混合,方便在空中定位鸟群。
 */
function createBeacons(env: EnvState, flocks: FlockCfg[]): Mesh {
  const pos: number[] = [];
  const col: number[] = [];
  const fad: number[] = [];
  const idx: number[] = [];
  const SEG = 12;

  const addCyl = (
    cx: number,
    cy: number,
    cz: number,
    h: number,
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
      pos.push(cx + x * r * 0.5, cy + h, cz + z * r * 0.5);
      col.push(c[0], c[1], c[2], c[0], c[1], c[2]);
      fad.push(alpha, 0);
    }
    for (let k = 0; k < SEG; k++) {
      const a = v0 + k * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  };

  for (const sc of flocks) {
    const [br, bg, bb] = sc.spec.beam;
    const y = Math.max(sc.spot.ground, sc.spot.wy) + 0.08;
    const h = Math.max(BEAM_HEIGHT, sc.y - y + 28);
    addCyl(sc.spot.x, y, sc.spot.z, h, 0.28, [br * 0.35 + 0.55, bg * 0.35 + 0.55, bb * 0.35 + 0.55], 0.22);
    addCyl(sc.spot.x, y, sc.spot.z, h, 1.15, [br * 1.1, bg * 1.1, bb * 1.1], 0.1);
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
  mesh.renderOrder = 30;
  return mesh;
}

export type BirdFlocksSys = {
  group: Group;
  emitters: BirdFlockEmitter[];
  update: (camera: PerspectiveCamera) => void;
};

function flocksToEmitters(flocks: FlockCfg[]): BirdFlockEmitter[] {
  return flocks.map((sc, i) => ({
    id: i,
    speciesId: sc.spec.id,
    habitat: sc.spot.habitat,
    count: sc.count,
    nocturnal: sc.spec.night,
    kinematics: {
      ox: sc.spot.x,
      oy: sc.y,
      oz: sc.spot.z,
      rx: sc.rx,
      rz: sc.rz,
      angSpeed: sc.angSpeed,
      phase: sc.phase,
      behavior: sc.behavior,
      aux0: sc.aux0,
      aux1: sc.aux1,
      bobAmp: sc.bobAmp,
      rotC: Math.cos(sc.rot),
      rotS: Math.sin(sc.rot),
    },
  }));
}

export function createBirdFlocks(
  tex: WorldTextures,
  env: EnvState,
  fields: WorldFields,
  params: Pick<RegionParams, "lat" | "lon" | "timeOfDay">,
): BirdFlocksSys {
  const group = new Group();
  const idle: BirdFlocksSys = { group, emitters: [], update: () => undefined };
  const spots = pickBirdSpots(fields);
  if (spots.length === 0) return idle;
  const climate = sampleClimate(fields, params.lat, params.lon, env);
  const flocks = buildFlocks(spots, climate, makeRng((fields.seed ^ 20260819) >>> 0));
  if (flocks.length === 0) return idle;
  const layers = createBirdMesh(tex, env, flocks);
  group.add(layers.low);
  group.add(layers.high);
  group.add(createBeacons(env, flocks.filter((s) => s.beacon)));
  return { group, emitters: flocksToEmitters(flocks), update: layers.update };
}
