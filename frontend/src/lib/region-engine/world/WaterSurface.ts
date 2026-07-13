/**
 * 水面系统:河流 + 湖泊共用一张全域网格。
 *
 * - 顶点:采样 waterY 纹理(带 WATER_NONE 哨兵的有效性双线性),无水顶点沉入地下。
 * - 片元 kernel(waterMaterial):
 *   · 双相 flowmap 波纹 —— 沿 OSM 流向平流的 fbm 法线扰动,速度按河床剖面缩放
 *     (逐河唯一:宽河慢涌、窄溪急流);湖面为定常微波。
 *   · Beer-Lambert 深度吸收(浅滩透河床色 → 深水墨绿)。
 *   · 菲涅尔天空反射 + 岸线泡沫。
 */

import { Mesh, PlaneGeometry } from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import {
  clamp,
  exp,
  float,
  fract,
  ivec2,
  max,
  mix,
  positionLocal,
  positionWorld,
  smoothstep,
  texture,
  textureLoad,
  transformNormalToView,
  vec2,
  vec3,
} from "three/tsl";
import { fbm2 } from "../gpu/noise";
import type { NF, NV2 } from "../gpu/tsl-types";
import type { EnvState } from "../render/env";
import { sampleFloatBilinear, worldUv, type WorldTextures } from "../render/fields";

const GRID_SEGS = 320;
const NO_WATER = -5000;

/** waterY 有效性双线性:无效 texel 用邻域最大有效值补齐 */
function sampleWaterY(tex: WorldTextures, wpos: NV2): { y: NF; valid: NF } {
  const { res, size } = tex;
  const p = wpos.div(size).add(0.5).mul(res).sub(0.5).toVar();
  const p0 = p.floor().toVar();
  const f = p.sub(p0).toVar();
  const ci = (v: NF) => clamp(v, 0, res - 1).toInt();
  const x0 = ci(p0.x);
  const y0 = ci(p0.y);
  const x1 = ci(p0.x.add(1));
  const y1 = ci(p0.y.add(1));
  const v00 = textureLoad(tex.waterTex, ivec2(x0, y0)).x.toVar();
  const v10 = textureLoad(tex.waterTex, ivec2(x1, y0)).x.toVar();
  const v01 = textureLoad(tex.waterTex, ivec2(x0, y1)).x.toVar();
  const v11 = textureLoad(tex.waterTex, ivec2(x1, y1)).x.toVar();
  const big = max(max(v00, v10), max(v01, v11)).toVar();
  const fix = (v: NF) => v.greaterThan(NO_WATER).select(v, big);
  const a = fix(v00);
  const bv = fix(v10);
  const c = fix(v01);
  const d = fix(v11);
  const top = a.mul(f.x.oneMinus()).add(bv.mul(f.x));
  const bot = c.mul(f.x.oneMinus()).add(d.mul(f.x));
  return {
    y: top.mul(f.y.oneMinus()).add(bot.mul(f.y)),
    valid: big.greaterThan(NO_WATER).select(float(1), float(0)),
  };
}

export function createWaterSurface(tex: WorldTextures, env: EnvState): Mesh {
  const { res, size } = tex;
  const geo = new PlaneGeometry(size, size, GRID_SEGS, GRID_SEGS);
  geo.rotateX(-Math.PI / 2);

  const mat = new MeshStandardNodeMaterial();
  mat.transparent = true;
  mat.metalness = 0.02;
  mat.depthWrite = false;

  // --- 顶点:水面高度(无水顶点沉入地下 60 m,被地形遮住) ---
  const wpos = positionLocal.xz;
  const w = sampleWaterY(tex, wpos);
  const y = w.valid.greaterThan(0.5).select(w.y.add(0.02), float(-60));
  mat.positionNode = vec3(wpos.x, y, wpos.y);

  // --- 片元 ---
  const fw = positionWorld.xz;
  const uv = worldUv(fw, size);
  const fld = texture(tex.fieldsTex, uv).toVar(); // rg=flow b=profile a=lake

  const flow = fld.xy.mul(2).sub(1).toVar();
  const profile = fld.z.toVar();
  // 逐河流速:窄溪(剖面陡)快、宽河慢;湖面≈0
  const speed = profile.mul(0.9).add(0.25).mul(profile.greaterThan(0.02).select(1, 0.12));
  const t = env.time.mul(speed);

  // 双相 flowmap:两个错相平流样本按锯齿权重混合,消除平流漂移伪影
  const phase0 = fract(t);
  const phase1 = fract(t.add(0.5));
  const blend = phase0.mul(2).sub(1).abs();
  const rippleAt = (phase: NF, off: number): NV2 => {
    const p = fw.div(5.5).sub(flow.mul(phase.mul(2.4))).add(off);
    const n1 = fbm2(p, 3);
    const n2 = fbm2(p.add(vec2(0.31, 0.77)), 3);
    return vec2(n1, n2);
  };
  const r0 = rippleAt(phase0, 0);
  const r1 = rippleAt(phase1, 37.7);
  const ripple = mix(r0, r1, blend).mul(0.5).toVar();
  // 微涟漪(时间驱动,湖面也动)
  const micro1 = fbm2(fw.div(1.4).add(env.time.mul(0.18)), 2);
  const micro2 = fbm2(fw.div(1.4).add(vec2(9.1, 3.3)).sub(env.time.mul(0.15)), 2);
  const nrm = vec3(
    ripple.x.add(micro1.mul(0.35)).mul(0.32),
    1,
    ripple.y.add(micro2.mul(0.35)).mul(0.32),
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

  // 岸线泡沫 + 急流白沫
  const foamNoise = fbm2(fw.div(2.2).add(env.time.mul(0.35)), 3).mul(0.5).add(0.5);
  const shoreFoam = smoothstep(0.42, 0.06, depth).mul(foamNoise).mul(0.8);
  const rapidFoam = profile.mul(speed).mul(foamNoise).mul(0.55);
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
