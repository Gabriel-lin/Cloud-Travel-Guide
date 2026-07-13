/**
 * 云层 kernel:Worley/Perlin 风格 fbm 密度场平面云 + 同源地面云影。
 *
 * 云密度与地面云影共用同一个 coverage kernel(相同的风平流偏移),
 * 保证云影与头顶云对位;weather 场随 windDir·time 整体平移,detail 以
 * 1.35× 速度漂移(翻腾感,非滑动贴图)。
 */

import { Mesh, PlaneGeometry } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  clamp,
  mix,
  positionWorld,
  smoothstep,
  vec2,
  vec3,
} from "three/tsl";
import { fbm2 } from "../gpu/noise";
import type { NF, NV2 } from "../gpu/tsl-types";
import type { EnvState } from "./env";

export const CLOUD_ALT = 1150;
const WIND_SPEED = 18; // m/s 云层平流

/** 云覆盖度 0..1(云层与地面云影共用) */
export function cloudCoverage(env: EnvState, wpos: NV2): NF {
  const drift = env.windDir.mul(env.time.mul(WIND_SPEED));
  const p = wpos.add(drift).toVar();
  const weather = fbm2(p.div(1450), 3).mul(0.5).add(0.5);
  const detailDrift = env.windDir.mul(env.time.mul(WIND_SPEED * 1.35));
  const detail = fbm2(wpos.add(detailDrift).div(340).add(vec2(7.3, 3.1)), 4)
    .mul(0.5)
    .add(0.5);
  const d = weather.mul(0.65).add(detail.mul(0.35));
  return smoothstep(0.52, 0.78, d).mul(0.9);
}

/** 地面云影因子(乘到地表颜色;夜间云影淡化) */
export function cloudShadowFactor(env: EnvState): (wpos: NV2) => NF {
  return (wpos: NV2) => {
    const cov = cloudCoverage(env, wpos);
    const k = cov.mul(env.nightK.oneMinus().mul(0.25).add(0.08));
    return clamp(k.oneMinus(), 0, 1);
  };
}

export function createCloudLayer(env: EnvState, size: number): Mesh {
  const geo = new PlaneGeometry(size * 6, size * 6, 1, 1);
  geo.rotateX(-Math.PI / 2);

  const mat = new MeshBasicNodeMaterial();
  mat.transparent = true;
  mat.depthWrite = false;
  mat.side = 2; // DoubleSide:云下仰视 + 飞行俯瞰
  mat.fog = false;

  const wpos = positionWorld.xz;
  const cov = cloudCoverage(env, wpos).toVar();
  // 云底阴影:密处更暗
  const dense = fbm2(
    wpos.add(env.windDir.mul(env.time.mul(WIND_SPEED))).div(620),
    3,
  )
    .mul(0.5)
    .add(0.5);
  const dayCol = mix(vec3(1.0, 1.0, 1.02), vec3(0.62, 0.66, 0.72), dense.mul(0.8));
  const nightCol = mix(vec3(0.09, 0.1, 0.14), vec3(0.03, 0.035, 0.05), dense);
  mat.colorNode = mix(dayCol, nightCol, env.nightK);
  mat.opacityNode = cov.mul(0.92);

  const mesh = new Mesh(geo, mat);
  mesh.position.y = CLOUD_ALT;
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return mesh;
}
