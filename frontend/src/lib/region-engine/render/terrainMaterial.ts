/**
 * 地形 splat 着色 kernel(宏-中-微三频)。
 *
 * 由生物群系/遮罩/湿度驱动的连续权重混合:草地、林下腐殖土、农田(垄行)、
 * 城区硬化地、沙地、坡度岩石(带地层条带)、雪盖;湿润变暗 + 河岸浸润 + 云影。
 * 法线在片元阶段从高度纹理有限差分重建(silhouette 由 CDLOD 顶点位移承担)。
 */

import {
  clamp,
  float,
  fract,
  mix,
  positionWorld,
  sin,
  smoothstep,
  texture,
  transformNormalToView,
  vec2,
  vec3,
} from "three/tsl";
import { fbm2, hash2, hashCell, ridged2 } from "../gpu/noise";
import type { NF, NV2, NV3 } from "../gpu/tsl-types";
import type { EnvState } from "./env";
import {
  sampleFloatBilinear,
  sampleWaterLevel,
  worldUv,
  type WorldTextures,
} from "./fields";

export type TerrainShading = {
  colorNode: NV3;
  normalNode: NV3;
  roughnessNode: NF;
  /** 世界空间法线(供其他系统复用) */
  worldNormal: NV3;
};

/** 2D Voronoi:f1/f2 为最近/次近平方距离,id 为格哈希(卵石镶嵌,非棋盘格) */
function voronoi2(p: NV2, seed: number): { f1: NF; f2: NF; id: NF } {
  const i0 = p.floor();
  const frac = p.sub(i0);
  // 材质图是表达式树,不能 .assign();用 JS 重绑定叠 9 邻域
  let f1: NF = float(8);
  let f2: NF = float(8);
  let id: NF = float(0);
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const g = vec2(ox, oy);
      const cell = i0.add(g);
      const hx = hashCell(cell, seed);
      const hy = hashCell(cell, seed + 19);
      const r = g.add(vec2(hx, hy)).sub(frac);
      const d = r.dot(r);
      const closer = d.lessThan(f1);
      f2 = closer.select(f1, d.lessThan(f2).select(d, f2)) as NF;
      id = closer.select(hx, id) as NF;
      f1 = closer.select(d, f1) as NF;
    }
  }
  return { f1, f2, id };
}

/** 水面折射焦散:两组旋转正弦叠成锐利亮网,随时间缓移 */
function waterCaustics(wp: NV2, time: NF): NF {
  const t = time.mul(0.55);
  const p = wp.div(0.95);
  const a = sin(p.x.mul(4.2).add(t)).mul(sin(p.y.mul(4.8).sub(t.mul(0.85))));
  const b = sin(p.x.add(p.y).mul(3.3).sub(t.mul(0.7))).mul(
    sin(p.x.sub(p.y).mul(3.7).add(t.mul(0.55))),
  );
  const web = a.abs().oneMinus().mul(b.abs().oneMinus());
  return web.mul(web).mul(web).mul(web);
}

export function buildTerrainShading(
  tex: WorldTextures,
  env: EnvState,
  opts: { cloudShadow?: (wpos: NV2) => NF } = {},
): TerrainShading {
  const { res, size } = tex;
  const wpos = positionWorld.xz;
  const uv = worldUv(wpos, size);

  // --- 法线:有限差分(片元阶段,texel 步长) ---
  const e = size / res;
  const hC = sampleFloatBilinear(tex.heightTex, wpos, res, size);
  const hX = sampleFloatBilinear(tex.heightTex, wpos.add(vec2(e, 0)), res, size);
  const hZ = sampleFloatBilinear(tex.heightTex, wpos.add(vec2(0, e)), res, size);
  const worldNormal = vec3(hC.sub(hX), float(e), hC.sub(hZ)).normalize().toVar();
  const slope = worldNormal.y.oneMinus().mul(2.4).clamp(0, 1).toVar();

  // --- 字段采样 ---
  const bio = texture(tex.biomeTex, uv).toVar(); // r=id/8 g=snow b=veg a=moist
  const msk = texture(tex.maskTex, uv).toVar(); // r=forest g=farm b=urban a=sand
  const fld = texture(tex.fieldsTex, uv).toVar(); // rg=flow b=riverProfile a=lake

  // --- 三频噪声 ---
  const macro = fbm2(wpos.div(46), 3).mul(0.5).add(0.5).toVar(); // 宏观色斑
  const meso = fbm2(wpos.div(7.5).add(vec2(13.1, 7.7)), 3).toVar(); // 中尺度
  const micro = fbm2(wpos.div(1.7).add(vec2(51.3, 29.2)), 2).toVar(); // 微细节

  // --- 各表面类 ---
  const grass = vec3(0.24, 0.36, 0.13)
    .mul(macro.mul(0.5).add(0.75))
    .add(meso.mul(0.028))
    .toVar();
  const forestFloor = vec3(0.14, 0.17, 0.08)
    .mul(macro.mul(0.4).add(0.8))
    .add(micro.mul(0.02))
    .toVar();
  // 农田:垄行条纹(方向逐 90 m 田块哈希旋转,每块田不一样)
  const cell = wpos.div(90).floor();
  const ang = hash2(cell, 7).mul(3.14159);
  const rowDir = vec2(ang.cos(), ang.sin());
  const rowT = fract(wpos.x.mul(rowDir.x).add(wpos.y.mul(rowDir.y)).div(3.4));
  const rowK = smoothstep(0.12, 0.3, rowT).mul(smoothstep(0.98, 0.72, rowT));
  const soil = vec3(0.3, 0.22, 0.14).mul(macro.mul(0.3).add(0.85));
  const crop = vec3(0.27, 0.4, 0.12).mul(hash2(cell, 3).mul(0.35).add(0.75));
  const farm = mix(soil, crop, rowK).add(micro.mul(0.015)).toVar();
  const urban = vec3(0.4, 0.4, 0.41)
    .mul(macro.mul(0.25).add(0.85))
    .add(meso.mul(0.02))
    .toVar();
  const sand = vec3(0.74, 0.63, 0.42)
    .mul(macro.mul(0.3).add(0.82))
    // 沙丘涟漪
    .add(fract(wpos.x.mul(0.35).add(meso.mul(2.2))).sub(0.5).abs().mul(0.07))
    .toVar();
  // 岩石:山脊噪声地层条带
  const strata = ridged2(wpos.div(11).add(vec2(hC.mul(0.13), 0)));
  const rock = vec3(0.36, 0.34, 0.32)
    .mul(strata.mul(0.4).add(0.65))
    .add(micro.mul(0.035))
    .toVar();
  const snowCol = vec3(0.9, 0.93, 0.97).add(micro.mul(0.02)).toVar();

  // --- 混合 ---
  const forestK = smoothstep(0.25, 0.75, msk.x).mul(bio.z.mul(0.5).add(0.5));
  const farmK = smoothstep(0.3, 0.7, msk.y);
  const urbanK = smoothstep(0.35, 0.75, msk.z);
  const sandK = smoothstep(0.3, 0.7, msk.w);
  const rockK = smoothstep(0.35, 0.75, slope.add(meso.mul(0.12)));
  // 雪:缓坡持雪 + 哈希抖动边缘
  const snowK = smoothstep(0.25, 0.6, bio.y.add(meso.mul(0.1))).mul(
    smoothstep(0.85, 0.45, slope),
  );

  let col: NV3 = grass;
  col = mix(col, forestFloor, forestK);
  col = mix(col, farm, farmK);
  col = mix(col, urban, urbanK);
  col = mix(col, sand, sandK);
  col = mix(col, rock, rockK);
  col = mix(col, snowCol, snowK);

  // 湿润变暗 + 河岸浸润带(fld.z 含岸坡肩部 → 读作水道痕迹)
  const wet = clamp(bio.w.mul(0.45).add(fld.z.mul(0.5)), 0, 0.55);
  col = col.mul(wet.mul(0.5).oneMinus());

  // —— 岸线带(基于邻近水位):水线湿痕 + 青苔;水下改走沙砾淤 splat ——
  const wl = sampleWaterLevel(tex.waterExtTex, wpos, res, size);
  const above = hC.sub(wl.y).toVar(); // 地面高出水面的量(岸上>0,水下<0)
  const shoreNoise = fbm2(wpos.div(2.7).add(vec2(7.7, 19.1)), 3)
    .mul(0.5)
    .add(0.5)
    .toVar();
  // 湿痕:水线上 ~0.5 m 内浸润变暗(水位涨落留下的深色印)
  const wetline = wl.valid.mul(smoothstep(0.55, 0.02, above)).toVar();
  // 青苔:紧贴水线的窄带,上缘被噪声撕碎;城区/沙地/雪地不长
  const mossBand = wl.valid
    .mul(smoothstep(-0.08, 0.12, above))
    .mul(smoothstep(1.05, 0.3, above.add(shoreNoise.mul(0.5).sub(0.25))))
    .mul(smoothstep(0.3, 0.78, shoreNoise))
    .mul(urbanK.oneMinus())
    .mul(sandK.oneMinus())
    .mul(snowK.oneMinus())
    .toVar();
  const mossCol = vec3(0.1, 0.185, 0.07).mul(macro.mul(0.35).add(0.85));
  col = mix(col, mossCol, mossBand.mul(0.85));

  // 水下河床(对照浅水实景):
  // 溪:黄褐沙/细砾为基质,仅部分 Voronoi 格是水磨卵石(禁止铺满蜂窝,否则远看棋盘);
  // 河:顺流沙波 + 稀疏砾斑;
  // 湖:灰黄粘土粉砂 + 有机条带,近岸薄沙,湖心几乎无石。
  const under = wl.valid.mul(smoothstep(0.06, -0.12, above)).toVar();
  const depthM = wl.y.sub(hC).max(0).toVar();
  const waterPoly = smoothstep(0.18, 0.62, fld.w).toVar();
  const inChan = smoothstep(0.05, 0.32, fld.z).toVar();
  // 多边形水体且无河道剖面 → 湖;宽河常同时有水面多边形+剖面,不能单靠 fld.w
  const lakeK = waterPoly.mul(smoothstep(0.34, 0.1, fld.z)).toVar();
  const seedK = (tex.seed % 1024) * 0.017;
  const lith = (tex.seed % 1000) * 0.001;
  const wp = wpos.add(vec2(seedK * 41.3, seedK * 73.1)).toVar();

  // 河道宽度:中心剖面平坦,不能用局部梯度。8 m 邻域剖面仍高 → 宽河,已掉 → 窄溪
  const uvW = 8 / size;
  const pNear = texture(tex.fieldsTex, uv.add(vec2(uvW, 0)))
    .z.min(texture(tex.fieldsTex, uv.add(vec2(-uvW, 0))).z)
    .min(texture(tex.fieldsTex, uv.add(vec2(0, uvW))).z)
    .min(texture(tex.fieldsTex, uv.add(vec2(0, -uvW))).z)
    .toVar();
  const chanK = inChan.mul(lakeK.oneMinus()).toVar();
  const streamK = chanK.mul(smoothstep(0.42, 0.14, pNear)).toVar();
  const riverK = chanK.mul(smoothstep(0.16, 0.48, pNear)).toVar();

  const cob = voronoi2(wp.div(0.3), tex.seed + 3);
  const grv = voronoi2(wp.div(0.05), tex.seed + 11);
  const cobRad = cob.f1.sqrt();
  const cobInside = smoothstep(0.24, 0.09, cobRad);
  const cobPick = smoothstep(
    0.22 + lith * 0.2,
    0.58 + lith * 0.15,
    cob.id.add(fbm2(wp.div(5.2), 2).mul(0.22)),
  );
  const cobMask = cobInside.mul(cobPick).toVar();
  const grit = smoothstep(0.065, 0.012, grv.f1.sqrt()).mul(
    smoothstep(0.48, 0.82, grv.id),
  );

  const sandstone = mix(vec3(0.5, 0.34, 0.18), vec3(0.58, 0.43, 0.26), lith);
  const shale = mix(vec3(0.27, 0.29, 0.31), vec3(0.36, 0.35, 0.33), lith);
  const granite = vec3(0.4, 0.38, 0.36);
  const cobCol = mix(
    mix(sandstone, shale, cob.id.mul(0.9)),
    granite,
    smoothstep(0.72, 0.96, cob.id),
  );
  const sandFill = vec3(0.39, 0.31, 0.2).mul(
    fbm2(wp.div(0.34).add(vec2(lith * 17, 2.1)), 3).mul(0.22).add(0.82),
  );
  const gritCol = mix(vec3(0.3, 0.26, 0.2), vec3(0.46, 0.38, 0.26), grv.id);
  let streamBed = mix(sandFill, gritCol, grit.mul(0.7));
  streamBed = mix(streamBed, cobCol.mul(0.62), cobMask);

  const flowV = fld.xy.mul(2).sub(1);
  const fMag = flowV.length().max(0.001);
  const T = flowV.div(fMag);
  const along = wp.x.mul(T.x).add(wp.y.mul(T.y));
  const dune = fract(along.div(0.72).add(fbm2(wp.div(2.6), 3).mul(0.35)))
    .sub(0.5)
    .abs();
  const riverSand = vec3(0.41, 0.33, 0.21)
    .mul(fbm2(wp.div(0.95), 3).mul(0.22).add(0.8))
    .add(dune.mul(0.06));
  const riverCob = cobInside.mul(smoothstep(0.72, 0.92, cob.id));
  const riverBed = mix(
    mix(riverSand, gritCol, grit.mul(0.58)),
    cobCol.mul(0.64),
    riverCob.mul(0.62),
  );

  const siltN = fbm2(wp.div(2.4).add(vec2(8.1 + lith * 9, 2.2)), 4).mul(0.5).add(0.5);
  const org = fbm2(wp.div(0.95).add(vec2(19.4, 6.7 + lith * 5)), 3);
  const silt = mix(vec3(0.3, 0.26, 0.16), vec3(0.14, 0.14, 0.1), siltN);
  const siltStreak = mix(
    silt,
    vec3(0.09, 0.09, 0.07),
    smoothstep(0.18, 0.58, org.abs()),
  );
  const lakeSand = vec3(0.36, 0.3, 0.19).mul(
    fbm2(wp.div(0.55), 3).mul(0.18).add(0.84),
  );
  const litter = smoothstep(
    0.72,
    0.93,
    fbm2(wp.div(0.32).add(vec2(4.4, 13.2)), 2),
  );
  let lakeBed = mix(siltStreak, lakeSand, smoothstep(1.15, 0.12, depthM).mul(0.72));
  lakeBed = mix(
    lakeBed,
    vec3(0.08, 0.07, 0.05),
    litter.mul(0.45).mul(smoothstep(0.12, 0.8, depthM)),
  );

  // 默认静水粉砂,再叠溪/河;湖多边形覆盖误判的河道
  let bed = lakeBed;
  bed = mix(bed, streamBed, streamK);
  bed = mix(bed, riverBed, riverK);
  bed = mix(bed, lakeBed, lakeK);

  // 近距沙粒/淤斑/细砾:所有水底都要有,否则远看是塑料平板
  const grain = fbm2(wp.div(0.032).add(vec2(1.7, 8.2)), 3);
  const grainM = fbm2(wp.div(0.11).add(vec2(5.1, 2.8)), 3);
  const mott = fbm2(wp.div(1.55).add(vec2(lith * 13, 4.4)), 4).mul(0.5).add(0.5);
  const speckle = smoothstep(0.04, 0.006, grv.f1.sqrt()).mul(
    smoothstep(0.32, 0.68, grv.id),
  );
  const gritAmt = streamK.mul(0.72).add(riverK.mul(0.55)).add(lakeK.mul(0.16)).add(0.2);
  bed = bed.mul(grain.mul(0.34).add(grainM.mul(0.12)).add(0.72));
  bed = mix(bed, bed.mul(0.48), smoothstep(0.55, 0.9, mott));
  bed = mix(bed, gritCol.mul(0.8), speckle.mul(gritAmt));
  const gcell = wp.mul(52).floor();
  const ghash = hashCell(gcell, tex.seed + 21);
  bed = bed.mul(ghash.mul(0.4).add(0.72));

  const algaeFilm = lakeK
    .add(riverK.mul(0.22))
    .mul(smoothstep(0.22, 0.8, shoreNoise))
    .mul(0.28);
  bed = mix(bed, vec3(0.13, 0.17, 0.09), algaeFilm);

  const caus = waterCaustics(wp, env.time);
  const causK = under.mul(smoothstep(3.4, 0.08, depthM).mul(0.55).add(0.45));
  bed = bed.mul(caus.mul(causK).mul(1.15).add(float(1).sub(causK.mul(0.28))));
  bed = bed.add(vec3(0.26, 0.28, 0.2).mul(caus.mul(causK)));

  col = mix(col, bed, under);
  col = col.mul(float(1).sub(wetline.mul(0.32)));

  // 云影(与云层同源的移动遮挡)
  if (opts.cloudShadow) {
    col = col.mul(opts.cloudShadow(wpos));
  }
  // 夜晚整体压暗交给光照;这里仅拉低饱和让月色更冷
  col = mix(col, vec3(col.dot(vec3(0.33))), env.nightK.mul(0.35));

  const roughness = float(0.96)
    .sub(snowK.mul(0.25))
    .sub(wet.mul(0.28))
    .sub(wetline.mul(0.22))
    .add(under.mul(0.06))
    .sub(cobMask.mul(under).mul(0.28))
    .clamp(0.32, 1);

  // 水下:沙粒法线要足够强才能读出颗粒,再叠卵石/沙波/粉砂
  const pebbleN = fbm2(wp.div(0.028).add(vec2(3.3, 8.8)), 3);
  const pebbleN2 = fbm2(wp.div(0.028).add(vec2(9.1, 1.4)), 3);
  const cobBump = cobMask.mul(streamK.add(riverK.mul(0.4))).mul(0.85);
  const gritBump = speckle.mul(gritAmt).mul(0.45);
  const duneBump = dune.sub(0.25).mul(riverK).mul(0.32);
  const siltBump = org.mul(lakeK).mul(0.2);
  const nAmp = under.mul(float(0.62).add(cobBump).add(gritBump).add(duneBump).add(siltBump));
  const shadedN = vec3(
    worldNormal.x.add(pebbleN.mul(nAmp)),
    worldNormal.y,
    worldNormal.z.add(pebbleN2.mul(nAmp)),
  )
    .normalize()
    .toVar();

  return {
    colorNode: col,
    normalNode: transformNormalToView(shadedN),
    roughnessNode: roughness,
    worldNormal: shadedN,
  };
}
