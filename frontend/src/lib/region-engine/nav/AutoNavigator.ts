/**
 * 沿 RegionTour 弧长匀速循航。
 *
 * O 循环;S 到尽头反向。V/模式切换保持弧长进度,0.8 s 混合 walk↔fly 高度。
 */

import { Vector3 } from "three";
import type { WalkFlyRig } from "../camera/WalkFlyRig";
import type { SceneMode } from "../types";
import type { RegionTour } from "./types";

const WALK_SPEED = 4.6;
const FLY_SPEED = 20;
const BLEND_S = 0.8;
const LOOK_WALK = 16;
const LOOK_FLY = 42;
const WALK_EYE = 1.7;

const POS = new Vector3();
const LOOK = new Vector3();
const WALK_P = new Vector3();
const FLY_P = new Vector3();
const WALK_L = new Vector3();
const FLY_L = new Vector3();

function wrap(d: number, len: number): number {
  if (len <= 0) return 0;
  return ((d % len) + len) % len;
}

function sampleAt(
  pts: Vector3[],
  cumul: number[],
  length: number,
  dist: number,
  loop: boolean,
  out: Vector3,
): Vector3 {
  const n = pts.length;
  if (n === 0) return out.set(0, 0, 0);
  if (n === 1) return out.copy(pts[0]!);
  const lastC = cumul[n - 1] as number;
  const s = loop ? wrap(dist, length) : Math.min(Math.max(dist, 0), length);
  let lo = 0;
  let hi = n - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if ((cumul[mid] as number) <= s) lo = mid;
    else hi = mid;
  }
  if (s <= lastC) {
    const d0 = cumul[lo] as number;
    const d1 = cumul[Math.min(lo + 1, n - 1)] as number;
    const a = pts[lo]!;
    const b = pts[Math.min(lo + 1, n - 1)]!;
    const t = d1 - d0 > 1e-5 ? (s - d0) / (d1 - d0) : 0;
    return out.lerpVectors(a, b, t);
  }
  const a = pts[n - 1]!;
  const b = pts[0]!;
  const t = length - lastC > 1e-5 ? (s - lastC) / (length - lastC) : 0;
  return out.lerpVectors(a, b, t);
}

function yawPitch(
  from: Vector3,
  to: Vector3,
  fallback: { yaw: number; pitch: number },
): { yaw: number; pitch: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const h = Math.hypot(dx, dz);
  if (h < 0.35) return fallback;
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.min(0.32, Math.max(-0.52, Math.atan2(dy, h)));
  return { yaw, pitch };
}

export class AutoNavigator {
  active = false;
  private dist = 0;
  private dir = 1;
  private modeK = 1;
  private targetK = 1;
  private lastLook = { yaw: 0, pitch: -0.12 };
  private alignLook = false;

  constructor(readonly tour: RegionTour) {}

  start(mode: SceneMode, from: Vector3): void {
    this.active = true;
    this.targetK = mode === "fly" ? 1 : 0;
    this.modeK = this.targetK;
    this.dir = 1;
    this.dist = this.nearest(from);
    this.alignLook = true;
  }

  stop(): void {
    this.active = false;
  }

  setMode(mode: SceneMode): void {
    this.targetK = mode === "fly" ? 1 : 0;
  }

  /**
   * @param freeLook 第三人称:只跟位置,朝向留给鼠标拖动
   */
  update(dt: number, rig: WalkFlyRig, freeLook = false): void {
    if (!this.active) return;
    const loop = this.tour.kind === "o";
    const step = 1 / BLEND_S;
    if (this.modeK < this.targetK) this.modeK = Math.min(this.targetK, this.modeK + step * dt);
    else if (this.modeK > this.targetK) this.modeK = Math.max(this.targetK, this.modeK - step * dt);

    const speed = WALK_SPEED + (FLY_SPEED - WALK_SPEED) * this.modeK;
    this.dist += this.dir * speed * dt;
    if (loop) {
      this.dist = wrap(this.dist, this.tour.length);
    } else if (this.dist >= this.tour.length) {
      this.dist = this.tour.length;
      this.dir = -1;
    } else if (this.dist <= 0) {
      this.dist = 0;
      this.dir = 1;
    }

    sampleAt(this.tour.walk, this.tour.cumul, this.tour.length, this.dist, loop, WALK_P);
    sampleAt(this.tour.fly, this.tour.cumul, this.tour.length, this.dist, loop, FLY_P);
    POS.lerpVectors(WALK_P, FLY_P, this.modeK);

    const look = LOOK_WALK + (LOOK_FLY - LOOK_WALK) * this.modeK;
    const lookDist = this.dist + this.dir * look;
    sampleAt(this.tour.walk, this.tour.cumul, this.tour.length, lookDist, loop, WALK_L);
    sampleAt(this.tour.fly, this.tour.cumul, this.tour.length, lookDist, loop, FLY_L);
    LOOK.lerpVectors(WALK_L, FLY_L, this.modeK);

    if (freeLook) {
      let y = POS.y + rig.guidedLift;
      if (rig.groundProbe) {
        const g = rig.groundProbe(POS.x, POS.z);
        const floor = g.ground + 1.4;
        if (y < floor) y = floor;
      }
      if (this.alignLook) {
        this.alignLook = false;
        const { yaw, pitch } = yawPitch(POS, LOOK, this.lastLook);
        this.lastLook = { yaw, pitch };
        rig.setPose(POS.x, y, POS.z, yaw, pitch);
      } else {
        rig.setPosition(POS.x, y, POS.z);
      }
      return;
    }

    this.alignLook = false;
    let camY = POS.y;
    if (rig.groundProbe) {
      const g = rig.groundProbe(POS.x, POS.z);
      const walkCam = Math.max(g.ground, Number.isFinite(g.water) ? g.water : g.ground) + WALK_EYE;
      camY = walkCam + (FLY_P.y - walkCam) * this.modeK;
    } else {
      camY = WALK_P.y + WALK_EYE + (FLY_P.y - (WALK_P.y + WALK_EYE)) * this.modeK;
    }
    POS.y = camY;
    const { yaw, pitch } = yawPitch(POS, LOOK, this.lastLook);
    this.lastLook = { yaw, pitch };
    rig.setPose(POS.x, POS.y, POS.z, yaw, pitch);
  }

  private nearest(from: Vector3): number {
    const pts = this.modeK > 0.5 ? this.tour.fly : this.tour.walk;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const d = (p.x - from.x) ** 2 + (p.z - from.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = this.tour.cumul[i] as number;
      }
    }
    return best;
  }
}
