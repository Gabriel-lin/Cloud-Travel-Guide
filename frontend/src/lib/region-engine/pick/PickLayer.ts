/**
 * 场景拾取:GPU 实例打不到射线,因此用 CPU 代理 + 一次植被行进。
 * 代理、地标、植被查询分文件,这里只编排命中顺序。
 */

import { Group, PerspectiveCamera, Raycaster, Vector2 } from "three";

import type { GroundProbe } from "../camera/WalkFlyRig";
import type { WorldFields } from "../types";
import type { ScatterResult } from "../veg/scatter";
import type { BirdFlockEmitter } from "../world/birdKinematics";
import type { FishSchoolAnchor } from "../world/FishSchools";

import { LandmarkSet, type WorldLandmark } from "./landmarks";
import { ProxyVolumes, proxyDataOf } from "./proxyVolumes";
import type { PickedEntity, PickProxyData } from "./types";
import { queryVegetation } from "./vegetationQuery";

export type { WorldLandmark } from "./landmarks";
export { projectLandmarks } from "./landmarks";

type PickLayerOpts = {
  fields: WorldFields;
  scatter: ScatterResult;
  birds: readonly BirdFlockEmitter[];
  fish: readonly FishSchoolAnchor[];
  fireflySpots: Float32Array;
  groundProbe: GroundProbe;
  /** 金色地标柱。默认开,方便点选;关掉则只留不可见碰撞体。 */
  showLandmarkMarkers?: boolean;
};

function toPicked(data: PickProxyData): PickedEntity {
  return {
    catalogId: data.catalogId,
    kind: data.kind,
    titleKey: data.titleKey,
    model: data.model,
    instanceKey: data.instanceKey,
  };
}

export class PickLayer {
  readonly group = new Group();
  private readonly proxies: ProxyVolumes;
  private readonly landmarks: LandmarkSet;
  private readonly raycaster = new Raycaster();
  private readonly fields: WorldFields;
  private readonly scatter: ScatterResult;
  private readonly groundProbe: GroundProbe;
  private nightK = 0;

  constructor(opts: PickLayerOpts) {
    this.fields = opts.fields;
    this.scatter = opts.scatter;
    this.groundProbe = opts.groundProbe;
    this.group.name = "pick-layer";
    this.proxies = new ProxyVolumes({
      birds: opts.birds,
      fish: opts.fish,
      fireflySpots: opts.fireflySpots,
    });
    this.landmarks = new LandmarkSet(opts.groundProbe, opts.showLandmarkMarkers ?? true);
    this.group.add(this.proxies.group);
    this.group.add(this.landmarks.group);
  }

  setLandmarks(items: readonly WorldLandmark[]): void {
    this.landmarks.set(items);
  }

  update(time: number, nightK: number): void {
    this.nightK = nightK;
    this.proxies.update(time);
  }

  pick(camera: PerspectiveCamera, ndc: Vector2): PickedEntity | null {
    this.raycaster.setFromCamera(ndc, camera);
    const hits = this.raycaster.intersectObject(this.group, true);
    for (const hit of hits) {
      const data = proxyDataOf(hit.object);
      if (!data) continue;
      if (data.kind === "firefly" && this.nightK < 0.12) continue;
      return toPicked(data);
    }
    return queryVegetation({
      origin: this.raycaster.ray.origin,
      dir: this.raycaster.ray.direction,
      fields: this.fields,
      scatter: this.scatter,
      groundProbe: this.groundProbe,
    });
  }

  dispose(): void {
    this.group.removeFromParent();
    this.proxies.dispose();
    this.landmarks.dispose();
  }
}
