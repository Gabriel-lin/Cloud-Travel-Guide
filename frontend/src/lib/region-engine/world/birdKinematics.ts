/**
 * 鸟群中心的 CPU 运动学:与 BirdFlocks.pathEval 顶点路径同构
 * (椭圆 / Lissajous / 伏击冲刺),供空间音频锚点每帧取样。
 */

import type { BirdSpeciesId, Habitat } from "./birdSpecies";

export type BirdFlockKinematics = {
  ox: number;
  oy: number;
  oz: number;
  rx: number;
  rz: number;
  angSpeed: number;
  phase: number;
  behavior: 0 | 1 | 2;
  aux0: number;
  aux1: number;
  bobAmp: number;
  rotC: number;
  rotS: number;
};

export type BirdFlockEmitter = {
  id: number;
  speciesId: BirdSpeciesId;
  habitat: Habitat;
  count: number;
  nocturnal: boolean;
  kinematics: BirdFlockKinematics;
};

export type Vec3 = { x: number; y: number; z: number };

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

function hash01(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export function evalFlockCenter(k: BirdFlockKinematics, t: number, out: Vec3): Vec3 {
  const ang = t * k.angSpeed + k.phase * Math.PI * 2;
  const ellX = Math.cos(ang) * k.rx;
  const ellZ = Math.sin(ang) * k.rz;
  const ang2 = t * k.angSpeed * k.aux0 + k.phase * 11.31;
  const lisX = Math.sin(ang) * k.rx;
  const lisZ = Math.sin(ang2) * k.rz;

  const per = Math.max(k.aux0, 2);
  const cyc = Math.floor(t / per);
  const ph = t / per - cyc;
  const pulse = smoothstep(0.02, 0.12, ph) * smoothstep(0.7, 0.22, ph);
  const idleX = Math.cos(t * 0.42 + k.phase * 6.28) * k.rx * 0.32;
  const idleZ = Math.sin(t * 0.37 + k.phase * 9.4) * k.rz * 0.32;
  const dirA = hash01(cyc, k.phase * 97) * Math.PI * 2;
  const dartX = idleX + Math.cos(dirA) * k.aux1 * pulse;
  const dartZ = idleZ + Math.sin(dirA) * k.aux1 * pulse;

  const bid = k.behavior;
  const w0 = 1 - Math.min(Math.abs(bid), 1);
  const w1 = 1 - Math.min(Math.abs(bid - 1), 1);
  const w2 = 1 - Math.min(Math.abs(bid - 2), 1);
  const xzX = ellX * w0 + lisX * w1 + dartX * w2;
  const xzZ = ellZ * w0 + lisZ * w1 + dartZ * w2;
  out.x = k.ox + xzX * k.rotC - xzZ * k.rotS;
  out.y =
    k.oy +
    Math.sin(t * 0.38 + k.phase * Math.PI * 2) * k.bobAmp +
    w2 * pulse * k.aux1 * 0.35;
  out.z = k.oz + xzX * k.rotS + xzZ * k.rotC;
  return out;
}
