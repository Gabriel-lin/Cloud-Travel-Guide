/**
 * 天空 kernel:日间大气散射渐变 + 太阳盘/光晕;夜间星空 + 月亮;
 * nightK 平滑插值昼夜(简化 Hillaire:解析渐变代替 LUT,能量结构一致)。
 */

import { Mesh, SphereGeometry } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  clamp,
  float,
  fract,
  mix,
  normalize,
  positionLocal,
  pow,
  sin,
  smoothstep,
  vec3,
} from "three/tsl";
import type { NV3 } from "../gpu/tsl-types";
import type { EnvState } from "./env";

export const SKY_RADIUS = 9000;

export function createSkyDome(env: EnvState): Mesh {
  const geo = new SphereGeometry(SKY_RADIUS, 48, 24);
  const mat = new MeshBasicNodeMaterial();
  mat.side = 1; // BackSide
  mat.depthWrite = false;
  mat.fog = false;

  const dir = normalize(positionLocal).toVar();
  const sunDir = env.sunDir;
  const upness = clamp(dir.y, -0.08, 1).toVar();

  // --- 日间:天顶蓝 → 地平线暖白;瑞利式渐变 ---
  const zenith = vec3(0.2, 0.42, 0.78);
  const horizonDay = vec3(0.78, 0.85, 0.92);
  const dayGrad = mix(horizonDay, zenith, pow(clamp(upness, 0, 1), 0.42));
  // 太阳盘 + 光晕
  const cosSun = clamp(dir.dot(sunDir), 0, 1);
  const sunDisc = smoothstep(0.9994, 0.9999, cosSun).mul(vec3(9, 8, 6.5));
  const sunHalo = pow(cosSun, 32).mul(vec3(0.7, 0.55, 0.32));
  const daySky = dayGrad.add(sunDisc).add(sunHalo);

  // --- 夜间:深蓝渐变 + 星空 + 月亮 ---
  const nightGrad = mix(
    vec3(0.035, 0.05, 0.1),
    vec3(0.004, 0.007, 0.02),
    pow(clamp(upness, 0, 1), 0.5),
  );
  // 星:方向栅格哈希,亮度阈值 + 闪烁
  const grid = dir.xz.div(dir.y.abs().add(0.25)).mul(160).toVar();
  const cell = grid.floor();
  const starHash = fract(
    sin(cell.x.mul(127.1).add(cell.y.mul(311.7))).mul(43758.5453),
  ).toVar();
  const starLocal = fract(grid).sub(0.5).length();
  const twinkle = sin(env.time.mul(2.2).add(starHash.mul(43))).mul(0.3).add(0.7);
  const star = smoothstep(0.985, 0.999, starHash)
    .mul(smoothstep(0.18, 0.02, starLocal))
    .mul(twinkle)
    .mul(smoothstep(0.02, 0.25, dir.y));
  // 月亮(nightSun 方向)
  const moonDirV = env.sunDir; // 夜间 sunDir 已插值到月光方向
  const cosMoon = clamp(dir.dot(moonDirV), 0, 1);
  const moon = smoothstep(0.9995, 0.99985, cosMoon).mul(vec3(1.6, 1.65, 1.7));
  const moonHalo = pow(cosMoon, 64).mul(vec3(0.08, 0.09, 0.12));
  const nightSky: NV3 = nightGrad
    .add(vec3(star.mul(0.9), star.mul(0.92), star))
    .add(moon)
    .add(moonHalo);

  mat.colorNode = mix(daySky, nightSky, env.nightK);

  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

/** 地平线雾色(与天空渐变一致,供 scene.fog 使用) */
export function skyHorizonRgb(nightK: number): [number, number, number] {
  const day: [number, number, number] = [0.78, 0.85, 0.92];
  const night: [number, number, number] = [0.03, 0.045, 0.09];
  return [
    day[0] * (1 - nightK) + night[0] * nightK,
    day[1] * (1 - nightK) + night[1] * nightK,
    day[2] * (1 - nightK) + night[2] * nightK,
  ];
}

/** 供水面/材质引用的简化天空色(按反射向量) */
export function skyColorFor(env: EnvState, dir: NV3): NV3 {
  const up = clamp(dir.y, 0, 1);
  const day = mix(vec3(0.78, 0.85, 0.92), vec3(0.2, 0.42, 0.78), pow(up, 0.42));
  const night = mix(vec3(0.03, 0.045, 0.09), vec3(0.004, 0.007, 0.02), pow(up, 0.5));
  return mix(day, night, env.nightK).add(
    pow(clamp(dir.dot(env.sunDir), 0, 1), 48).mul(
      mix(vec3(0.8, 0.65, 0.4), vec3(0.1, 0.11, 0.13), env.nightK),
    ),
  );
}
