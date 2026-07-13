/**
 * 程序化建树器(对齐 LAAS fable5-world-demo:Skeleton/TubeMesh/FoliageCards)。
 *
 * 1. 骨架:递归分枝文法 —— 逐段生长的折线,带向性(重力/趋光)、游走噪声、
 *    悬臂下垂;子枝按轮生/黄金角螺旋叶序着生,长度受树冠包络 + 光竞争不对称调制。
 * 2. 枝干(bark):平行传输标架的广义圆柱(树干带板根瘤状扩张,梢端收尖)。
 * 3. 叶(cards):LAAS FoliageCards 方案 —— 真实叶/针叶枝簇被烘进逐树种 2×2
 *    变体图集(foliageAtlas.ts),树上每个叶锚点放一张 alpha 测试大卡片
 *    (lying 单面 / cross 十字双面),一张卡片 = 一整簇叶子只花 2–4 个三角形,
 *    这是冠层茂密感的来源。卡片法线向冠层球面融合 + 冠内 AO 烘入顶点色。
 *
 * 输出 { bark, cards } 两份几何(LAAS 同样拆 bark/foliage 两份)。
 * 顶点属性预算(WebGPU 上限 8,InstancedMesh 的 instanceMatrix 也占 1 个):
 *   相对高度(风悬臂剖面)打包进 color 的 w 通道(RGBA);bark 带 uv 做程序化板条。
 *   bark  = position/normal/color(4)/uv + instA/instB/instHue + instanceMatrix = 8
 *   cards = 上述 + uv = 8
 */

import {
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";
import type {
  CrownShape,
  FoliageParams,
  LeafShape,
  SpeciesParams,
} from "./species";

/** mulberry32 确定性 RNG */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UP = new Vector3(0, 1, 0);
const GOLDEN = 2.39996323; // 黄金角(弧度)

// ---------------------------------------------------------------------------
// 网格累加器(LAAS MeshGrower 等价,输出本引擎的属性布局)
// ---------------------------------------------------------------------------

export class Grower {
  private pos: number[] = [];
  private nrm: number[] = [];
  private uvA: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];
  vertCount = 0;

  vertex(
    px: number, py: number, pz: number,
    nx: number, ny: number, nz: number,
    u: number, v: number,
    r: number, g: number, b: number,
    heightK: number,
  ): number {
    this.pos.push(px, py, pz);
    this.nrm.push(nx, ny, nz);
    this.uvA.push(u, v);
    this.col.push(r, g, b, heightK);
    return this.vertCount++;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }

  /** 法线向以 center 为球心的球面法线融合(叶冠聚合光照技巧) */
  bendNormals(center: Vector3, radius: number, k: number, fromVert: number): void {
    const inv = 1 / Math.max(0.001, radius);
    for (let i = fromVert; i < this.vertCount; i++) {
      let sx = ((this.pos[i * 3] as number) - center.x) * inv;
      let sy = ((this.pos[i * 3 + 1] as number) - center.y) * inv;
      let sz = ((this.pos[i * 3 + 2] as number) - center.z) * inv;
      const sl = Math.hypot(sx, sy, sz) || 1;
      sx /= sl; sy /= sl; sz /= sl;
      const nx = (this.nrm[i * 3] as number) * (1 - k) + sx * k;
      const ny = (this.nrm[i * 3 + 1] as number) * (1 - k) + sy * k;
      const nz = (this.nrm[i * 3 + 2] as number) * (1 - k) + sz * k;
      const l = Math.hypot(nx, ny, nz) || 1;
      this.nrm[i * 3] = nx / l;
      this.nrm[i * 3 + 1] = ny / l;
      this.nrm[i * 3 + 2] = nz / l;
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array(this.uvA), 2));
    // RGBA:rgb = 颜色/tint,w = 相对高度(风悬臂剖面)
    g.setAttribute("color", new BufferAttribute(new Float32Array(this.col), 4));
    g.setIndex(
      this.vertCount > 65535
        ? new BufferAttribute(new Uint32Array(this.idx), 1)
        : new BufferAttribute(new Uint16Array(this.idx), 1),
    );
    g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------------------
// 骨架生长
// ---------------------------------------------------------------------------

type Anchor = {
  pos: Vector3;
  quat: Quaternion;
  scale: number;
  /** −1..1 色相抖动 */
  hue: number;
};

type SkelBranch = {
  level: number;
  pts: Vector3[];
  radii: number[];
  dirs: Vector3[];
  len: number;
};

type Skeleton = {
  branches: SkelBranch[];
  anchors: Anchor[];
  height: number;
  crownCenterY: number;
  crownRadius: number;
};

/** 树冠包络:按位置缩放子枝长度 */
function crownEnvelope(shape: CrownShape, t: number, rng: () => number): number {
  switch (shape) {
    case "cone":
      return 0.18 + 0.82 * Math.pow(1 - t, 0.9);
    case "ellipsoid":
      return Math.max(0.12, Math.sin(Math.PI * (0.08 + 0.88 * t)));
    case "dome":
      return Math.max(0.15, Math.sqrt(Math.max(0, 1 - t * t * 0.92)));
    case "column":
      return 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, t * 1.15));
    case "irregular":
      return 0.3 + 0.7 * Math.abs(Math.sin(t * 9.7 + rng() * 6.28)) * (1 - t * 0.4);
  }
}

/** dir 的稳定正交基 */
function perpBasis(dir: Vector3, outN: Vector3, outB: Vector3): void {
  const ref = Math.abs(dir.y) < 0.94 ? UP : new Vector3(1, 0, 0);
  outN.crossVectors(ref, dir).normalize();
  outB.crossVectors(dir, outN).normalize();
}

type GrowCtx = {
  sp: SpeciesParams;
  rng: () => number;
  lean: { x: number; z: number };
  bias: { x: number; z: number };
  age: number;
  branches: SkelBranch[];
  anchors: Anchor[];
  budget: number;
};

type BranchSpec = {
  level: number;
  basePos: Vector3;
  baseDir: Vector3;
  len: number;
  baseR: number;
};

function growBranch(ctx: GrowCtx, spec: BranchSpec): void {
  if (ctx.budget <= 0) return;
  ctx.budget--;

  const { sp, rng } = ctx;
  const lp = sp.levels[Math.min(spec.level, sp.levels.length - 1)];
  if (!lp) return;
  const segs = Math.max(2, lp.segs);
  const isTrunk = spec.level === 0;

  const pts: Vector3[] = [];
  const radii: number[] = [];
  const dirs: Vector3[] = [];
  const dir = spec.baseDir.clone().normalize();
  const pos = spec.basePos.clone();
  const segLen = spec.len / segs;

  // 每枝独立游走流,兄弟枝去相关
  const wanderPhase = rng() * Math.PI * 2;
  const wanderFreq = 1.5 + rng() * 2.5;
  const droopTotal = lp.droop * (0.7 + rng() * 0.6);

  const N = new Vector3();
  const B = new Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    let r = spec.baseR * Math.pow(Math.max(0, 1 - t), lp.taper);
    r = Math.max(r, isTrunk ? spec.baseR * 0.012 : 0.0035);
    pts.push(pos.clone());
    radii.push(r);
    dirs.push(dir.clone());
    if (i === segs) break;

    // 方向更新:游走 + 向性 + 下垂/梢端上翘
    perpBasis(dir, N, B);
    const wob = lp.wander * (isTrunk ? 1 : 1.4);
    const a1 = Math.sin(t * wanderFreq * Math.PI * 2 + wanderPhase) * wob + (rng() - 0.5) * wob;
    const a2 = Math.cos(t * wanderFreq * Math.PI * 1.7 + wanderPhase * 1.7) * wob + (rng() - 0.5) * wob;
    dir.addScaledVector(N, a1).addScaledVector(B, a2);
    dir.addScaledVector(UP, lp.gravitropism * (isTrunk ? 1 : 0.4 + t));
    dir.y -= droopTotal * t * (1 / segs) * 2.4;
    dir.y += lp.tipCurl * Math.max(0, t - 0.62) * (1 / segs) * 5.2;
    if (isTrunk) {
      dir.x += ctx.lean.x * (1 / segs) * (1.6 - t);
      dir.z += ctx.lean.z * (1 / segs) * (1.6 - t);
    }
    dir.normalize();
    pos.addScaledVector(dir, segLen * (0.92 + rng() * 0.16));
  }

  ctx.branches.push({ level: spec.level, pts, radii, dirs, len: spec.len });

  // ---- 子枝 ----------------------------------------------------------------
  const childLevel = spec.level + 1;
  if (childLevel < sp.levels.length) {
    const cp = sp.levels[childLevel];
    if (cp) {
      const span = Math.max(0, cp.childEnd - cp.childStart);
      const densityScale = 0.75 + ctx.age * 0.45;
      const count = Math.round(spec.len * span * cp.density * densityScale);
      if (count > 0) {
        const whorl = cp.whorl;
        const planar = cp.planar ?? 0;
        const groups = whorl >= 2 ? Math.max(1, Math.round(count / whorl)) : count;
        let azimuth = rng() * Math.PI * 2;
        for (let gi = 0; gi < groups; gi++) {
          const tG = cp.childStart + span * ((gi + 0.5) / groups);
          const inWhorl = whorl >= 2 ? whorl : 1;
          azimuth += whorl >= 2 ? GOLDEN * 0.5 + rng() * 0.4 : 0;
          for (let wi = 0; wi < inWhorl; wi++) {
            const t = Math.min(0.985, tG + (rng() - 0.5) * (span / groups) * 0.6);
            let az: number;
            if (rng() < planar) {
              az = ((gi + wi) % 2 === 0 ? 0 : Math.PI) + (rng() - 0.5) * 0.55;
            } else if (whorl >= 2) {
              az = azimuth + (wi / inWhorl) * Math.PI * 2 + (rng() - 0.5) * 0.5;
            } else {
              az = azimuth += GOLDEN + (rng() - 0.5) * 0.35;
            }
            // 母枝 t 处标架
            const idxF = t * segs;
            const i0 = Math.min(segs - 1, Math.floor(idxF));
            const f = idxF - i0;
            const pPos = new Vector3().lerpVectors(pts[i0] as Vector3, pts[i0 + 1] as Vector3, f);
            const pDir = new Vector3()
              .lerpVectors(dirs[i0] as Vector3, dirs[i0 + 1] as Vector3, f)
              .normalize();
            const pR = (radii[i0] as number) * (1 - f) + (radii[i0 + 1] as number) * f;
            perpBasis(pDir, N, B);
            const side = new Vector3()
              .addScaledVector(N, Math.cos(az))
              .addScaledVector(B, Math.sin(az));
            const angle = cp.angleBase + (cp.angleTip - cp.angleBase) * t + (rng() - 0.5) * 0.16;
            const cDir = new Vector3()
              .addScaledVector(pDir, Math.cos(angle))
              .addScaledVector(side, Math.sin(angle))
              .normalize();
            // 树冠包络 + 光竞争不对称
            const env = crownEnvelope(sp.crown, isTrunk ? t : t * 0.6 + 0.4, rng);
            const asymK =
              1 + sp.asym * (cDir.x * ctx.bias.x + cDir.z * ctx.bias.z) * (isTrunk ? 1 : 0.4);
            const cLen = spec.len * cp.lenRatio * env * asymK * (1 + (rng() - 0.5) * 2 * cp.lenJitter);
            if (cLen < 0.05) continue;
            const cR = Math.min(pR * cp.radRatio * (0.55 + env * 0.45), pR * 0.8);
            growBranch(ctx, { level: childLevel, basePos: pPos, baseDir: cDir, len: cLen, baseR: cR });
          }
        }
      }
    }
  }

  // ---- 叶锚点 ----------------------------------------------------------------
  const fol = sp.foliage;
  if (spec.level === fol.anchorLevel) {
    const from = Math.max(0, fol.tStart);
    const along = spec.len * (1 - from);
    const n = Math.max(1, Math.round(along / fol.spacing));
    const q = new Quaternion();
    const qTwist = new Quaternion();
    const qTilt = new Quaternion();
    for (let i = 0; i <= n; i++) {
      const t = Math.min(1, from + (1 - from) * (i / n));
      const idxF = t * segs;
      const i0 = Math.min(segs - 1, Math.floor(idxF));
      const f = idxF - i0;
      const aPos = new Vector3().lerpVectors(pts[i0] as Vector3, pts[i0 + 1] as Vector3, f);
      const aDir = new Vector3()
        .lerpVectors(dirs[i0] as Vector3, dirs[i0 + 1] as Vector3, f)
        .normalize();
      const terminal = i === n;
      perpBasis(aDir, N, B);
      const az = terminal
        ? 0
        : fol.planarLeaves
          ? (i % 2 === 0 ? 0 : Math.PI) + (rng() - 0.5) * 0.6
          : GOLDEN * i + (rng() - 0.5) * 0.7;
      const out = terminal
        ? aDir.clone()
        : new Vector3()
            .addScaledVector(aDir, Math.cos(fol.tilt))
            .addScaledVector(
              new Vector3().addScaledVector(N, Math.cos(az)).addScaledVector(B, Math.sin(az)),
              Math.sin(fol.tilt),
            )
            .normalize();
      // 标架:+z 沿外伸方向,再绕轴扭转让局部 +y 近似朝上
      q.setFromUnitVectors(new Vector3(0, 0, 1), out);
      const localY = new Vector3(0, 1, 0).applyQuaternion(q);
      const horizUp = new Vector3().addScaledVector(out, -out.y).add(UP).normalize();
      const twistAngle = Math.atan2(
        new Vector3().crossVectors(localY, horizUp).dot(out),
        localY.dot(horizUp),
      );
      qTwist.setFromAxisAngle(out, twistAngle + (rng() - 0.5) * 0.5);
      q.premultiply(qTwist);
      const sideAxis = new Vector3(1, 0, 0).applyQuaternion(q);
      qTilt.setFromAxisAngle(sideAxis, (rng() - 0.5) * 0.24 + 0.08);
      q.premultiply(qTilt);
      const sc =
        (fol.scale[0] + rng() * (fol.scale[1] - fol.scale[0])) *
        (terminal ? 0.85 : 0.72 + t * 0.42);
      ctx.anchors.push({
        pos: aPos.clone().addScaledVector(out, sc * 0.06),
        quat: q.clone(),
        scale: sc,
        hue: rng() * 2 - 1,
      });
    }
  }
}

function growSkeleton(sp: SpeciesParams, rng: () => number): Skeleton {
  const lean = { x: (rng() - 0.5) * 0.12, z: (rng() - 0.5) * 0.12 };
  const biasA = rng() * Math.PI * 2;
  const bias = { x: Math.cos(biasA), z: Math.sin(biasA) };
  const age = 0.5 + rng() * 0.5;
  const height = (sp.height[0] + rng() * (sp.height[1] - sp.height[0])) * (0.72 + age * 0.36);

  const ctx: GrowCtx = { sp, rng, lean, bias, age, branches: [], anchors: [], budget: 800 };

  if (sp.culms) {
    // 竹:丛生 culm,各自向外倾斜
    const nCulms = Math.round(sp.culms[0] + rng() * (sp.culms[1] - sp.culms[0]));
    for (let c = 0; c < nCulms; c++) {
      const a = (c / nCulms) * Math.PI * 2 + rng() * 1.2;
      const rad = 0.12 + rng() * 0.35;
      const h = height * (0.75 + rng() * 0.35);
      growBranch(ctx, {
        level: 0,
        basePos: new Vector3(Math.cos(a) * rad, 0, Math.sin(a) * rad),
        baseDir: new Vector3(Math.cos(a) * (0.1 + rng() * 0.12), 1, Math.sin(a) * (0.1 + rng() * 0.12)).normalize(),
        len: h,
        baseR: h * sp.trunkRadiusK,
      });
    }
  } else {
    growBranch(ctx, {
      level: 0,
      basePos: new Vector3(0, 0, 0),
      baseDir: new Vector3(lean.x * 0.7, 1, lean.z * 0.7).normalize(),
      len: height,
      baseR: height * sp.trunkRadiusK,
    });
  }

  // 冠层包围(法线融合 + AO 用)
  let minY = Infinity;
  let maxY = -Infinity;
  let maxR = 0.5;
  for (const a of ctx.anchors) {
    minY = Math.min(minY, a.pos.y);
    maxY = Math.max(maxY, a.pos.y);
    maxR = Math.max(maxR, Math.hypot(a.pos.x, a.pos.z));
  }
  if (!Number.isFinite(minY)) {
    minY = height * 0.3;
    maxY = height;
  }
  return {
    branches: ctx.branches,
    anchors: ctx.anchors,
    height,
    crownCenterY: (minY + maxY) * 0.5,
    crownRadius: maxR,
  };
}

// ---------------------------------------------------------------------------
// 枝干管化(平行传输广义圆柱)
// ---------------------------------------------------------------------------

const _N = new Vector3();
const _B = new Vector3();
const _v = new Vector3();

function ringsForLevel(level: number): number {
  return level === 0 ? 8 : level === 1 ? 6 : 5;
}

function tubeForBranch(
  g: Grower,
  br: SkelBranch,
  height: number,
  bark: [number, number, number],
  flare: { amp: number; height: number; lobes: number; phase: number } | null,
  rng: () => number,
): void {
  const n = br.pts.length;
  if (n < 2) return;
  const segsAround = ringsForLevel(br.level);
  const rings: number[][] = [];

  _v.copy(br.dirs[0] as Vector3);
  const ref = Math.abs(_v.y) < 0.94 ? UP : new Vector3(1, 0, 0);
  _N.crossVectors(ref, _v).normalize();
  _B.crossVectors(_v, _N).normalize();

  const shade = 0.82 + rng() * 0.3;

  for (let i = 0; i < n; i++) {
    const p = br.pts[i] as Vector3;
    const r = br.radii[i] as number;
    if (i > 0) {
      // 平行传输:把 N/B 按 prev 切向 → cur 切向的旋转搬运
      const tPrev = br.dirs[i - 1] as Vector3;
      const tCur = br.dirs[i] as Vector3;
      const axis = _v.crossVectors(tPrev, tCur);
      const s = axis.length();
      if (s > 1e-6) {
        axis.multiplyScalar(1 / s);
        const ang = Math.asin(Math.min(1, s));
        _N.applyAxisAngle(axis, ang).normalize();
        _B.applyAxisAngle(axis, ang).normalize();
      }
    }
    const heightK = Math.min(Math.max(p.y / height, 0), 1);
    const ring: number[] = [];
    // 树干 UV 按高度拉伸,使纵裂/板条在整株尺度上连续
    const vAlong = i / (n - 1);
    const vUv = br.level === 0 ? vAlong * Math.max(1, (br.pts[n - 1] as Vector3).y * 0.35) : vAlong;
    const uRepeats = br.level === 0 ? 3 : 1;
    for (let k = 0; k <= segsAround; k++) {
      const a = (k / segsAround) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      let rr = r;
      if (flare && br.level === 0) {
        // 根部瘤状扩张 + 板根瓣
        const h = p.y - (br.pts[0] as Vector3).y;
        const lobe = Math.pow(Math.max(0, Math.cos(flare.lobes * a + flare.phase)), 1.6);
        rr *= 1 + flare.amp * Math.exp(-h / flare.height) * (0.45 + 0.9 * lobe);
      }
      const dx = _N.x * ca + _B.x * sa;
      const dy = _N.y * ca + _B.y * sa;
      const dz = _N.z * ca + _B.z * sa;
      const j = (rng() - 0.5) * 0.1;
      ring.push(
        g.vertex(
          p.x + dx * rr, p.y + dy * rr, p.z + dz * rr,
          dx, dy, dz,
          (k / segsAround) * uRepeats, vUv,
          Math.max(bark[0] * shade + j * 0.6, 0.02),
          Math.max(bark[1] * shade + j, 0.02),
          Math.max(bark[2] * shade + j * 0.4, 0.02),
          heightK,
        ),
      );
    }
    rings.push(ring);
  }

  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i] as number[];
    const b = rings[i + 1] as number[];
    for (let k = 0; k < segsAround; k++) {
      g.quad(a[k] as number, a[k + 1] as number, b[k + 1] as number, b[k] as number);
    }
  }

  // 梢端收尖
  const last = rings[rings.length - 1] as number[];
  const tipP = br.pts[n - 1] as Vector3;
  const tipD = br.dirs[n - 1] as Vector3;
  const tipR = br.radii[n - 1] as number;
  const tipK = Math.min(Math.max(tipP.y / height, 0), 1);
  const tip = g.vertex(
    tipP.x + tipD.x * tipR * 2, tipP.y + tipD.y * tipR * 2, tipP.z + tipD.z * tipR * 2,
    tipD.x, tipD.y, tipD.z,
    0.5, 1,
    bark[0] * shade, bark[1] * shade, bark[2] * shade,
    tipK,
  );
  for (let k = 0; k < segsAround; k++) {
    g.tri(last[k + 1] as number, tip, last[k] as number);
  }
}

// ---------------------------------------------------------------------------
// 真实叶网格(图集烘焙用 —— 渲染路径用卡片,见 buildCards)
// ---------------------------------------------------------------------------

const _p = new Vector3();
const _n2 = new Vector3();
const _m = new Matrix4();

function pushXf(
  g: Grower,
  m: Matrix4,
  px: number, py: number, pz: number,
  nx: number, ny: number, nz: number,
  u: number, v: number,
  r: number, gr: number, b: number,
  heightK: number,
): number {
  _p.set(px, py, pz).applyMatrix4(m);
  _n2.set(nx, ny, nz).transformDirection(m);
  return g.vertex(_p.x, _p.y, _p.z, _n2.x, _n2.y, _n2.z, u, v, r, gr, b, heightK);
}

/** 叶色:基色 × 色相摆动(−1..1) */
export function leafRgb(
  color: [number, number, number],
  hue: number,
): [number, number, number] {
  return [
    Math.max(color[0] * (1 + hue * 0.5), 0.02),
    Math.max(color[1] * (1 - hue * 0.18), 0.02),
    Math.max(color[2] * (1 - hue * 0.35), 0.02),
  ];
}

/**
 * 单叶:沿 +z 的 2 行条带(每行 3 顶点),沿主脉折叠 + 向梢卷曲,带叶柄。
 * 局部空间:基部在原点,叶面朝 +y。
 */
export function buildLeaf(
  g: Grower,
  m: Matrix4,
  shape: LeafShape,
  rgb: [number, number, number],
  heightK: number,
): void {
  const ROWS = 2;
  const L = shape.len;
  const W = shape.width;
  const stem = L * 0.14;
  const rows: number[][] = [];
  for (let i = 0; i <= ROWS; i++) {
    const s = i / ROWS;
    const w = W * Math.pow(Math.sin(Math.PI * Math.min(1, s * 0.86 + 0.07)), shape.shapePow);
    const z = stem + s * (L - stem);
    const curlY = -shape.curl * s * s * L;
    const foldY = shape.fold * w;
    const r: number[] = [];
    r.push(pushXf(g, m, -w, curlY - foldY, z, -shape.fold * 0.8, 1, 0, 0, s, rgb[0] * 0.92, rgb[1] * 0.92, rgb[2] * 0.92, heightK));
    r.push(pushXf(g, m, 0, curlY + foldY * 0.35, z, 0, 1, shape.curl * s, 0.5, s, rgb[0], rgb[1], rgb[2], heightK));
    r.push(pushXf(g, m, w, curlY - foldY, z, shape.fold * 0.8, 1, 0, 1, s, rgb[0] * 0.92, rgb[1] * 0.92, rgb[2] * 0.92, heightK));
    rows.push(r);
  }
  for (let i = 0; i < ROWS; i++) {
    const a = rows[i] as number[];
    const b = rows[i + 1] as number[];
    g.quad(a[0] as number, b[0] as number, b[1] as number, a[1] as number);
    g.quad(a[1] as number, b[1] as number, b[2] as number, a[2] as number);
  }
  // 叶柄
  const p0 = pushXf(g, m, -W * 0.06, 0, 0, 0, 1, 0, 0.45, 0, rgb[0] * 0.8, rgb[1] * 0.8, rgb[2] * 0.8, heightK);
  const p1 = pushXf(g, m, W * 0.06, 0, 0, 0, 1, 0, 0.55, 0, rgb[0] * 0.8, rgb[1] * 0.8, rgb[2] * 0.8, heightK);
  const r0 = rows[0] as number[];
  g.quad(p0, r0[0] as number, r0[1] as number, p1);
}

/**
 * 针叶簇:下垂小茎折线 + needleCount 个单四边形针叶,梳(平面两列)或刷(径向)。
 * 局部空间:沿 +z。
 */
export function buildNeedleSpray(
  g: Grower,
  m: Matrix4,
  shape: LeafShape,
  scale: number,
  rng: () => number,
  rgb: [number, number, number],
  heightK: number,
): void {
  const SEGS = 3;
  const L = scale;
  const stemPts: Vector3[] = [];
  let dz = 1;
  let dy = 0;
  let z = 0;
  let y = 0;
  for (let i = 0; i <= SEGS; i++) {
    stemPts.push(new Vector3(0, y, z));
    const step = L / SEGS;
    dy -= 0.16 * (i / SEGS); // 下垂
    const dl = Math.hypot(dy, dz);
    z += (dz / dl) * step;
    y += (dy / dl) * step;
  }
  // 茎:双顶点窄条
  const sw = L * 0.012 + 0.002;
  const stemRows: number[][] = [];
  const stemRgb: [number, number, number] = [rgb[0] * 0.6 + 0.06, rgb[1] * 0.55 + 0.05, rgb[2] * 0.5 + 0.03];
  for (let i = 0; i <= SEGS; i++) {
    const p = stemPts[i] as Vector3;
    const w = sw * (1 - (i / SEGS) * 0.7);
    stemRows.push([
      pushXf(g, m, p.x - w, p.y, p.z, 0, 1, 0, 0.48, i / SEGS, stemRgb[0], stemRgb[1], stemRgb[2], heightK),
      pushXf(g, m, p.x + w, p.y, p.z, 0, 1, 0, 0.52, i / SEGS, stemRgb[0], stemRgb[1], stemRgb[2], heightK),
    ]);
  }
  for (let i = 0; i < SEGS; i++) {
    const a = stemRows[i] as number[];
    const b = stemRows[i + 1] as number[];
    g.quad(a[0] as number, b[0] as number, b[1] as number, a[1] as number);
  }

  // 针叶
  const count = shape.needleCount;
  const nl = shape.len;
  const nw = shape.width;
  for (let i = 0; i < count; i++) {
    const s = (i + 0.5) / count;
    const idxF = s * SEGS;
    const i0 = Math.min(SEGS - 1, Math.floor(idxF));
    const f = idxF - i0;
    const base = _p.copy(stemPts[i0] as Vector3).lerp(stemPts[i0 + 1] as Vector3, f).clone();
    const side = i % 2 === 0 ? 1 : -1;
    const layer = i % 4 < 2 ? 1 : 0;
    const az = shape.brush > 0.5
      ? rng() * Math.PI * 2
      : side * (1.05 + (rng() - 0.5) * 0.85);
    const elev = shape.brush > 0.5
      ? (rng() - 0.2) * 1.1
      : (layer === 1 ? 0.42 : 0.02) + (rng() - 0.5) * 0.3;
    const swing = (rng() - 0.5) * 0.3 + s * 0.55;
    const dir = new Vector3(
      Math.sin(az) * Math.cos(elev),
      Math.sin(elev),
      Math.cos(az) * Math.cos(elev) * 0.35 + swing,
    ).normalize();
    const lenJ = nl * (0.75 + rng() * 0.5) * (0.65 + 0.35 * Math.sin(Math.PI * Math.min(1, s * 1.18)));
    const tip = base.clone().addScaledVector(dir, lenJ);
    const across = new Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(nw * 0.5);
    const nrm = new Vector3(0, 1, 0).addScaledVector(dir, -0.25).normalize();
    const j = (rng() - 0.5) * 0.16;
    const nr = Math.max(rgb[0] + j * 0.5, 0.02);
    const ng = Math.max(rgb[1] + j, 0.02);
    const nb = Math.max(rgb[2] + j * 0.3, 0.02);
    const a0 = pushXf(g, m, base.x - across.x, base.y, base.z - across.z, nrm.x, nrm.y, nrm.z, 0, 0, nr, ng, nb, heightK);
    const a1 = pushXf(g, m, base.x + across.x, base.y, base.z + across.z, nrm.x, nrm.y, nrm.z, 1, 0, nr, ng, nb, heightK);
    const b0 = pushXf(g, m, tip.x - across.x * 0.25, tip.y, tip.z - across.z * 0.25, nrm.x, nrm.y, nrm.z, 0.4, 1, nr, ng, nb, heightK);
    const b1 = pushXf(g, m, tip.x + across.x * 0.25, tip.y, tip.z + across.z * 0.25, nrm.x, nrm.y, nrm.z, 0.6, 1, nr, ng, nb, heightK);
    g.quad(a0, b0, b1, a1);
  }
}

// ---------------------------------------------------------------------------
// 叶簇卡片(LAAS FoliageCards.buildFoliageCards 移植)
// ---------------------------------------------------------------------------

const _q = new Quaternion();
const _q2 = new Quaternion();
const Z_AXIS = new Vector3(0, 0, 1);

/**
 * 在每个叶锚点放 alpha 测试卡片:长度轴沿锚点 +z(贴图 v 方向),
 * 'lying' = 枝平面单面(法线 +y);'cross' 再加一张垂直面(立体感)。
 * 顶点色 = 逐锚点色相 tint × 冠内 AO;uv 指向 2×2 图集变体 tile。
 */
function buildCards(
  anchors: readonly Anchor[],
  fol: FoliageParams,
  height: number,
  crownC: Vector3,
  crownR: number,
  rng: () => number,
): BufferGeometry {
  const g = new Grower();
  const right = new Vector3();
  const upL = new Vector3();
  const out = new Vector3();
  const p = new Vector3();
  const rowPos = new Vector3();

  // 锚点超预算按步长抽稀,幸存卡片按 √stride 放大保持覆盖(上限 1.9)
  const stride = Math.max(1, Math.ceil(anchors.length / fol.anchorTarget));
  const grow = stride > 1 ? Math.min(1.9, Math.sqrt(stride) * 0.9 + 0.12) : 1;
  const invR = 1 / Math.max(0.001, crownR);

  for (let ai = 0; ai < anchors.length; ai += stride) {
    const a = anchors[ai] as Anchor;
    const tile = (rng() * 4) | 0;
    const u0 = (tile % 2) * 0.5;
    const v0 = ((tile / 2) | 0) * 0.5;
    const s = a.scale * grow * fol.card.sizeK;
    const roll = (rng() - 0.5) * 0.7;
    _q.copy(a.quat);
    _q2.setFromAxisAngle(Z_AXIS, roll);
    _q.multiply(_q2);
    right.set(1, 0, 0).applyQuaternion(_q);
    upL.set(0, 1, 0).applyQuaternion(_q);
    out.set(0, 0, 1).applyQuaternion(_q);

    const heightK = Math.min(Math.max(a.pos.y / height, 0), 1);
    // 冠内深度 AO
    const dx = (a.pos.x - crownC.x) * invR;
    const dy = (a.pos.y - crownC.y) * invR;
    const dz = (a.pos.z - crownC.z) * invR;
    const d = Math.min(1, Math.hypot(dx, dy, dz));
    const ao = 1 - 0.55 * (1 - d) * (1 - d);
    // 逐锚点色相 tint(图集已含叶色,这里乘性微调)
    const hue = a.hue * fol.hueVar;
    const tr = (1 + hue * 0.4) * ao;
    const tg = (1 - hue * 0.12) * ao;
    const tb = (1 - hue * 0.25) * ao;

    const planes = fol.card.mode === "cross" ? 2 : 1;
    for (let pl = 0; pl < planes; pl++) {
      // 面 0:宽 = right,法线 = upL;面 1:宽 = upL,法线 = right
      const w = pl === 0 ? right : upL;
      const nrm = pl === 0 ? upL : right;
      const base = g.vertCount;
      rowPos.copy(a.pos).addScaledVector(out, -0.08 * s);
      for (let iv = 0; iv <= 1; iv++) {
        for (let iu = 0; iu <= 1; iu++) {
          p.copy(rowPos).addScaledVector(w, (iu - 0.5) * s);
          g.vertex(
            p.x, p.y, p.z,
            nrm.x, nrm.y, nrm.z,
            u0 + iu * 0.5, v0 + iv * 0.5,
            tr, tg, tb,
            heightK,
          );
        }
        if (iv === 0) rowPos.addScaledVector(out, s);
      }
      g.quad(base, base + 1, base + 3, base + 2);
    }
  }

  g.bendNormals(crownC, crownR, fol.normalBend, 0);
  return g.build();
}

// ---------------------------------------------------------------------------
// 总装
// ---------------------------------------------------------------------------

export type BuiltTree = {
  /** 枝干(顶点色材质) */
  bark: BufferGeometry;
  /** 叶簇卡片(逐树种图集 alpha 测试材质) */
  cards: BufferGeometry;
};

/**
 * 生成一棵树的几何(局部空间,根在原点,+y 向上),拆 bark/cards 两份。
 * 每个 (species, seed) 对应唯一的分枝结构与叶着生。
 */
export function buildTreeGeometry(sp: SpeciesParams, seed: number): BuiltTree {
  const rng = makeRng(seed);
  const skel = growSkeleton(sp, rng);

  const barkG = new Grower();
  const flarePhase = rng() * Math.PI * 2;
  // LAAS ring-LOD 裁剪:卡片在视觉上承担锚点级小枝,其管化纯属浪费
  // (LAAS 注:一棵森林榉在此优化前扛着 98k 卡片 + 13k 小枝三角形)
  const maxTubeLevel = Math.max(1, sp.foliage.anchorLevel - 1);
  for (const br of skel.branches) {
    if (br.level > maxTubeLevel) continue;
    tubeForBranch(
      barkG, br, skel.height, sp.bark,
      sp.flare.amp > 0 ? { ...sp.flare, phase: flarePhase } : null,
      rng,
    );
  }

  const crownC = new Vector3(0, skel.crownCenterY, 0);
  const crownR = Math.max(skel.crownRadius, (skel.height - skel.crownCenterY) * 0.9);
  const cards = buildCards(skel.anchors, sp.foliage, skel.height, crownC, crownR, rng);

  const bark = barkG.build();
  // 保留 uv:程序化树皮材质按周向/纵向 UV 做板条与纵裂(8 个 vertex buffer,与 cards 同级)
  return { bark, cards };
}
