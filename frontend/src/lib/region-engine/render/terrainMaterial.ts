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
  smoothstep,
  texture,
  transformNormalToView,
  vec2,
  vec3,
} from "three/tsl";
import { fbm2, hash2, ridged2 } from "../gpu/noise";
import type { NF, NV2, NV3 } from "../gpu/tsl-types";
import type { EnvState } from "./env";
import { sampleFloatBilinear, worldUv, type WorldTextures } from "./fields";

export type TerrainShading = {
  colorNode: NV3;
  normalNode: NV3;
  roughnessNode: NF;
  /** 世界空间法线(供其他系统复用) */
  worldNormal: NV3;
};

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

  // 湿润变暗 + 河岸浸润带
  const wet = clamp(bio.w.mul(0.45).add(fld.z.mul(0.5)), 0, 0.55);
  col = col.mul(wet.mul(0.5).oneMinus());

  // 云影(与云层同源的移动遮挡)
  if (opts.cloudShadow) {
    col = col.mul(opts.cloudShadow(wpos));
  }
  // 夜晚整体压暗交给光照;这里仅拉低饱和让月色更冷
  col = mix(col, vec3(col.dot(vec3(0.33))), env.nightK.mul(0.35));

  const roughness = float(0.95)
    .sub(snowK.mul(0.25))
    .sub(wet.mul(0.35))
    .clamp(0.35, 1);

  return {
    colorNode: col,
    normalNode: transformNormalToView(worldNormal),
    roughnessNode: roughness,
    worldNormal,
  };
}
