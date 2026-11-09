/**
 * 导览轨迹窄带:WebGPU MeshBasicNodeMaterial,昼夜插值、低亮度、不加色混合。
 */

import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  Vector3,
} from "three";
import { mix, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import type { NF, NV3 } from "../gpu/tsl-types";
import type { EnvState } from "../render/env";
import type { SceneMode } from "../types";
import type { RegionTour } from "./types";

export type PathRibbon = {
  group: Group;
  setVisible: (v: boolean) => void;
  setMode: (mode: SceneMode) => void;
  dispose: () => void;
};

function buildStrip(pts: Vector3[], width: number, yLift: number, closed: boolean): BufferGeometry | null {
  const n = pts.length;
  if (n < 2) return null;
  const count = closed ? n + 1 : n;
  const pos = new Float32Array(count * 2 * 3);
  const idx: number[] = [];
  const up = new Vector3(0, 1, 0);
  const tan = new Vector3();
  const side = new Vector3();
  const hw = width * 0.5;

  for (let i = 0; i < count; i++) {
    const p = pts[i % n]!;
    const prev = pts[(i + n - 1) % n]!;
    const next = pts[(i + 1) % n]!;
    if (!closed && i === 0) tan.set(next.x - p.x, 0, next.z - p.z);
    else if (!closed && i === n - 1) tan.set(p.x - prev.x, 0, p.z - prev.z);
    else tan.set(next.x - prev.x, 0, next.z - prev.z);
    if (tan.lengthSq() < 1e-8) tan.set(1, 0, 0);
    tan.normalize();
    side.crossVectors(up, tan);
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
    else side.normalize();
    const y = p.y + yLift;
    const o = i * 6;
    pos[o] = p.x - side.x * hw;
    pos[o + 1] = y;
    pos[o + 2] = p.z - side.z * hw;
    pos[o + 3] = p.x + side.x * hw;
    pos[o + 4] = y;
    pos[o + 5] = p.z + side.z * hw;
    if (i < count - 1) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function makeMaterial(env: EnvState): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial();
  mat.transparent = true;
  mat.depthWrite = false;
  mat.depthTest = true;
  mat.side = DoubleSide;
  mat.fog = false;
  mat.toneMapped = false;
  // 白天沙金偏暖灰;夜晚青灰 + 极弱自发光感(抬色,不加色混合)
  const day = vec3(0.4, 0.34, 0.24);
  const night = vec3(0.22, 0.28, 0.32);
  const glow = night.mul(env.nightK).mul(0.12);
  mat.colorNode = mix(day, night, env.nightK).add(glow) as unknown as NV3;
  mat.opacityNode = env.nightK.mul(0.08).add(0.4) as unknown as NF;
  return mat;
}

function makeMesh(geo: BufferGeometry, mat: MeshBasicNodeMaterial): Mesh {
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 8;
  return mesh;
}

export function createPathRibbon(tour: RegionTour, env: EnvState): PathRibbon {
  const group = new Group();
  group.name = "tour-path";
  group.visible = false;
  const closed = tour.kind === "o";
  const mat = makeMaterial(env);
  const walkGeo = buildStrip(tour.walk, 2.4, 0.12, closed);
  const flyGeo = buildStrip(tour.fly, 3.0, 0.05, closed);
  const walkMesh = walkGeo ? makeMesh(walkGeo, mat) : null;
  const flyMesh = flyGeo ? makeMesh(flyGeo, mat) : null;
  if (walkMesh) group.add(walkMesh);
  if (flyMesh) {
    flyMesh.visible = false;
    group.add(flyMesh);
  }

  return {
    group,
    setVisible(v) {
      group.visible = v;
    },
    setMode(mode) {
      if (walkMesh) walkMesh.visible = mode === "walk";
      if (flyMesh) flyMesh.visible = mode === "fly";
    },
    dispose() {
      walkGeo?.dispose();
      flyGeo?.dispose();
      mat.dispose();
    },
  };
}
