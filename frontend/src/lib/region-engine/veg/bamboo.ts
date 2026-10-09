/**
 * 竹丛专用生成器(慈竹 Bambusa emeiensis 形态 —— 成都平原林盘竹)。
 *
 * 形态依据(《中国植物志》慈竹条 + 望江楼公园实拍):秆高 5–10 m、径 3–6 cm、
 * 全秆约 30 节;节间 15–30 cm、基部数节仅 6–12 cm;秆环平坦、箨环显著、节内约
 * 1 cm;秆上部弧形外弯、梢端下垂如钓丝;分枝自秆中部节起、簇生、近水平伸展;
 * 叶窄披针形 10–30 × 1–3 cm,数片自小枝端放射成扇;幼秆下部节残留枯黄箨鞘;
 * 丛内秆龄不一,秆色自深绿(新竹)至黄褐(老竹)。
 *
 * 几何拆分同 treeBuilder:
 *   bark  = 秆 + 枝 + 箨鞘 + 竹笋,顶点色 rgb = 树皮 tint(材质需开 vertexTint)
 *   cards = 叶簇卡片(appendCards),图集 tile 由 buildBambooSprayTile 提供
 * 秆 UV:u 绕周一圈,v = 节序号 + 节间内比例 —— 与树皮贴图的节带(v 整数处)
 * 严格对齐;每节 3 环(节下 0.8 cm / 节 / 节上 1.2 cm)表达箨环凸起。
 */

import { Matrix4, Quaternion, Vector3 } from "three";
import type { FoliageParams, LevelParams, SpeciesParams } from "./species";
import {
  Grower,
  appendCards,
  buildLeaf,
  leafRgb,
  makeRng,
  type Anchor,
  type BuiltTree,
} from "./treeBuilder";

const UP = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);
const Z_AXIS = new Vector3(0, 0, 1);
const GOLDEN = 2.39996323;

type Tint = [number, number, number];

/** 管化用环:位置 / 轴向 / 半径 / 贴图 v / 顶点 tint */
type Ring = { p: Vector3; dir: Vector3; r: number; v: number; tint: Tint };

/** 秆上的一个节(供分枝 / 箨鞘着生) */
type CulmNode = { p: Vector3; dir: Vector3; r: number; t: number; idx: number };

type CulmSpec = {
  base: Vector3;
  /** 丛心 → 秆基的水平单位向量(外倾方向) */
  outward: Vector3;
  height: number;
  r0: number;
  /** 秆龄 0(新竹)..1(老竹) */
  age: number;
  /** 基部外倾(tan) */
  lean0: number;
  /** 弧形外弯强度(rad/m,按 t² 加权) */
  bendK: number;
};

const CULM_SEGS = 8;
const BRANCH_SEGS = 4;
/** 枝 UV v:每 8 cm 一道节带(枝节密) */
const BRANCH_NODE_SPACING = 0.08;

/** 秆色 tint(乘进树皮贴图):新竹深绿偏蓝 → 成竹 → 老竹黄褐 */
const TINT_YOUNG: Tint = [0.72, 0.92, 0.78];
const TINT_MATURE: Tint = [1, 1, 1];
const TINT_OLD: Tint = [1.32, 1.18, 0.78];

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

function lerpTint(a: Tint, b: Tint, k: number): Tint {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function perpBasis(dir: Vector3, outN: Vector3, outB: Vector3): void {
  const ref = Math.abs(dir.y) < 0.94 ? UP : X_AXIS;
  outN.crossVectors(ref, dir).normalize();
  outB.crossVectors(dir, outN).normalize();
}

// ---------------------------------------------------------------------------
// 管化
// ---------------------------------------------------------------------------

/** 平行传输标架管化:环列 → 侧面四边形(+ 可选梢端收尖) */
function tubeFromRings(
  g: Grower,
  rings: readonly Ring[],
  segs: number,
  height: number,
  tipLen: number,
): void {
  if (rings.length < 2) return;
  const N = new Vector3();
  const B = new Vector3();
  const axis = new Vector3();
  perpBasis(rings[0].dir, N, B);

  const rows: number[][] = [];
  for (let i = 0; i < rings.length; i++) {
    const rg = rings[i];
    if (i > 0) {
      axis.crossVectors(rings[i - 1].dir, rg.dir);
      const s = axis.length();
      if (s > 1e-6) {
        axis.multiplyScalar(1 / s);
        const ang = Math.asin(Math.min(1, s));
        N.applyAxisAngle(axis, ang).normalize();
        B.applyAxisAngle(axis, ang).normalize();
      }
    }
    const heightK = clamp01(rg.p.y / height);
    const row: number[] = [];
    for (let k = 0; k <= segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const dx = N.x * ca + B.x * sa;
      const dy = N.y * ca + B.y * sa;
      const dz = N.z * ca + B.z * sa;
      row.push(
        g.vertex(
          rg.p.x + dx * rg.r, rg.p.y + dy * rg.r, rg.p.z + dz * rg.r,
          dx, dy, dz,
          k / segs, rg.v,
          rg.tint[0], rg.tint[1], rg.tint[2],
          heightK,
        ),
      );
    }
    rows.push(row);
  }
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    for (let k = 0; k < segs; k++) g.quad(a[k], a[k + 1], b[k + 1], b[k]);
  }
  if (tipLen > 0) {
    const last = rings[rings.length - 1];
    const row = rows[rows.length - 1];
    const tx = last.p.x + last.dir.x * tipLen;
    const ty = last.p.y + last.dir.y * tipLen;
    const tz = last.p.z + last.dir.z * tipLen;
    const tip = g.vertex(
      tx, ty, tz,
      last.dir.x, last.dir.y, last.dir.z,
      0.5, last.v + 0.5,
      last.tint[0], last.tint[1], last.tint[2],
      clamp01(ty / height),
    );
    for (let k = 0; k < segs; k++) g.tri(row[k + 1], tip, row[k]);
  }
}

// ---------------------------------------------------------------------------
// 叶锚点
// ---------------------------------------------------------------------------

/** 标架:+z 沿 out,再绕轴扭转让局部 +y 近似朝上(与 treeBuilder 叶锚点约定一致) */
function makeAnchor(pos: Vector3, out: Vector3, scale: number, rng: () => number): Anchor {
  const q = new Quaternion().setFromUnitVectors(Z_AXIS, out);
  const localY = new Vector3(0, 1, 0).applyQuaternion(q);
  const horizUp = new Vector3().addScaledVector(out, -out.y).add(UP).normalize();
  const twist = Math.atan2(
    new Vector3().crossVectors(localY, horizUp).dot(out),
    localY.dot(horizUp),
  );
  q.premultiply(new Quaternion().setFromAxisAngle(out, twist + (rng() - 0.5) * 0.5));
  return { pos, quat: q, scale, hue: rng() * 2 - 1 };
}

// ---------------------------------------------------------------------------
// 枝(自节上发出的细枝,携带叶锚点)
// ---------------------------------------------------------------------------

function buildBranch(
  g: Grower,
  lp: LevelParams,
  fol: FoliageParams,
  rng: () => number,
  base: Vector3,
  dir0: Vector3,
  len: number,
  r0: number,
  tint: Tint,
  clumpH: number,
  anchors: Anchor[],
): void {
  const segs = Math.max(2, lp.segs);
  const pts: Vector3[] = [];
  const dirs: Vector3[] = [];
  const rings: Ring[] = [];
  const dir = dir0.clone();
  const pos = base.clone();
  const N = new Vector3();
  const B = new Vector3();
  const segLen = len / segs;
  let cum = 0;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const r = Math.max(0.0015, r0 * Math.pow(1 - t * 0.85, lp.taper));
    pts.push(pos.clone());
    dirs.push(dir.clone());
    rings.push({ p: pos.clone(), dir: dir.clone(), r, v: cum / BRANCH_NODE_SPACING, tint });
    if (i === segs) break;
    // 逐段游走 + 叶重下垂(枝端弧形下弯)
    perpBasis(dir, N, B);
    dir
      .addScaledVector(N, (rng() - 0.5) * lp.wander * 2)
      .addScaledVector(B, (rng() - 0.5) * lp.wander * 2);
    dir.y -= (lp.droop * (0.3 + t) * 1.6) / segs;
    dir.normalize();
    pos.addScaledVector(dir, segLen);
    cum += segLen;
  }
  tubeFromRings(g, rings, BRANCH_SEGS, clumpH, 0.03);

  // 叶锚点:沿枝 tStart..1 等距,末端一个终端锚点;叶扇整体下垂
  const from = fol.tStart;
  const n = Math.max(1, Math.round((len * (1 - from)) / fol.spacing));
  for (let k = 0; k <= n; k++) {
    const t = from + (1 - from) * (k / n);
    const f = t * segs;
    const i0 = Math.min(segs - 1, Math.floor(f));
    const ff = f - i0;
    const aPos = new Vector3().lerpVectors(pts[i0], pts[i0 + 1], ff);
    const aDir = new Vector3().lerpVectors(dirs[i0], dirs[i0 + 1], ff).normalize();
    const terminal = k === n;
    let out: Vector3;
    if (terminal) {
      out = aDir.clone();
    } else {
      perpBasis(aDir, N, B);
      const az = rng() * Math.PI * 2;
      const side = new Vector3().addScaledVector(N, Math.cos(az)).addScaledVector(B, Math.sin(az));
      out = new Vector3()
        .addScaledVector(aDir, Math.cos(fol.tilt))
        .addScaledVector(side, Math.sin(fol.tilt));
    }
    out.y -= terminal ? 0.3 : 0.35;
    out.normalize();
    const sc =
      (fol.scale[0] + rng() * (fol.scale[1] - fol.scale[0])) *
      (terminal ? 0.95 : 0.8 + t * 0.3);
    anchors.push(makeAnchor(aPos.addScaledVector(out, sc * 0.05), out, sc, rng));
  }
}

// ---------------------------------------------------------------------------
// 箨鞘 / 竹笋(基部特征)
// ---------------------------------------------------------------------------

/** 枯黄箨鞘:贴秆的部分锥壳(绕 ~200°),自节向上 16–26 cm,顶部一侧翻卷外张收成尖 */
function buildSheath(g: Grower, node: CulmNode, rng: () => number, clumpH: number): void {
  const h = 0.16 + rng() * 0.1;
  const phi0 = rng() * Math.PI * 2;
  const N = new Vector3();
  const B = new Vector3();
  perpBasis(node.dir, N, B);
  // [高度比, 半径倍数, 角跨度]
  const spec: [number, number, number][] = [
    [0, 1.06, 3.5],
    [0.45, 1.14, 3.2],
    [0.8, 1.3, 2.2],
    [1, 1.55, 0.5],
  ];
  const shade = 0.85 + rng() * 0.25;
  const COLS = 4;
  const rows: number[][] = [];
  for (const [yK, rK, span] of spec) {
    const row: number[] = [];
    const dark = 0.78 + 0.22 * yK; // 基部更暗(潮湿/泥土)
    const r = node.r * rK;
    for (let c = 0; c <= COLS; c++) {
      const phi = phi0 + (c / COLS - 0.5) * span;
      const cp = Math.cos(phi);
      const snp = Math.sin(phi);
      const rx = N.x * cp + B.x * snp;
      const ry = N.y * cp + B.y * snp;
      const rz = N.z * cp + B.z * snp;
      const px = node.p.x + node.dir.x * yK * h + rx * r;
      const py = node.p.y + node.dir.y * yK * h + ry * r;
      const pz = node.p.z + node.dir.z * yK * h + rz * r;
      const nl = Math.hypot(rx + node.dir.x * 0.25, ry + node.dir.y * 0.25, rz + node.dir.z * 0.25) || 1;
      row.push(
        g.vertex(
          px, py, pz,
          (rx + node.dir.x * 0.25) / nl, (ry + node.dir.y * 0.25) / nl, (rz + node.dir.z * 0.25) / nl,
          c / COLS, yK * 2,
          1.75 * shade * dark, 1.3 * shade * dark, 0.85 * shade * dark,
          clamp01(py / clumpH),
        ),
      );
    }
    rows.push(row);
  }
  for (let r = 0; r < rows.length - 1; r++) {
    const a = rows[r];
    const b = rows[r + 1];
    for (let c = 0; c < COLS; c++) g.quad(a[c], a[c + 1], b[c + 1], b[c]);
  }
}

/** 竹笋:丛基部的棕色锥体(箨鞘包裹),v 拉伸以显示 2–3 道箨环 */
function buildShoot(g: Grower, rng: () => number, base: Vector3, clumpH: number): void {
  const h = 0.3 + rng() * 0.4;
  const rb = 0.045 + rng() * 0.02;
  const dir = new Vector3((rng() - 0.5) * 0.2, 1, (rng() - 0.5) * 0.2).normalize();
  const bottom: Tint = [1.45, 1.05, 0.68];
  const top: Tint = [1.05, 0.72, 0.45];
  const prof: [number, number][] = [
    [0, 1],
    [0.35, 0.86],
    [0.7, 0.52],
    [0.9, 0.22],
  ];
  const rings: Ring[] = prof.map(([yK, rK]) => ({
    p: base.clone().addScaledVector(dir, yK * h),
    dir,
    r: rb * rK,
    v: yK * 2.6,
    tint: lerpTint(bottom, top, yK),
  }));
  tubeFromRings(g, rings, 7, clumpH, h * 0.12);
}

// ---------------------------------------------------------------------------
// 秆
// ---------------------------------------------------------------------------

function buildCulm(
  g: Grower,
  sp: SpeciesParams,
  rng: () => number,
  spec: CulmSpec,
  clumpH: number,
  anchors: Anchor[],
): void {
  const { height, r0, age } = spec;
  const lp0 = sp.levels[0];
  const lp1 = sp.levels[1] ?? lp0;
  const fol = sp.foliage;

  // ---- 节间长分布:基部/梢端短、中部长,归一到秆高 ----
  const N = Math.min(34, Math.max(18, Math.round(height / 0.27)));
  const raw: number[] = [];
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const l = 0.22 + 0.78 * Math.pow(Math.sin((Math.PI * (i + 1)) / (N + 2)), 0.7);
    raw.push(l);
    sum += l;
  }
  const L = raw.map((l) => (l / sum) * height);

  // ---- 秆龄 tint(基部 30% 略压暗偏褐) ----
  const ageTint =
    age < 0.5 ? lerpTint(TINT_YOUNG, TINT_MATURE, age / 0.5) : lerpTint(TINT_MATURE, TINT_OLD, (age - 0.5) / 0.5);
  const shade = 0.92 + rng() * 0.16;
  const tintAt = (t: number): Tint => {
    const bk = Math.min(1, t / 0.3);
    return [
      ageTint[0] * shade * (0.86 + 0.14 * bk),
      ageTint[1] * shade * (0.84 + 0.16 * bk),
      ageTint[2] * shade * (0.8 + 0.2 * bk),
    ];
  };
  const branchTint = lerpTint(ageTint, TINT_MATURE, 0.5);

  // ---- 骨架:逐节前进,外弯按 t² 增长,顶部 15% 附加下垂 ----
  const radiusAt = (t: number): number => r0 * (1 - 0.72 * Math.pow(t, 1.7));
  const rings: Ring[] = [];
  const nodes: CulmNode[] = [];
  const pos = spec.base.clone();
  const dir = new Vector3(spec.outward.x * spec.lean0, 1, spec.outward.z * spec.lean0).normalize();
  const Nv = new Vector3();
  const Bv = new Vector3();
  rings.push({ p: pos.clone(), dir: dir.clone(), r: r0 * 1.02, v: 0, tint: tintAt(0) });
  let cum = 0;
  for (let i = 0; i < N; i++) {
    const Li = L[i];
    pos.addScaledVector(dir, Li);
    cum += Li;
    const t = cum / height;

    const prevDir = dir.clone();
    perpBasis(dir, Nv, Bv);
    dir
      .addScaledVector(Nv, (rng() - 0.5) * lp0.wander * 2)
      .addScaledVector(Bv, (rng() - 0.5) * lp0.wander * 2);
    dir.addScaledVector(spec.outward, spec.bendK * t * t * Li);
    const dk = Math.max(0, (t - 0.85) / 0.15);
    dir.y -= lp0.droop * dk * dk * Li * 2.2;
    dir.normalize();

    const nodeDir = prevDir.add(dir).normalize();
    const r = radiusAt(t);
    nodes.push({ p: pos.clone(), dir: nodeDir, r, t, idx: i + 1 });

    // 节的 3 环:节下 0.8 cm(r)/ 节(1.05 r,箨环凸起)/ 节上 1.2 cm(r)
    const vNode = i + 1;
    const Lnext = L[i + 1] ?? Li;
    const tint = tintAt(t);
    rings.push({
      p: pos.clone().addScaledVector(nodeDir, -0.008),
      dir: nodeDir, r, v: vNode - 0.008 / Li, tint,
    });
    rings.push({ p: pos.clone(), dir: nodeDir, r: r * 1.05, v: vNode, tint });
    rings.push({
      p: pos.clone().addScaledVector(nodeDir, 0.012),
      dir: nodeDir, r, v: vNode + 0.012 / Lnext, tint,
    });
  }
  const tipLen = L[N - 1] * 0.9;
  tubeFromRings(g, rings, CULM_SEGS, clumpH, tipLen);

  // 梢端叶(下垂的秆梢也带叶)
  const last = nodes[nodes.length - 1];
  for (let k = 0; k < 2; k++) {
    const out = last.dir.clone();
    out.y -= 0.3 + k * 0.2;
    out.normalize();
    const sc = (fol.scale[0] + rng() * (fol.scale[1] - fol.scale[0])) * 0.9;
    anchors.push(
      makeAnchor(last.p.clone().addScaledVector(last.dir, tipLen * (0.35 + k * 0.5)), out, sc, rng),
    );
  }

  // ---- 分枝:自秆中部节起,每节 1–2 根近水平细枝,左右交替;另加 1 个簇生小枝锚点 ----
  const azBase = rng() * Math.PI * 2;
  const span = Math.max(0.05, lp1.childEnd - lp1.childStart);
  for (const node of nodes) {
    if (node.t < lp1.childStart) continue;
    const tt = clamp01((node.t - lp1.childStart) / span);
    const nb = node.t > 0.93 || rng() > 0.4 ? 1 : 2;
    const sideAz = azBase + node.idx * Math.PI;
    perpBasis(node.dir, Nv, Bv);
    for (let j = 0; j < nb; j++) {
      const az = sideAz + (j - (nb - 1) / 2) * 1.1 + (rng() - 0.5) * 0.7;
      const side = new Vector3().addScaledVector(Nv, Math.cos(az)).addScaledVector(Bv, Math.sin(az));
      const angle = lp1.angleBase + (lp1.angleTip - lp1.angleBase) * tt + (rng() - 0.5) * 0.2;
      const bDir = new Vector3()
        .addScaledVector(node.dir, Math.cos(angle))
        .addScaledVector(side, Math.sin(angle))
        .normalize();
      // 枝长:中段最长(≈1.25 m),基部 ≈0.75 m,梢部 ≈0.6 m
      const len =
        (0.5 + 0.75 * Math.pow(Math.sin(Math.PI * (0.12 + 0.83 * tt)), 1.1)) *
        (1 + (rng() - 0.5) * 2 * lp1.lenJitter);
      const bR = 0.0045 * (0.7 + 0.5 * (1 - tt));
      const bBase = node.p.clone().addScaledVector(side, node.r * 0.85).addScaledVector(node.dir, 0.02);
      buildBranch(g, lp1, fol, rng, bBase, bDir, len, bR, branchTint, clumpH, anchors);
    }
    const az2 = sideAz + (Math.PI / 2) * (rng() < 0.5 ? 1 : -1) + (rng() - 0.5) * 0.8;
    const side2 = new Vector3().addScaledVector(Nv, Math.cos(az2)).addScaledVector(Bv, Math.sin(az2));
    const out2 = new Vector3()
      .addScaledVector(side2, 0.85)
      .addScaledVector(node.dir, 0.4)
      .addScaledVector(UP, -0.2)
      .normalize();
    const sc2 = (fol.scale[0] + rng() * (fol.scale[1] - fol.scale[0])) * 0.7;
    anchors.push(makeAnchor(node.p.clone().addScaledVector(side2, node.r + 0.05), out2, sc2, rng));
  }

  // ---- 箨鞘:幼秆最下 1–2 节残留 ----
  if (age < 0.35 && nodes.length >= 3) {
    const k = 1 + (rng() < 0.5 ? 1 : 0);
    const start = (rng() * 3) | 0;
    for (let m = 0; m < k; m++) buildSheath(g, nodes[(start + m) % 3], rng, clumpH);
  }
}

// ---------------------------------------------------------------------------
// 总装
// ---------------------------------------------------------------------------

/**
 * 生成一丛竹的几何(局部空间,丛心在原点,+y 向上),拆 bark/cards 两份。
 * 每个 (species, seed) 对应唯一的秆分布与分枝。
 */
export function buildBambooGeometry(sp: SpeciesParams, seed: number): BuiltTree {
  const rng = makeRng(seed);
  const barkG = new Grower();
  const anchors: Anchor[] = [];

  const culms = sp.culms ?? [8, 12];
  const nCulms = Math.round(culms[0] + rng() * (culms[1] - culms[0]));
  const rBase = 0.42 * Math.sqrt(nCulms / 10);
  const H = sp.height[0] + rng() * (sp.height[1] - sp.height[0]);
  const [cr0, cr1] = sp.culmRadius ?? [
    sp.height[0] * sp.trunkRadiusK,
    sp.height[1] * sp.trunkRadiusK,
  ];

  // 秆基:向日葵螺旋均匀铺满圆盘;外围秆更倾、更弯(丛呈喷泉形)
  const specs: CulmSpec[] = [];
  let clumpH = 0;
  for (let c = 0; c < nCulms; c++) {
    const a = c * GOLDEN + rng() * 0.6;
    const radK = Math.min(1, Math.sqrt((c + 0.5) / nCulms) * (0.8 + rng() * 0.35));
    const rad = rBase * radK;
    const hK = 0.72 + rng() * 0.36;
    const height = H * hK;
    const r0 = (cr0 + rng() * (cr1 - cr0)) * (0.8 + 0.3 * hK);
    specs.push({
      base: new Vector3(Math.cos(a) * rad, 0, Math.sin(a) * rad),
      outward: new Vector3(Math.cos(a), 0, Math.sin(a)),
      height,
      r0,
      age: rng(),
      lean0: 0.015 + 0.07 * radK,
      bendK: ((1.5 + rng() * 1.4) / height) * (0.45 + 0.55 * radK),
    });
    clumpH = Math.max(clumpH, height * 1.02);
  }
  for (const spec of specs) buildCulm(barkG, sp, rng, spec, clumpH, anchors);

  // 竹笋:1–2 个,丛心附近
  const nShoots = 1 + (rng() < 0.5 ? 1 : 0);
  for (let s = 0; s < nShoots; s++) {
    const a = rng() * Math.PI * 2;
    const rad = rBase * (0.2 + rng() * 0.7);
    buildShoot(barkG, rng, new Vector3(Math.cos(a) * rad, 0, Math.sin(a) * rad), clumpH);
  }

  // 冠层包围(卡片法线融合 + 冠内 AO;竹丛非实心球冠,AO 取弱)
  let minY = Infinity;
  let maxY = -Infinity;
  let maxR = 0.5;
  for (const an of anchors) {
    minY = Math.min(minY, an.pos.y);
    maxY = Math.max(maxY, an.pos.y);
    maxR = Math.max(maxR, Math.hypot(an.pos.x, an.pos.z));
  }
  if (!Number.isFinite(minY)) {
    minY = clumpH * 0.4;
    maxY = clumpH;
  }
  const crownC = new Vector3(0, (minY + maxY) * 0.5, 0);
  const crownR = Math.max(maxR, (maxY - minY) * 0.5);
  const cardsG = new Grower();
  appendCards(cardsG, anchors, sp.foliage, clumpH, crownC, crownR, rng, { aoK: 0.3 });

  return { bark: barkG.build(), cards: cardsG.build() };
}

// ---------------------------------------------------------------------------
// 图集 tile:竹叶小枝(供 foliageAtlas.buildTwigTile 分派)
// ---------------------------------------------------------------------------

/**
 * 一支竹小枝:自 tile 底部升起、微弯的主枝,左 / 右 / 梢三处叶扇(各 4–6 片自一点
 * 放射、整体下垂的披针叶),沿枝再散 3 片单叶 —— 即国画竹叶"个 / 介"字形。
 * tile 中心 (cx, cy),尺寸 1;叶长 ≈ 0.3 tile。
 */
export function buildBambooSprayTile(
  g: Grower,
  sp: SpeciesParams,
  rng: () => number,
  cx: number,
  cy: number,
): void {
  const fol = sp.foliage;
  const leaf = fol.leaf;
  const LEAF_T = 0.3;
  const LIM = 0.46;
  const sx = rng() < 0.5 ? 1 : -1;
  const twigRgb: Tint = [0.3, 0.34, 0.14];
  const m = new Matrix4();
  const q = new Quaternion();
  const q2 = new Quaternion();

  const shadeAt = (py: number): number => 0.62 + 0.38 * clamp01((py - (cy - 0.47)) / 0.94);

  /** 细枝条带(2 顶点/点,朝相机) */
  const strip = (pts: [number, number][], w0: number, w1: number, rgb: Tint): void => {
    const rows: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const t = i / (pts.length - 1);
      const [x, y] = pts[i];
      const [x0, y0] = pts[Math.max(0, i - 1)];
      const [x1, y1] = pts[Math.min(pts.length - 1, i + 1)];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const l = Math.hypot(dx, dy) || 1;
      const w = w0 + (w1 - w0) * t;
      const ox = (-dy / l) * w;
      const oy = (dx / l) * w;
      const sh = 0.8 + t * 0.3;
      rows.push([
        g.vertex(x - ox, y - oy, -0.01, 0, 0, 1, 0, t, rgb[0] * sh, rgb[1] * sh, rgb[2] * sh, 0.5),
        g.vertex(x + ox, y + oy, -0.01, 0, 0, 1, 1, t, rgb[0] * sh, rgb[1] * sh, rgb[2] * sh, 0.5),
      ]);
    }
    for (let i = 0; i < rows.length - 1; i++) {
      g.quad(rows[i][0], rows[i + 1][0], rows[i + 1][1], rows[i][1]);
    }
  };

  /** 单叶:基部 (bx, by),方向 (dx, dy),长 len(tile);越界自动截短 */
  const leafAt = (bx: number, by: number, dx: number, dy: number, len: number): void => {
    const l0 = Math.hypot(dx, dy) || 1;
    dx /= l0;
    dy /= l0;
    let L = len;
    if (dx > 1e-4) L = Math.min(L, (cx + LIM - bx) / dx);
    else if (dx < -1e-4) L = Math.min(L, (cx - LIM - bx) / dx);
    if (dy > 1e-4) L = Math.min(L, (cy + LIM - by) / dy);
    else if (dy < -1e-4) L = Math.min(L, (cy - LIM - by) / dy);
    if (L < LEAF_T * 0.35) return;
    // 局部 +z(叶长)→ tile 平面方向 (dx, dy);局部 +y(叶面)→ 朝相机 +z,带随机侧倾
    q.setFromAxisAngle(Z_AXIS, Math.atan2(-dx, dy));
    q2.setFromAxisAngle(X_AXIS, -Math.PI / 2 + (rng() - 0.5) * 1.1);
    q.multiply(q2);
    const s = L / leaf.len;
    m.compose(new Vector3(bx, by, (rng() - 0.5) * 0.04), q, new Vector3(s, s, s));
    const ao = shadeAt(by) * (0.9 + rng() * 0.2);
    const rgb = leafRgb(fol.color, (rng() * 2 - 1) * fol.hueVar);
    buildLeaf(g, m, leaf, [rgb[0] * ao, rgb[1] * ao, rgb[2] * ao], 0.5);
  };

  /** 叶扇:自 (bx, by) 伸出短小枝,枝端 n 片叶放射;扇心方向 = 枝向再向下压 */
  const fan = (bx: number, by: number, dx: number, dy: number, blen: number, n: number, lenK: number): void => {
    const l0 = Math.hypot(dx, dy) || 1;
    dx /= l0;
    dy /= l0;
    const tx = bx + dx * blen;
    const ty = by + dy * blen;
    strip([[bx, by], [tx, ty]], 0.009, 0.005, twigRgb);
    const fl = Math.hypot(dx, dy - 0.7) || 1;
    const a0 = Math.atan2((dy - 0.7) / fl, dx / fl);
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / (n - 1) - 0.5) * 1.75 + (rng() - 0.5) * 0.3;
      leafAt(tx, ty, Math.cos(a), Math.sin(a), LEAF_T * lenK * (0.78 + rng() * 0.4));
    }
  };

  const P: [number, number][] = [
    [cx, cy - 0.47],
    [cx + sx * 0.05, cy - 0.12],
    [cx + sx * 0.1, cy + 0.12],
    [cx + sx * 0.13, cy + 0.3],
  ];
  strip(P, 0.016, 0.007, twigRgb);
  fan(P[1][0], P[1][1], -sx, -0.3, 0.1, 4 + ((rng() * 2) | 0), 1.0);
  fan(P[2][0], P[2][1], sx, -0.25, 0.08, 4 + ((rng() * 2) | 0), 1.0);
  fan(P[3][0], P[3][1], sx * 0.35, 1, 0.05, 5 + ((rng() * 2) | 0), 0.95);
  const mid = (a: [number, number], b: [number, number], k: number): [number, number] => [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
  ];
  const m01 = mid(P[0], P[1], 0.6);
  const m12 = mid(P[1], P[2], 0.5);
  const m23 = mid(P[2], P[3], 0.5);
  leafAt(m01[0], m01[1], -sx, -0.55, LEAF_T * 0.9);
  leafAt(m12[0], m12[1], sx, -0.5, LEAF_T * 0.9);
  leafAt(m23[0], m23[1], -sx, -0.35, LEAF_T * 0.85);
}
