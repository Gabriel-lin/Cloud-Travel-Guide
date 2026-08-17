/**
 * 相机 rig(移植 LAAS `FlyCamera.ts`):
 *
 * WALK 模式 —— 贴地 RPG 探索:重力(22 m/s²,游戏手感)、Space 跳跃(缓冲输入)、
 * Shift 疾跑、步频头部摆动/落地下沉弹簧/疾跑 FOV;
 * FLY 模式 —— 自由飞行:E 上升 / Q 下降、滚轮调速、Shift 加速。
 * `V` 切换两种模式;指针锁定鼠标视角(带 Chromium 解锁冷却处理)。
 *
 * 相机运动特效叠加在独立的逻辑位置(basePos)之上,getPose() 永远返回干净位姿。
 */

import type { PerspectiveCamera } from "three";
import { Vector3 } from "three";
import type { SceneMode } from "../types";

const FORWARD = new Vector3();
const RIGHT = new Vector3();
const MOVE = new Vector3();

/** (x, z) 处地形/水面高度 —— 由世界场景安装 */
export type GroundProbe = (x: number, z: number) => { ground: number; water: number };

// ---- walk 手感参数(与 LAAS 一致) -----------------------------------------
const EYE_HEIGHT = 1.7;
const WALK_SPEED = 4.6; // m/s
const SPRINT_MULT = 2.0;
const GRAVITY = 22;
const JUMP_V0 = 7.0; // 跳跃顶点 ~1.1 m
const STEP_DOWN = 0.55; // 下坡贴地范围(米)
const GROUND_ACCEL = 10;
const AIR_ACCEL = 2.5;
// 特效
const STRIDE_RATE = 1.7;
const BOB_Y_WALK = 0.026;
const BOB_Y_SPRINT_ADD = 0.018;
const BOB_LATERAL = 0.55;
const BOB_ROLL = 0.0032;
const SPRINT_FOV_ADD = 6;
const DIP_K = 150;
const DIP_C = 18;
// fly 软碰撞(水下允许贴近河床)
const FLY_GROUND_CLEAR = 1.4;
const FLY_BED_CLEAR = 0.32;
const WALK_DIVE_CLEAR = 0.18;
// 水下:阻尼 + Space 上浮
const WATER_DRAG = 3.0;
const SWIM_UP_ACCEL = 14;
const SWIM_UP_MAX = 2.8;
// Chromium 在 ESC 解锁后有 ~1.25 s 冷却,期间的 requestPointerLock 会被拒绝
const LOCK_COOLDOWN_MS = 1300;
const LOCK_INTENT_MS = 3500;

export class WalkFlyRig {
  readonly camera: PerspectiveCamera;
  yaw = 0;
  pitch = 0;
  /** fly 基础速度 m/s,滚轮缩放 */
  speed = 24;
  enabled = true;
  groundProbe: GroundProbe | null = null;
  /** 模式切换回调(V 键 → 工具栏同步) */
  onModeChange: ((mode: SceneMode) => void) | null = null;

  private modeV: SceneMode = "fly";
  private keys = new Set<string>();
  private vel = new Vector3();
  private locked = false;
  private basePos = new Vector3();
  private velY = 0;
  private grounded = false;
  private stridePhase = 0;
  private bobK = 0;
  private dipY = 0;
  private dipV = 0;
  private fovKick = 0;
  private baseFov: number;
  private jumpAt = -1;
  private disposers: (() => void)[] = [];

  constructor(camera: PerspectiveCamera, dom: HTMLElement) {
    this.camera = camera;
    this.baseFov = camera.fov;
    this.basePos.copy(camera.position);

    // ---- 指针锁定(冷却感知) ----
    let unlockAt = -1e9;
    let lockIntentAt = -1e9;
    let relockTimer: number | undefined;
    const clearRelock = (): void => {
      if (relockTimer !== undefined) {
        window.clearTimeout(relockTimer);
        relockTimer = undefined;
      }
    };
    const retryLock = (delayMs: number): void => {
      if (performance.now() - lockIntentAt > LOCK_INTENT_MS) return;
      if (relockTimer !== undefined) return;
      relockTimer = window.setTimeout(() => {
        relockTimer = undefined;
        acquireLock();
      }, delayMs);
    };
    const acquireLock = (): void => {
      if (!this.enabled || this.locked) return;
      clearRelock();
      const wait = unlockAt + LOCK_COOLDOWN_MS - performance.now();
      if (wait > 0) {
        relockTimer = window.setTimeout(() => {
          relockTimer = undefined;
          acquireLock();
        }, wait + 60);
        return;
      }
      let p: Promise<void> | undefined;
      try {
        p = dom.requestPointerLock() as unknown as Promise<void> | undefined;
      } catch {
        retryLock(350);
        return;
      }
      if (p !== undefined && typeof p.catch === "function") {
        p.catch(() => retryLock(350));
      }
    };
    const onClick = (): void => {
      if (!this.enabled || this.locked) return;
      lockIntentAt = performance.now();
      acquireLock();
    };
    const onLockChange = (): void => {
      const was = this.locked;
      this.locked = document.pointerLockElement === dom;
      if (was && !this.locked) unlockAt = performance.now();
      if (this.locked) clearRelock();
    };
    const onLockError = (): void => {
      retryLock(Math.max(unlockAt + LOCK_COOLDOWN_MS - performance.now() + 60, 300));
    };
    const onMouseMove = (e: MouseEvent): void => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch -= e.movementY * 0.0022;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.code === "KeyV" && this.enabled) {
        this.setMode(this.modeV === "walk" ? "fly" : "walk");
        this.onModeChange?.(this.modeV);
      }
      if (e.code === "Space" && !e.repeat) this.jumpAt = performance.now();
      this.keys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      this.keys.delete(e.code);
    };
    const onBlur = (): void => this.keys.clear();
    const onWheel = (e: WheelEvent): void => {
      if (this.modeV !== "fly" || !this.locked) return;
      e.preventDefault();
      this.speed *= Math.pow(1.15, -Math.sign(e.deltaY));
      this.speed = Math.min(2000, Math.max(0.5, this.speed));
    };

    dom.addEventListener("click", onClick);
    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("pointerlockerror", onLockError);
    document.addEventListener("mousemove", onMouseMove);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    dom.addEventListener("wheel", onWheel, { passive: false });
    this.disposers.push(() => {
      clearRelock();
      dom.removeEventListener("click", onClick);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("pointerlockerror", onLockError);
      document.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      dom.removeEventListener("wheel", onWheel);
      if (document.pointerLockElement === dom) document.exitPointerLock();
    });
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
  }

  get mode(): SceneMode {
    return this.modeV;
  }

  /** 切换 walk/fly:进 walk 吸附到脚下地形;离开 walk 剥离特效偏移 */
  setMode(mode: SceneMode): void {
    if (mode === this.modeV) return;
    if (mode === "walk") {
      if (!this.groundProbe) return;
      this.basePos.copy(this.camera.position);
      const g = this.groundProbe(this.basePos.x, this.basePos.z);
      this.basePos.y = g.ground + EYE_HEIGHT;
      this.velY = 0;
      this.vel.set(0, 0, 0);
      this.grounded = true;
    } else {
      this.camera.position.copy(this.basePos);
      this.resetEffects();
    }
    this.modeV = mode;
    this.applyRotation(0);
    this.camera.updateMatrixWorld();
  }

  setPose(x: number, y: number, z: number, yaw: number, pitch: number): void {
    this.camera.position.set(x, y, z);
    this.basePos.copy(this.camera.position);
    this.yaw = yaw;
    this.pitch = pitch;
    this.applyRotation(0);
    this.camera.updateMatrixWorld();
  }

  private resetEffects(): void {
    this.stridePhase = 0;
    this.bobK = 0;
    this.dipY = 0;
    this.dipV = 0;
    this.fovKick = 0;
    if (this.camera.fov !== this.baseFov) {
      this.camera.fov = this.baseFov;
      this.camera.updateProjectionMatrix();
    }
  }

  private applyRotation(roll: number): void {
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
    if (roll !== 0) this.camera.rotateZ(roll);
  }

  update(dt: number): void {
    if (!this.enabled) return;
    if (this.modeV === "walk") this.updateWalk(dt);
    else this.updateFly(dt);
  }

  private updateFly(dt: number): void {
    this.applyRotation(0);

    FORWARD.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    RIGHT.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    MOVE.set(0, 0, 0);
    if (this.keys.has("KeyW")) MOVE.add(FORWARD);
    if (this.keys.has("KeyS")) MOVE.sub(FORWARD);
    if (this.keys.has("KeyD")) MOVE.add(RIGHT);
    if (this.keys.has("KeyA")) MOVE.sub(RIGHT);
    if (this.keys.has("KeyE")) MOVE.y += 1;
    if (this.keys.has("KeyQ")) MOVE.y -= 1;
    let target = 0;
    if (MOVE.lengthSq() > 0) {
      MOVE.normalize();
      target = this.speed;
      if (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")) target *= 6;
      if (this.keys.has("AltLeft")) target *= 0.15;
    }
    const damp = 1 - Math.exp(-dt * 9);
    this.vel.lerp(MOVE.multiplyScalar(target), damp);
    this.camera.position.addScaledVector(this.vel, dt);

    // 有水的格子允许降到河床附近,否则 1.4 m 离地间隙会把相机卡在浅溪水面之上
    if (this.groundProbe) {
      const c = this.camera.position;
      const g = this.groundProbe(c.x, c.z);
      const wet = Number.isFinite(g.water) && g.water > g.ground + 0.05;
      const clear = wet ? FLY_BED_CLEAR : FLY_GROUND_CLEAR;
      const floor = g.ground + clear;
      if (c.y < floor) c.y = floor;
    }
    this.basePos.copy(this.camera.position);
    this.camera.updateMatrixWorld();
  }

  private updateWalk(dt: number): void {
    const probe = this.groundProbe;
    if (!probe) {
      this.setMode("fly");
      return;
    }

    // ---- 水平期望速度(仅 yaw 平面,俯仰不影响步态) ----
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    FORWARD.set(-sinY, 0, -cosY);
    RIGHT.set(cosY, 0, -sinY);
    MOVE.set(0, 0, 0);
    if (this.keys.has("KeyW")) MOVE.add(FORWARD);
    if (this.keys.has("KeyS")) MOVE.sub(FORWARD);
    if (this.keys.has("KeyD")) MOVE.add(RIGHT);
    if (this.keys.has("KeyA")) MOVE.sub(RIGHT);
    const sprinting =
      (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")) && MOVE.lengthSq() > 0;
    let target = 0;
    if (MOVE.lengthSq() > 0) {
      MOVE.normalize();
      target = WALK_SPEED * (sprinting ? SPRINT_MULT : 1);
      if (this.keys.has("AltLeft")) target *= 0.35;
    }
    const accel = this.grounded ? GROUND_ACCEL : AIR_ACCEL;
    const damp = 1 - Math.exp(-dt * accel);
    MOVE.multiplyScalar(target);
    this.vel.x += (MOVE.x - this.vel.x) * damp;
    this.vel.z += (MOVE.z - this.vel.z) * damp;
    this.basePos.x += this.vel.x * dt;
    this.basePos.z += this.vel.z * dt;

    const g = probe(this.basePos.x, this.basePos.z);
    const wet = Number.isFinite(g.water) && g.water > g.ground + 0.05;

    // ---- 垂直:重力、跳跃(按住或 150 ms 缓冲)、贴地 ----
    const jumpBuffered = this.jumpAt >= 0 && performance.now() - this.jumpAt < 150;
    // 水域内 Space 改为上浮,不跳出水面
    if (!wet && this.grounded && (this.keys.has("Space") || jumpBuffered)) {
      this.velY = JUMP_V0;
      this.grounded = false;
      this.jumpAt = -1;
    }
    // velocity-Verlet 半步:任意 dt 下跳跃弧线精确弹道
    this.basePos.y += (this.velY - GRAVITY * dt * 0.5) * dt;
    this.velY -= GRAVITY * dt;

    // 浅溪/浅湖:眼睛降到水面以下;深水仍用 1.7 m 但夹在河床与水面之间
    const eyeFloor = wet
      ? Math.max(
          g.ground + WALK_DIVE_CLEAR,
          Math.min(g.ground + EYE_HEIGHT, g.water - 0.08),
        )
      : g.ground + EYE_HEIGHT;
    if (this.basePos.y <= eyeFloor) {
      if (!this.grounded && this.velY < -3) {
        this.dipV -= Math.min(Math.abs(this.velY) * 0.035, 0.2) * 9;
      }
      this.basePos.y = eyeFloor;
      this.velY = 0;
      this.grounded = true;
    } else if (this.grounded && this.velY <= 0 && this.basePos.y - eyeFloor < STEP_DOWN) {
      // 下坡贴地(无微腾空抖动)
      this.basePos.y = eyeFloor;
      this.velY = 0;
    } else if (this.basePos.y - eyeFloor > 0.02) {
      this.grounded = false;
    }
    // 水下:阻尼下沉 + Space 上浮(可以潜入河湖看河床/水草/鱼群)
    if (this.basePos.y < g.water - 0.1) {
      this.velY *= Math.exp(-dt * WATER_DRAG);
      if (this.keys.has("Space")) {
        this.velY = Math.min(this.velY + SWIM_UP_ACCEL * dt, SWIM_UP_MAX);
        this.grounded = false;
      }
    }

    // ---- 相机运动特效 ----
    const speedH = Math.hypot(this.vel.x, this.vel.z);
    const speedK = Math.min(speedH / WALK_SPEED, SPRINT_MULT);
    const bobTarget = this.grounded ? Math.min(speedK, 1.3) : 0;
    this.bobK += (bobTarget - this.bobK) * (1 - Math.exp(-dt * 8));
    if (this.grounded && speedH > 0.3) {
      const rate = STRIDE_RATE * WALK_SPEED * (0.55 + 0.45 * Math.min(speedK, 2));
      this.stridePhase += rate * dt;
    }
    const ampY =
      (BOB_Y_WALK + BOB_Y_SPRINT_ADD * Math.max(Math.min(speedK - 1, 1), 0)) * this.bobK;
    const bobY = Math.sin(this.stridePhase * 2) * ampY;
    const bobX = Math.sin(this.stridePhase) * ampY * BOB_LATERAL;
    const roll = Math.sin(this.stridePhase) * BOB_ROLL * this.bobK;
    this.dipV += (-DIP_K * this.dipY - DIP_C * this.dipV) * dt;
    this.dipY += this.dipV * dt;
    const fovTarget =
      sprinting && this.grounded && speedH > WALK_SPEED * 1.15 ? SPRINT_FOV_ADD : 0;
    this.fovKick += (fovTarget - this.fovKick) * (1 - Math.exp(-dt * 6));
    const fov = this.baseFov + this.fovKick;
    if (Math.abs(this.camera.fov - fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    // 合成:相机 = 逻辑位姿 + 特效偏移
    this.applyRotation(roll);
    RIGHT.set(cosY, 0, -sinY);
    this.camera.position
      .copy(this.basePos)
      .addScaledVector(RIGHT, bobX)
      .add(MOVE.set(0, bobY + this.dipY, 0));
    this.camera.updateMatrixWorld();
  }
}
