/**
 * GrassField — WebGPU 草地:每帧 compute 剔除 + 间接绘制(移植 LAAS `GroundRing`)。
 *
 * 槽 → 与之同余且离相机最近的世界格(clipmap wrap),零上传流式:
 *   ① 细格 0.14 m 铺到 ±104 m:先按距离稀释与视锥早退(只做哈希和一次取高),
 *      存活格才采样字段(生物群系/遮罩/湿度/法线/外扩水位/步道),
 *      按密度接受后把(打包格坐标,地面高 + 法线 + 外观)追加进近/中/远三张紧凑表;
 *   ② 粗格 0.65 m 的远景超级草丛在 92~196 m 接力,再往外交给地形 splat;
 *   ③ 间接绘制只画活着且可见的实例。WebGL2 后端没有 compute,沿用 GrassRing。
 *
 * 读作"真草"的几件事(LAAS 经验):
 *   - 近景 5 叶簇 × ~50 槽/m²:逐像素叶片交叠才读作厚草;
 *   - 稀释后存活者按 1/√thin 加宽,屏幕覆盖守恒,无密度断层;
 *   - 三档几何交界带屏幕抖动互补交接,两层像素互斥,密度恒定;
 *   - 法线随距离拉向地形法线,远处草毯与山坡同光、与 splat 融为一体;
 *   - 着色全提到顶点阶段(varying),片元只剩光照。
 * 风:顺风推进的草浪(两组行波)+ 逐叶细颤;第一人称近身踩踏让开。
 */

import {
  DoubleSide,
  Frustum,
  Group,
  Matrix4,
  Mesh,
  Vector3,
  Vector4,
  type BufferGeometry,
  type DataTexture,
  type PerspectiveCamera,
} from "three";
import {
  IndirectStorageBufferAttribute,
  MeshStandardNodeMaterial,
  type Renderer,
  type StorageBufferNode,
} from "three/webgpu";
import {
  Fn,
  If,
  Return,
  atomicAdd,
  atomicLoad,
  atomicStore,
  cameraPosition,
  clamp,
  cos,
  float,
  instanceIndex,
  instancedArray,
  int,
  interleavedGradientNoise,
  ivec2,
  mix,
  normalLocal,
  positionLocal,
  positionWorld,
  screenCoordinate,
  sin,
  smoothstep,
  storage,
  texture,
  textureLoad,
  transformNormalToView,
  uint,
  uniform,
  uniformArray,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { fbm2 } from "../gpu/noise";
import type { NB, NF, NU, NV2, NV3, NV4 } from "../gpu/tsl-types";
import { TRAIL_RANGE } from "../nav/corridor";
import type { EnvState } from "../render/env";
import { sampleFloatBilinear, sampleWaterLevel, type WorldTextures } from "../render/fields";
import { bladeClump, createGrassRing, tuftGeometry } from "./GrassRing";

const CELL = 0.14;
const GRID = 1536; // ±107.5 m
const R = 104;
const G_NEAR = 24;
const G_MID = 56;
/** 交接带半宽:剔除的双表重叠与材质抖动必须共用 */
const G_BAND = 8;
const FAR_CELL = 0.65;
const FAR_GRID = 640; // ±208 m
const FAR_R0 = 92;
const FAR_R = 196;
/** 近 / 中 / 远 / 远景超级草丛 */
const CAPS = [196_608, 327_680, 393_216, 131_072] as const;
/** 世界格坐标 ±1.5 万,16|16 打包前先偏置 */
const CELL_BIAS = 20_000;

// BIOME 序:草甸 林 雨林 农田 城区 荒漠 高山 湿地
const BIO_DENS = [1.25, 0.62, 0.45, 0.4, 0.32, 0.08, 0.8, 1.05];
const BIO_HEIGHT = [1.0, 0.82, 1.1, 0.85, 0.45, 0.55, 0.5, 1.35];
const BIO_DRY = [0.1, 0.04, 0, 0.22, 0.08, 0.75, 0.38, 0];

type Mode = "near" | "mid" | "tuft" | "far";
type Bind = { base: number; cell: number; salt: number };

/** pcg 整数格哈希 → [0,1):compute 与顶点阶段逐位一致,大坐标也不会像 sin 哈希那样失真 */
function pcgCell(wc: NV2, salt: number): NF {
  const x = wc.x.add(CELL_BIAS).toUint();
  const y = wc.y.add(CELL_BIAS).toUint();
  const s0 = x
    .mul(uint(1597334677))
    .bitXor(y.mul(uint(3812015801)))
    .bitXor(uint(Math.imul(salt, 2654435761) >>> 0));
  const s = s0.mul(uint(747796405)).add(uint(2891336453));
  const w = s.shiftRight(s.shiftRight(uint(28)).add(uint(4))).bitXor(s).mul(uint(277803737));
  const r = w.shiftRight(uint(22)).bitXor(w);
  return float(r.shiftRight(uint(8))).mul(1 / 16777216);
}

/** 连续稀释:~16 m 内满密度,104 m 处 ~0.34;存活者按 1/√thin 加宽 */
function thinAt(dist: NF): NF {
  return float(58).div(dist.max(1).add(42)).min(1).pow(1.15);
}

function byBio(id: NF, vals: readonly number[]): NF {
  let e: NF = float(vals[vals.length - 1] as number);
  for (let k = vals.length - 2; k >= 0; k--) {
    e = id.lessThan(k + 0.5).select(float(vals[k] as number), e) as unknown as NF;
  }
  return e;
}

/**
 * 距离带抖动交接(LAAS bandFade):出层画 IGN < fadeOut,入层画 IGN ≥ 1 − fadeIn,
 * 同一带宽下两层像素集合严格互补,带内叶片密度恒定。
 */
function bandFade(mat: MeshStandardNodeMaterial, dist: NF, fadeIn: number | null, fadeOut: number | null): void {
  const inV =
    fadeIn !== null ? (varying(smoothstep(fadeIn - G_BAND, fadeIn + G_BAND, dist)) as unknown as NF) : null;
  const outV =
    fadeOut !== null
      ? (varying(float(1).sub(smoothstep(fadeOut - G_BAND, fadeOut + G_BAND, dist))) as unknown as NF)
      : null;
  if (!inV && !outV) return;
  const ign = interleavedGradientNoise(screenCoordinate.xy) as unknown as NF;
  let cond: NB | null = null;
  if (inV) cond = ign.greaterThanEqual(float(1).sub(inV)) as unknown as NB;
  if (outV) {
    const c2 = ign.lessThan(outV) as unknown as NB;
    cond = cond ? (cond.and(c2) as unknown as NB) : c2;
  }
  mat.maskNode = cond;
}

export class GrassField {
  readonly group = new Group();
  private readonly camU = uniform(new Vector3());
  private readonly planesU = uniformArray(Array.from({ length: 6 }, () => new Vector4()));
  private readonly frustum = new Frustum();
  private readonly projView = new Matrix4();
  private readonly geos: BufferGeometry[] = [];
  private readonly mats: MeshStandardNodeMaterial[] = [];
  private kernels: Parameters<Renderer["compute"]>[0] = [];

  constructor(
    private readonly renderer: Renderer,
    private readonly tex: WorldTextures,
    private readonly env: EnvState,
    private readonly trail: DataTexture | null,
  ) {
    this.build();
  }

  private build(): void {
    const { tex, trail, camU, planesU } = this;
    const { res, size } = tex;
    const salt = (tex.seed % 9973) + 17;
    const farSalt = salt + 7919;

    const offsets: number[] = [];
    let total = 0;
    for (const cap of CAPS) {
      offsets.push(total);
      total += cap;
    }
    const cells = instancedArray(total, "uint");
    const data = instancedArray(total, "vec4");
    const counters = instancedArray(CAPS.length, "uint").toAtomic();

    const clearK = Fn(() => {
      for (let g = 0; g < CAPS.length; g++) atomicStore(counters.element(uint(g)), uint(0));
    })().compute(1);
    clearK.setName("grassClear");

    /** 环形槽 → 同余且离相机最近的世界格 */
    const worldCell = (sx: NF, sy: NF, grid: number, cell: number): NV2 => {
      const camC = vec2(camU.x, camU.z).div(cell);
      return vec2(
        camC.x.sub(sx).div(grid).round().mul(grid).add(sx),
        camC.y.sub(sy).div(grid).round().mul(grid).add(sy),
      );
    };

    const texelOf = (wpos: NV2) => {
      const p = wpos.div(size).add(0.5).mul(res);
      return ivec2(clamp(p.x, 0, res - 1).toInt(), clamp(p.y, 0, res - 1).toInt());
    };

    const inFrustum = (c: NV3, slack: number): NB => {
      let ok: NB | null = null;
      for (let p = 0; p < 6; p++) {
        const pl = planesU.element(int(p)) as unknown as NV4;
        const cond = pl.xyz.dot(c).add(pl.w).greaterThan(-slack) as unknown as NB;
        ok = ok ? (ok.and(cond) as unknown as NB) : cond;
      }
      return ok as NB;
    };

    const append = (g: number, wc: NV2, inst: NV4): void => {
      const idx = atomicAdd(counters.element(uint(g)), uint(1)) as unknown as NU;
      If(idx.lessThan(uint(CAPS[g] as number)), () => {
        const at = idx.add(uint(offsets[g] as number));
        cells
          .element(at)
          .assign(wc.x.add(CELL_BIAS).toUint().shiftLeft(uint(16)).bitOr(wc.y.add(CELL_BIAS).toUint()));
        data.element(at).assign(inst);
      });
    };

    /**
     * 字段 → 密度 + 实例数据(地面高, 法线 x, 法线 z, 外观 4×6 bit)。
     * 外观:高度系数/2、干枯、林荫、湿度,整数在 f32 内精确。
     */
    const sampleGrass = (wpos: NV2, dist: NF, scruff: boolean): { dens: NF; inst: NV4 } => {
      const h = sampleFloatBilinear(tex.heightTex, wpos, res, size).toVar();
      // 与水面网格同源的外扩水位:低岸被淹没处不长草
      const wl = sampleWaterLevel(tex.waterExtTex, wpos, res, size);
      const above = wl.valid.greaterThan(0.5).select(h.sub(wl.y), float(99)).toVar();
      If(above.lessThan(0.04), () => {
        Return();
      });
      const tc = texelOf(wpos);
      const bio = textureLoad(tex.biomeTex, tc).toVar(); // r=id/8 g=雪 b=植被 a=湿度
      const msk = textureLoad(tex.maskTex, tc).toVar(); // r=林 g=田 b=城 a=沙
      const fld = textureLoad(tex.fieldsTex, tc).toVar(); // b=河床剖面
      const uvW = wpos.div(size).add(0.5).toVar();
      const nt = texture(tex.normalTex, uvW, 0) as unknown as NV4;
      const nrm = vec3(nt.x.mul(2).sub(1), nt.y, nt.z.mul(2).sub(1)).normalize().toVar();
      const id = bio.x.mul(8).round().toVar();
      const slope = nrm.y.oneMinus().mul(2.4).clamp(0, 1);
      const canopy = smoothstep(0.25, 0.8, msk.x).toVar();
      const bank = smoothstep(0.06, 0.5, above).mul(float(1).sub(smoothstep(0.2, 0.9, fld.z).mul(0.78)));
      // ~13 m 团簇 × ~45 m 宏观疏密,湿润处斑块下限更高(连片)
      const patchRaw = fbm2(wpos.div(13), 2)
        .mul(0.5)
        .add(0.5)
        .mul(0.55)
        .add(fbm2(wpos.div(45).add(vec2(31.7, 11.3)), 2).mul(0.5).add(0.5).mul(0.45));
      const patchFloor = bio.w.mul(0.35).add(0.5);
      const patchK = smoothstep(0.25, 0.75, patchRaw)
        .mul(float(1).sub(patchFloor))
        .add(patchFloor)
        .toVar();
      const halfR = size / 2;
      const edgeD = wpos.x.abs().max(wpos.y.abs());
      const hard = bio.y
        .mul(0.97)
        .oneMinus()
        .mul(smoothstep(0.3, 0.65, msk.z).mul(0.85).oneMinus())
        .mul(smoothstep(0.3, 0.65, msk.w).oneMinus())
        .mul(smoothstep(0.3, 0.7, msk.y).mul(0.85).oneMinus())
        .mul(smoothstep(0.5, 0.9, slope).oneMinus())
        .mul(bank)
        .mul(float(1).sub(smoothstep(halfR - 16, halfR - 4, edgeD)))
        .toVar();
      // 步道:中线踩秃,边缘矮而稀
      let wear: NF = float(0);
      if (trail) {
        const tv = (texture(trail, uvW, 0) as unknown as NV4).xy.mul(TRAIL_RANGE * 2).sub(TRAIL_RANGE);
        wear = float(1).sub(smoothstep(0.7, 1.7, tv.length())).toVar();
      }
      let dens = byBio(id, BIO_DENS)
        .mul(bio.z.mul(0.9).add(0.4))
        .mul(patchK)
        .mul(canopy.mul(0.45).oneMinus())
        .mul(hard);
      if (scruff) {
        // 近场保底(LAAS Pillar A):12 m 内不允许全秃,硬门控照样生效
        dens = dens.max(float(0.35).mul(float(1).sub(smoothstep(8, 14, dist))).mul(hard));
      }
      dens = dens.mul(wear.mul(0.82).oneMinus()).clamp(0, 1).toVar();

      const lush = patchK.mul(0.5).add(bio.z.mul(0.5));
      const hK = byBio(id, BIO_HEIGHT).mul(lush.mul(0.7).add(0.6)).mul(wear.mul(0.6).oneMinus());
      const dry = byBio(id, BIO_DRY)
        .add(float(0.35).sub(bio.w).max(0).mul(0.7))
        .add(float(1).sub(patchK).mul(0.3).mul(bio.w.oneMinus()))
        .add(bio.y.mul(0.5));
      const q6 = (v: NF): NF => v.clamp(0, 1).mul(63).round();
      const look = q6(hK.mul(0.5))
        .add(q6(dry).mul(64))
        .add(q6(canopy).mul(4096))
        .add(q6(bio.w).mul(262144));
      // 坡上簇基略下沉,免得上坡侧悬空
      const groundY = h.sub(slope.mul(0.06).add(0.03));
      return { dens, inst: vec4(groundY, nrm.x, nrm.z, look).toVar() };
    };

    const fineK = Fn(() => {
      const i = instanceIndex;
      If(i.greaterThanEqual(uint(GRID * GRID)), () => {
        Return();
      });
      const wc = worldCell(float(i.mod(uint(GRID))), float(i.div(uint(GRID))), GRID, CELL).toVar();
      const wpos = wc.add(vec2(pcgCell(wc, salt + 1), pcgCell(wc, salt + 2))).mul(CELL).toVar();
      const dist = wpos.sub(vec2(camU.x, camU.z)).length().toVar();
      If(dist.greaterThan(R), () => {
        Return();
      });
      const budget = thinAt(dist).mul(float(1).sub(smoothstep(R * 0.88, R, dist))).toVar();
      const pick = pcgCell(wc, salt + 3).toVar();
      If(pick.greaterThanEqual(budget), () => {
        Return();
      });
      const hN = textureLoad(tex.heightTex, texelOf(wpos)).x;
      If(inFrustum(vec3(wpos.x, hN.add(0.4), wpos.y), 1.6).not(), () => {
        Return();
      });
      const g = sampleGrass(wpos, dist, true);
      If(pick.greaterThanEqual(g.dens.mul(budget)), () => {
        Return();
      });
      // 交界带内的格同时进相邻两表,由材质抖动互补决定逐像素归属
      If(dist.lessThan(G_NEAR + G_BAND), () => {
        append(0, wc, g.inst);
      });
      If(dist.greaterThanEqual(G_NEAR - G_BAND).and(dist.lessThan(G_MID + G_BAND)), () => {
        append(1, wc, g.inst);
      });
      If(dist.greaterThanEqual(G_MID - G_BAND), () => {
        append(2, wc, g.inst);
      });
    })().compute(GRID * GRID);
    fineK.setName("grassCull");

    const farK = Fn(() => {
      const i = instanceIndex;
      If(i.greaterThanEqual(uint(FAR_GRID * FAR_GRID)), () => {
        Return();
      });
      const wc = worldCell(float(i.mod(uint(FAR_GRID))), float(i.div(uint(FAR_GRID))), FAR_GRID, FAR_CELL).toVar();
      const wpos = wc.add(vec2(pcgCell(wc, farSalt + 1), pcgCell(wc, farSalt + 2))).mul(FAR_CELL).toVar();
      const dist = wpos.sub(vec2(camU.x, camU.z)).length().toVar();
      If(dist.lessThan(FAR_R0 - 14).or(dist.greaterThan(FAR_R)), () => {
        Return();
      });
      // 细格消散区里淡入,splat 交接处淡出
      const budget = smoothstep(FAR_R0 - 14, FAR_R0 + 14, dist)
        .mul(float(1).sub(smoothstep(FAR_R * 0.9, FAR_R, dist)))
        .mul(0.55)
        .toVar();
      const pick = pcgCell(wc, farSalt + 3).toVar();
      If(pick.greaterThanEqual(budget), () => {
        Return();
      });
      const hN = textureLoad(tex.heightTex, texelOf(wpos)).x;
      If(inFrustum(vec3(wpos.x, hN.add(0.6), wpos.y), 2.2).not(), () => {
        Return();
      });
      const g = sampleGrass(wpos, dist, false);
      If(pick.greaterThanEqual(g.dens.mul(budget)), () => {
        Return();
      });
      append(3, wc, g.inst);
    })().compute(FAR_GRID * FAR_GRID);
    farK.setName("grassFarCull");

    // ---------------- 间接绘制 ----------------
    const geos = [bladeClump(5, 3), bladeClump(3, 2), tuftGeometry(), tuftGeometry(0.21)];
    const modes: Mode[] = ["near", "mid", "tuft", "far"];
    const fades: [number | null, number | null][] = [
      [null, G_NEAR],
      [G_NEAR, G_MID],
      [G_MID, null],
      [null, null],
    ];
    const D = geos.length;
    const indirectData = new Uint32Array(D * 5);
    const indirectAttr = new IndirectStorageBufferAttribute(indirectData, 5);
    for (let d = 0; d < D; d++) {
      const geo = geos[d]!;
      indirectData[d * 5] = geo.index ? geo.index.count : 0;
      geo.setIndirect(indirectAttr, d * 20);
      const bind: Bind =
        d === 3
          ? { base: offsets[3] as number, cell: FAR_CELL, salt: farSalt }
          : { base: offsets[d] as number, cell: CELL, salt };
      const mat = this.grassMaterial(cells, data, bind, modes[d]!, fades[d]!);
      const mesh = new Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.renderOrder = d;
      mesh.name = `grass-${modes[d]}`;
      this.group.add(mesh);
      this.geos.push(geo);
      this.mats.push(mat);
    }
    const indirect = storage(indirectAttr, "uint", D * 5);
    const indirectK = Fn(() => {
      for (let d = 0; d < D; d++) {
        const raw = atomicLoad(counters.element(uint(d))) as unknown as NU;
        const cap = uint(CAPS[d] as number);
        indirect.element(uint(d * 5 + 1)).assign(raw.greaterThan(cap).select(cap, raw));
      }
    })().compute(1);
    indirectK.setName("grassIndirect");

    this.kernels = [clearK, fineK, farK, indirectK];
  }

  /** 叶簇/草丛材质:顶点阶段完成摆放、风、踩踏与全部着色项 */
  private grassMaterial(
    cells: StorageBufferNode<"uint">,
    data: StorageBufferNode<"vec4">,
    bind: Bind,
    mode: Mode,
    fades: [number | null, number | null],
  ): MeshStandardNodeMaterial {
    const { env } = this;
    const mat = new MeshStandardNodeMaterial();
    const at = instanceIndex.add(uint(bind.base));
    const packed = cells.element(at) as unknown as NU;
    const wc = vec2(
      float(packed.shiftRight(uint(16))).sub(CELL_BIAS),
      float(packed.bitAnd(uint(0xffff))).sub(CELL_BIAS),
    ).toVar();
    const inst = (data.element(at) as unknown as NV4).toVar();
    const groundY = inst.x;
    const tN = vec3(inst.y, float(1).sub(inst.y.mul(inst.y)).sub(inst.z.mul(inst.z)).max(0.0001).sqrt(), inst.z);
    // 外观解包:除数都是 2 的幂,f32 内精确
    const m0 = inst.w;
    const qa = m0.div(262144).floor();
    const m1 = m0.sub(qa.mul(262144));
    const qb = m1.div(4096).floor();
    const m2 = m1.sub(qb.mul(4096));
    const qc = m2.div(64).floor();
    const qd = m2.sub(qc.mul(64));
    const moist = qa.div(63);
    const shade = qb.div(63);
    const dry = qc.div(63);
    const hK = qd.div(63).mul(2);

    const wpos = wc.add(vec2(pcgCell(wc, bind.salt + 1), pcgCell(wc, bind.salt + 2))).mul(bind.cell).toVar();
    const hH = pcgCell(wc, bind.salt + 11);
    const hYaw = pcgCell(wc, bind.salt + 12);
    const tilt = vec2(pcgCell(wc, bind.salt + 13), pcgCell(wc, bind.salt + 14)).sub(0.5).mul(0.5);
    const hHue = pcgCell(wc, bind.salt + 15).toVar();
    const hSeed = pcgCell(wc, bind.salt + 16);
    const dist = wpos.sub(vec2(cameraPosition.x, cameraPosition.z)).length().toVar();

    // 覆盖守恒加宽;远景超级草丛自带固定占地
    const widen =
      mode === "far" ? hSeed.mul(0.8).add(1.6) : float(1).div(thinAt(dist).sqrt()).clamp(1, 4);
    const baseH =
      mode === "far"
        ? hH.mul(0.36).add(0.3)
        : mode === "tuft"
          ? hH.pow(1.3).mul(0.34).add(0.24)
          : hH.pow(1.3).mul(0.32).add(0.2);
    const bladeH = baseH.mul(hK).mul(widen.sub(1).mul(0.25).add(1)).toVar();
    // 矮草(修剪草坪/高山草甸)水平方向同比收紧,弯折不至于躺平
    const hz = bladeH.mul(2.2).clamp(0.45, 1.2);
    const wk = mode === "near" ? 1.15 : mode === "mid" ? 1.25 : mode === "tuft" ? 1.5 : 1;
    const ls = positionLocal.mul(vec3(widen.mul(wk).mul(hz), bladeH, hz)).toVar();
    const yawA = hYaw.mul(6.2831853);
    const c = cos(yawA);
    const s = sin(yawA);
    const rx = ls.x.mul(c).add(ls.z.mul(s));
    const rz = ls.z.mul(c).sub(ls.x.mul(s));
    const tH = positionLocal.y; // 叶内高度 0..~1.3

    // ---- 风:顺风推进的草浪(λ≈37 m 主浪被横向慢波扭弯 + λ≈16 m 次浪)+ 细颤 ----
    const wd = env.windDir as unknown as NV2;
    const st = env.windStrength as unknown as NF;
    const adv = wpos.sub(wd.mul(env.time.mul(9.5)));
    const along = adv.dot(wd);
    const across = adv.x.mul(wd.y).sub(adv.y.mul(wd.x));
    const wave = sin(along.mul(0.17).add(sin(across.mul(0.043)).mul(1.7)))
      .mul(0.32)
      .add(sin(along.mul(0.39).add(across.mul(0.11)).add(2.1)).mul(0.14))
      .add(0.54);
    const amp = st.mul(wave.mul(0.9).add(0.25));
    // 强风压倒草毯:形变超线性,节奏不变
    const bend = amp.mul(st.mul(0.55).add(0.6)).mul(tH.mul(tH)).mul(bladeH.mul(0.45));
    const flut =
      mode === "near" || mode === "mid"
        ? sin(env.time.mul(5.2).add(hHue.mul(6.2832)).add(wpos.x.add(wpos.y).mul(0.9)))
            .mul(tH)
            .mul(amp)
            .mul(bladeH)
            .mul(0.11)
        : float(0);
    let dx: NF = wd.x.mul(bend).sub(wd.y.mul(flut));
    let dz: NF = wd.y.mul(bend).add(wd.x.mul(flut));
    let dy: NF = bend.mul(tH).mul(-0.4);
    if (mode === "near") {
      // 第一人称踩踏:眼高 ~1.7 m 时脚下 1 m 内叶片向外倒伏
      const toCam = wpos.sub(vec2(cameraPosition.x, cameraPosition.z));
      const dc = toCam.length().max(0.001);
      const press = smoothstep(1.15, 0.2, dc).mul(smoothstep(2.6, 1.85, cameraPosition.y.sub(groundY)));
      const away = toCam.div(dc);
      const push = press.mul(tH).mul(bladeH).mul(0.9);
      dx = dx.add(away.x.mul(push));
      dz = dz.add(away.y.mul(push));
      dy = dy.sub(press.mul(tH.mul(tH)).mul(bladeH).mul(0.45));
    }
    // 随机倾倒(剪切)—— 全部笔直向上读作"种的玉米"
    mat.positionNode = vec3(
      rx.add(tilt.x.mul(ls.y)).add(dx).add(wpos.x),
      ls.y.add(groundY).add(dy),
      rz.add(tilt.y.mul(ls.y)).add(dz).add(wpos.y),
    );

    // ---- 法线:yaw 旋转弧面法线 → 随距离拉向地形法线 ----
    const nR = vec3(
      normalLocal.x.mul(c).add(normalLocal.z.mul(s)),
      normalLocal.y,
      normalLocal.z.mul(c).sub(normalLocal.x.mul(s)),
    );
    const upK =
      mode === "far" ? float(1) : mode === "tuft" ? float(0.92) : smoothstep(8, 60, dist).mul(0.35).add(0.5);
    const nV = varying(mix(nR.normalize(), tN, upK)) as unknown as NV3;
    mat.normalNode = transformNormalToView(nV.normalize());

    // ---- 颜色:对齐地形 splat 草色,世界空间 1.8 m 色块(各 LOD 一致)----
    const t = uv().y as unknown as NF;
    const fresh = mix(vec3(0.105, 0.17, 0.055), vec3(0.24, 0.36, 0.13), t.mul(t));
    const dryC = mix(vec3(0.14, 0.12, 0.05), vec3(0.31, 0.27, 0.11), t);
    const pc = wpos.div(1.8).floor();
    const patchX = pcgCell(pc, 701);
    const patchY = pcgCell(pc, 702);
    const dryK = dry
      .add(smoothstep(0.68, 0.95, patchX).mul(0.5))
      .clamp(0, 1)
      .mul(shade.mul(0.85).oneMinus());
    let albedo = mix(fresh, dryC, dryK) as unknown as NV3;
    albedo = albedo.mul(patchY.sub(0.5).mul(0.24).add(1)) as unknown as NV3;
    albedo = albedo.mul(
      vec3(hHue.sub(0.5).mul(0.12).add(1), float(1), hHue.sub(0.5).mul(-0.1).add(1)),
    ) as unknown as NV3;
    // 林下:深冷绿(干草斑是全日照现象)
    albedo = mix(albedo, vec3(0.06, 0.11, 0.04), shade.mul(0.5)) as unknown as NV3;
    // 湿地微暗(与地形 splat 的浸润一致)
    albedo = albedo.mul(moist.mul(0.2).oneMinus()) as unknown as NV3;
    if (mode === "near") {
      // 草甸里零星抽穗:叶尖淡麦色
      const seedOn = hSeed
        .lessThan(float(0.08).mul(shade.oneMinus()).mul(dry.mul(0.6).oneMinus()))
        .select(float(1), float(0));
      albedo = mix(albedo, vec3(0.46, 0.42, 0.3), seedOn.mul(smoothstep(0.78, 0.97, t)).mul(0.75)) as unknown as NV3;
    }
    const lum = albedo.dot(vec3(0.33, 0.33, 0.33));
    albedo = mix(albedo, vec3(lum, lum, lum), env.nightK.mul(0.35)) as unknown as NV3;
    mat.colorNode = varying(albedo) as unknown as NV3;

    // 叶尖背光透光:朝太阳看时叶片透亮(随昼夜衰减)
    const viewDir = positionWorld.sub(cameraPosition).normalize();
    const toward = clamp(viewDir.dot((env.sunDir as unknown as NV3).negate()), 0, 1);
    const sunI = float(3.2).sub(env.nightK.mul(2.85));
    const glow = toward.pow(5).mul(sunI).mul(0.09).mul(t);
    const sunCol = mix(vec3(0.9, 1.05, 0.55), vec3(0.15, 0.2, 0.35), env.nightK);
    mat.emissiveNode = varying(albedo.mul(sunCol).mul(glow)) as unknown as NV3;
    // 基部假自阴影
    mat.aoNode = varying(smoothstep(0.0, 0.55, t).mul(0.45).add(0.55)) as unknown as NF;
    mat.roughness = 0.85;
    mat.metalness = 0;
    mat.side = DoubleSide;
    bandFade(mat, dist, fades[0], fades[1]);
    return mat;
  }

  update(camera: PerspectiveCamera): void {
    camera.updateMatrixWorld();
    this.camU.value.copy(camera.position);
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView, camera.coordinateSystem);
    const arr = this.planesU.array as Vector4[];
    for (let p = 0; p < 6; p++) {
      const pl = this.frustum.planes[p];
      if (!pl) continue;
      arr[p]!.set(pl.normal.x, pl.normal.y, pl.normal.z, pl.constant);
    }
    void this.renderer.compute(this.kernels);
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}

export type GrassSystem = {
  group: Group;
  update: (camera: PerspectiveCamera) => void;
  dispose: () => void;
};

/** WebGPU:compute 剔除 + 间接绘制;WebGL2:顶点塌缩草环 */
export function createGrass(
  renderer: Renderer,
  tex: WorldTextures,
  env: EnvState,
  opts: { gpuCompute: boolean; trail: DataTexture | null },
): GrassSystem {
  if (opts.gpuCompute) {
    const field = new GrassField(renderer, tex, env, opts.trail);
    return {
      group: field.group,
      update: (camera) => field.update(camera),
      dispose: () => field.dispose(),
    };
  }
  const group = createGrassRing(tex, env);
  return { group, update: () => {}, dispose: () => {} };
}
