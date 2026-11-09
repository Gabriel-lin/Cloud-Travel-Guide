import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  type Object3D,
} from "three";

import { evalFlockCenter } from "../world/birdKinematics";
import type { BirdFlockEmitter } from "../world/birdKinematics";
import type { FishSchoolAnchor } from "../world/FishSchools";

import { catalogFirefly, catalogForBird, catalogForFish } from "./catalog";
import type { PickProxyData } from "./types";
import { isPickProxyData } from "./types";

const BIRD_BEAM_H = 110;
const FISH_BEAM_H = 80;
const FIREFLY_BEAM_H = 52;
const FIREFLY_BEAM_LIFT = 4.6;

type BirdProxy = {
  sphere: Mesh;
  /** 跟群心走的光柱;烘焙信标柱另留在栖息点 */
  follow: Mesh | null;
  emitter: BirdFlockEmitter;
};

export function proxyDataOf(obj: Object3D): PickProxyData | null {
  let cur: Object3D | null = obj;
  while (cur) {
    if (isPickProxyData(cur.userData)) return cur.userData;
    cur = cur.parent;
  }
  return null;
}

/**
 * 鸟/鱼/萤火虫的 CPU 代理。不可见,供 Raycaster 使用。
 * 鸟:栖息点光柱对齐烘焙信标;另一根光柱和群心球跟随 evalFlockCenter。
 */
export class ProxyVolumes {
  readonly group = new Group();
  private readonly birds: BirdProxy[] = [];
  private readonly center = { x: 0, y: 0, z: 0 };
  private readonly cylBird = new CylinderGeometry(2.6, 2.6, BIRD_BEAM_H, 8);
  private readonly cylFish = new CylinderGeometry(2.4, 2.4, FISH_BEAM_H, 8);
  private readonly cylFire = new CylinderGeometry(1.6, 1.6, FIREFLY_BEAM_H, 8);
  private readonly sphereBird = new SphereGeometry(10, 10, 8);
  private readonly sphereFish = new SphereGeometry(8, 10, 8);
  private readonly sphereFly = new SphereGeometry(8, 8, 6);
  private readonly mat = new MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    colorWrite: false,
  });

  constructor(opts: {
    birds: readonly BirdFlockEmitter[];
    fish: readonly FishSchoolAnchor[];
    fireflySpots: Float32Array;
  }) {
    this.group.name = "pick-proxies";
    this.addBirds(opts.birds);
    this.addFish(opts.fish);
    this.addFireflies(opts.fireflySpots);
  }

  update(time: number): void {
    for (const bird of this.birds) {
      evalFlockCenter(bird.emitter.kinematics, time, this.center);
      bird.sphere.position.set(this.center.x, this.center.y, this.center.z);
      if (bird.follow) {
        const y0 = bird.emitter.groundY ?? bird.emitter.kinematics.oy;
        bird.follow.position.set(this.center.x, y0 + BIRD_BEAM_H * 0.5, this.center.z);
      }
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    this.cylBird.dispose();
    this.cylFish.dispose();
    this.cylFire.dispose();
    this.sphereBird.dispose();
    this.sphereFish.dispose();
    this.sphereFly.dispose();
    this.mat.dispose();
  }

  private addHidden(geo: CylinderGeometry | SphereGeometry, data: PickProxyData, x: number, y: number, z: number): Mesh {
    const mesh = new Mesh(geo, this.mat);
    mesh.visible = false;
    mesh.position.set(x, y, z);
    mesh.userData = data;
    this.group.add(mesh);
    return mesh;
  }

  private addBirds(birds: readonly BirdFlockEmitter[]): void {
    for (const em of birds) {
      const entry = catalogForBird(em.speciesId);
      if (!entry) continue;
      const data: PickProxyData = {
        pick: true,
        catalogId: entry.id,
        kind: "bird",
        titleKey: entry.titleKey,
        model: entry.model,
        instanceKey: `bird:${em.id}`,
      };
      let follow: Mesh | null = null;
      if (em.beacon) {
        const y0 = em.groundY ?? em.kinematics.oy;
        const y = y0 + BIRD_BEAM_H * 0.5;
        this.addHidden(this.cylBird, data, em.kinematics.ox, y, em.kinematics.oz);
        follow = this.addHidden(this.cylBird, data, em.kinematics.ox, y, em.kinematics.oz);
      }
      const sphere = this.addHidden(
        this.sphereBird,
        data,
        em.kinematics.ox,
        em.kinematics.oy,
        em.kinematics.oz,
      );
      this.birds.push({ sphere, follow, emitter: em });
    }
  }

  private addFish(schools: readonly FishSchoolAnchor[]): void {
    for (let i = 0; i < schools.length; i++) {
      const sc = schools[i] as FishSchoolAnchor;
      const entry = catalogForFish(sc.speciesId);
      if (!entry) continue;
      const data: PickProxyData = {
        pick: true,
        catalogId: entry.id,
        kind: "fish",
        titleKey: entry.titleKey,
        model: entry.model,
        instanceKey: `fish:${sc.speciesId}:${i}`,
      };
      if (sc.beacon) {
        this.addHidden(this.cylFish, data, sc.x, sc.waterY + FISH_BEAM_H * 0.5, sc.z);
      }
      this.addHidden(this.sphereFish, data, sc.x, sc.y, sc.z);
    }
  }

  private addFireflies(spots: Float32Array): void {
    const entry = catalogFirefly();
    if (!entry) return;
    const n = Math.floor(spots.length / 4);
    for (let i = 0; i < n; i++) {
      const x = spots[i * 4] as number;
      const y = spots[i * 4 + 1] as number;
      const z = spots[i * 4 + 2] as number;
      const data: PickProxyData = {
        pick: true,
        catalogId: entry.id,
        kind: "firefly",
        titleKey: entry.titleKey,
        model: entry.model,
        instanceKey: `firefly:${i}`,
      };
      this.addHidden(this.cylFire, data, x, y + FIREFLY_BEAM_LIFT + FIREFLY_BEAM_H * 0.5, z);
      this.addHidden(this.sphereFly, data, x, y + 1.4, z);
    }
  }
}
