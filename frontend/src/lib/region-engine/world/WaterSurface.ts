/**
 * 水面系统:河流 + 湖泊共用一张全域网格。
 *
 * - 顶点:采样外扩水位纹理(waterExtTex,岸外 ~4 texel 仍有水位)。
 *   有水顶点抬到水位;无水顶点贴着地形下沉(距离越远沉越深,抵消远处
 *   CDLOD 顶点误差)—— 水面在岸下延伸,岸线 = 水平面与地形的逐像素相交,
 *   不再出现"下沉 60 m 拉出的白墙"和方块状湖缘。
 * - 片元 kernel(waterMaterial):
 *   · 河道:沿流向拉长的各向异性 fbm 波纹,双相平流(along 坐标推进),
 *     波纹方向严格贴合河道走向;泡沫条纹随流漂移。
 *   · 湖面:各向同性缓慢漂移微波。
 *   · Beer-Lambert 深度吸收(浅滩透河床色 → 深水墨绿)。
 *   · 菲涅尔天空反射 + 岸线泡沫。
 */

import { DoubleSide, Mesh, PlaneGeometry } from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import {
  cameraPosition,
  clamp,
  exp,
  float,
  fract,
  mix,
  positionLocal,
  positionWorld,
  smoothstep,
  texture,
  transformNormalToView,
  vec2,
  vec3,
} from "three/tsl";
import { fbm2 } from "../gpu/noise";
import type { NF, NV2 } from "../gpu/tsl-types";
import type { EnvState } from "../render/env";
import {
  sampleFloatBilinear,
  sampleWaterLevel,
  worldUv,
  type WorldTextures,
} from "../render/fields";

const GRID_SEGS = 512;

export function createWaterSurface(tex: WorldTextures, env: EnvState): Mesh {
  const { res, size } = tex;
  const geo = new PlaneGeometry(size, size, GRID_SEGS, GRID_SEGS);
  geo.rotateX(-Math.PI / 2);

  const mat = new MeshStandardNodeMaterial();
  mat.transparent = true;
  mat.metalness = 0.02;
  mat.depthWrite = false;
  mat.side = DoubleSide; // 潜水后从水下抬头仍能看到水面

  // --- 顶点:有水 → 水位;无水 → 贴地形下沉(近处 1.2 m,远处最多 45 m) ---
  const wpos = positionLocal.xz;
  const w = sampleWaterLevel(tex.waterExtTex, wpos, res, size);
  const ground = sampleFloatBilinear(tex.heightTex, wpos, res, size);
  const camD = wpos.sub(vec2(cameraPosition.x, cameraPosition.z)).length();
  const sink = clamp(camD.mul(0.03), 1.2, 45);
  const y = w.valid.greaterThan(0.5).select(w.y.add(0.02), ground.sub(sink));
  mat.positionNode = vec3(wpos.x, y, wpos.y);

  // --- 片元 ---
  const fw = positionWorld.xz;
  const uv = worldUv(fw, size);
  const fld = texture(tex.fieldsTex, uv).toVar(); // rg=flow b=profile a=lake

  const flow = fld.xy.mul(2).sub(1).toVar();
  const flowMag = flow.length().toVar();
  // 有向水流权重:只有流场强且非湖面才用各向异性波纹。
  // 湖心/静水的弱噪声流向会让拉伸 fbm 随 T 旋转成"人字纹万花筒",必须挡掉。
  const hasFlow = smoothstep(0.16, 0.42, flowMag)
    .mul(float(1).sub(fld.w))
    .toVar();
  // 沿流/横向单位基(静水时 T≈0,但 hasFlow 已把它挡掉)
  const T = flow.div(flowMag.max(0.001)).toVar();
  const Nv = vec2(T.y.negate(), T.x).toVar();
  const along = fw.x.mul(T.x).add(fw.y.mul(T.y)).toVar();
  const across = fw.x.mul(Nv.x).add(fw.y.mul(Nv.y)).toVar();

  const profile = fld.z.toVar();
  // 逐河流速:窄溪(剖面陡)快、宽河慢
  const speed = profile.mul(0.9).add(0.35).toVar();
  const t = env.time.mul(speed);

  // 双相 flowmap:两个错相平流样本按锯齿权重混合,消除平流漂移伪影。
  // 波纹域沿流向拉长(7 m)、横向压窄(3 m)→ 顺河道的长波纹,
  // 拉伸比降低以免流向弯折处出现明显的方向断裂。
  const phase0 = fract(t);
  const phase1 = fract(t.add(0.5));
  const blend = phase0.mul(2).sub(1).abs();
  const riverRipple = (phase: NF, off: number): NV2 => {
    const p = vec2(along.div(7).sub(phase.mul(3.2)), across.div(3)).add(off);
    const n1 = fbm2(p, 3);
    const n2 = fbm2(p.add(vec2(0.31, 0.77)), 3);
    return vec2(n1, n2);
  };
  const r0 = riverRipple(phase0, 0);
  const r1 = riverRipple(phase1, 37.7);
  const ripR = mix(r0, r1, blend).toVar();
  // (along, across) 系的扰动旋回世界系 → 法线沿河道取向
  const ripRiver = vec2(
    T.x.mul(ripR.x).add(Nv.x.mul(ripR.y)),
    T.y.mul(ripR.x).add(Nv.y.mul(ripR.y)),
  ).toVar();
  // 湖面:各向同性缓慢漂移微波
  const pLake = fw.div(6.5).add(vec2(env.time.mul(0.06), env.time.mul(0.045)));
  const ripLake = vec2(fbm2(pLake, 3), fbm2(pLake.add(vec2(0.31, 0.77)), 3));
  const ripple = mix(ripLake, ripRiver, hasFlow).mul(0.5).toVar();

  // 微涟漪(时间驱动,湖面也动)
  const micro1 = fbm2(fw.div(1.4).add(env.time.mul(0.18)), 2);
  const micro2 = fbm2(fw.div(1.4).add(vec2(9.1, 3.3)).sub(env.time.mul(0.15)), 2);
  // 法线扰动随距离衰减:远处高频波纹会混叠成摩尔纹/人字纹,只留低频起伏
  const camDF = fw.sub(vec2(cameraPosition.x, cameraPosition.z)).length();
  const detailK = smoothstep(140, 28, camDF).mul(0.72).add(0.28).toVar();
  const nrm = vec3(
    ripple.x.add(micro1.mul(0.35).mul(detailK)).mul(0.22).mul(detailK),
    1,
    ripple.y.add(micro2.mul(0.35).mul(detailK)).mul(0.22).mul(detailK),
  )
    .normalize()
    .toVar();
  mat.normalNode = transformNormalToView(nrm);

  // 深度吸收(Beer-Lambert):水深 = 水面 y − 河床高度
  const bedH = sampleFloatBilinear(tex.heightTex, fw, res, size);
  const depth = positionWorld.y.sub(bedH).max(0).toVar();
  const absorb = exp(depth.mul(-0.55));
  const shallow = vec3(0.32, 0.42, 0.36);
  const deep = vec3(0.05, 0.14, 0.16);
  let col = mix(deep, shallow, absorb);

  // 岸线泡沫 + 急流白沫:河道内泡沫纹理沿流平流(条纹顺水漂),湖面各向同性
  const foamIso = fbm2(fw.div(2.2).add(env.time.mul(0.35)), 3);
  const foamFlow = fbm2(
    vec2(along.div(6).sub(t.mul(3.2)), across.div(1.6)),
    3,
  );
  const foamNoise = mix(foamIso, foamFlow, hasFlow).mul(0.5).add(0.5).toVar();
  const shoreFoam = smoothstep(0.42, 0.06, depth).mul(foamNoise).mul(0.8);
  // 急流白沫只出现在真正的强流河段(hasFlow 门控),湖心不再泛白块
  const rapidFoam = profile.mul(speed).mul(foamNoise).mul(0.45).mul(hasFlow);
  const foam = clamp(shoreFoam.add(rapidFoam), 0, 0.85);
  col = mix(col, vec3(0.92, 0.95, 0.96), foam);
  // 夜晚压暗
  col = col.mul(env.nightK.mul(0.75).oneMinus());
  mat.colorNode = col;

  mat.roughnessNode = float(0.08).add(foam.mul(0.5));
  // 菲涅尔透明度:掠射更镜面(反射天空由 standard 光照 + envIntensity 提供)
  mat.opacityNode = clamp(float(0.62).add(depth.mul(0.25)).add(foam.mul(0.3)), 0.45, 0.96);

  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  mesh.renderOrder = 2;
  return mesh;
}
