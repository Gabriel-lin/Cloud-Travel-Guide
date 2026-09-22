import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
} from "three";

import type { GroundProbe } from "../camera/WalkFlyRig";

import type { PickableModel, PickProxyData } from "./types";

/** 站点配置投影到世界 xz 之后的地标。 */
export type WorldLandmark = {
  id: string;
  titleKey: string;
  x: number;
  z: number;
  model?: PickableModel;
};

export type GeoLandmark = {
  id: string;
  titleKey: string;
  coord: { lat: number; lon: number };
  model?: PickableModel;
};

export function projectLandmarks(
  items: readonly GeoLandmark[],
  toLocal: (lat: number, lon: number) => readonly [number, number],
): WorldLandmark[] {
  return items.map((lm) => {
    const [x, z] = toLocal(lm.coord.lat, lm.coord.lon);
    return { id: lm.id, titleKey: lm.titleKey, x, z, model: lm.model };
  });
}

const MARKER_H = 36;

/**
 * 地标命中柱。金色标记默认可见,方便点选;关掉 showMarkers 只留不可见碰撞体。
 */
export class LandmarkSet {
  readonly group = new Group();
  private readonly hitGeo = new CylinderGeometry(6, 6, MARKER_H, 10);
  private readonly markerGeo = new CylinderGeometry(0.45, 0.7, MARKER_H, 10);
  private readonly hitMat = new MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    colorWrite: false,
  });
  private readonly markerMat = new MeshBasicMaterial({
    color: 0xfbbf24,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });

  constructor(
    private readonly groundProbe: GroundProbe,
    private readonly showMarkers = true,
  ) {
    this.group.name = "pick-landmarks";
  }

  set(items: readonly WorldLandmark[]): void {
    this.clearMeshes();
    for (const lm of items) {
      const g = this.groundProbe(lm.x, lm.z);
      const y0 = Math.max(g.ground, Number.isFinite(g.water) ? g.water : g.ground);
      const data: PickProxyData = {
        pick: true,
        catalogId: `landmark:${lm.id}`,
        kind: "landmark",
        titleKey: lm.titleKey,
        model: lm.model,
        instanceKey: `landmark:${lm.id}`,
      };
      const y = y0 + MARKER_H * 0.5;
      if (this.showMarkers) {
        const marker = new Mesh(this.markerGeo, this.markerMat);
        marker.position.set(lm.x, y, lm.z);
        marker.userData = data;
        marker.castShadow = false;
        marker.receiveShadow = false;
        this.group.add(marker);
      }
      const hit = new Mesh(this.hitGeo, this.hitMat);
      hit.position.set(lm.x, y, lm.z);
      hit.visible = false;
      hit.userData = data;
      this.group.add(hit);
    }
  }

  dispose(): void {
    this.clearMeshes();
    this.group.removeFromParent();
    this.hitGeo.dispose();
    this.markerGeo.dispose();
    this.hitMat.dispose();
    this.markerMat.dispose();
  }

  private clearMeshes(): void {
    const children = this.group.children.slice();
    for (const child of children) this.group.remove(child as Object3D);
  }
}
