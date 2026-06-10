import type * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";

import { AbstractNavigationController } from "./AbstractNavigationController";
import type {
  FrameOptions,
  HeightSampler,
  NavigationControllerOptions,
} from "./types";

/** 第一人称导航控制器配置。 */
export interface FirstPersonNavigationControllerOptions
  extends NavigationControllerOptions {
  /** 移动速度(世界单位/秒)。默认 20。 */
  moveSpeed?: number;
  /** 冲刺(按住 Shift)倍率。默认 2.5。 */
  sprintMultiplier?: number;
  /**
   * 地表高度采样器(通常来自 TerrainBuildResult.getHeightAt)。
   * 提供后进入"贴地行走"模式:相机高度始终 = 地面 + eyeHeight。
   */
  heightSampler?: HeightSampler;
  /** 视点高度(行走模式)。默认 1.7。 */
  eyeHeight?: number;
  /** 是否允许自由飞行(无 heightSampler 时默认启用)。 */
  enableFly?: boolean;
}

const KEY_BINDINGS = {
  forward: new Set(["KeyW", "ArrowUp"]),
  backward: new Set(["KeyS", "ArrowDown"]),
  left: new Set(["KeyA", "ArrowLeft"]),
  right: new Set(["KeyD", "ArrowRight"]),
  up: new Set(["Space"]),
  down: new Set(["KeyC"]),
  sprint: new Set(["ShiftLeft", "ShiftRight"]),
} as const;

/**
 * 第一人称漫游导航控制器。
 *
 * 基于 three.js {@link PointerLockControls}(鼠标转视角)+ WASD 键盘移动,
 * 适合"走进场景、沉浸式游览"的导览体验。
 * 提供 `heightSampler` 时自动贴合地形行走,否则为自由飞行。
 *
 * 注意:指针锁定需用户手势触发——默认在点击 canvas 时自动 `lock()`。
 */
export class FirstPersonNavigationController extends AbstractNavigationController {
  readonly name = "first-person";

  private readonly controls: PointerLockControls;
  private readonly moveSpeed: number;
  private readonly sprintMultiplier: number;
  private readonly eyeHeight: number;
  private readonly heightSampler: HeightSampler | null;
  private readonly fly: boolean;
  private readonly pressed = new Set<string>();

  private readonly onKeyDown = (e: KeyboardEvent) => this.pressed.add(e.code);
  private readonly onKeyUp = (e: KeyboardEvent) => this.pressed.delete(e.code);
  private readonly onClick = () => {
    if (this.enabled) this.controls.lock();
  };
  private readonly onBlur = () => this.pressed.clear();

  constructor(options: FirstPersonNavigationControllerOptions) {
    super({ ...options, autoConnect: false });
    this.controls = new PointerLockControls(this.camera, this.domElement);
    this.moveSpeed = options.moveSpeed ?? 20;
    this.sprintMultiplier = options.sprintMultiplier ?? 2.5;
    this.eyeHeight = options.eyeHeight ?? 1.7;
    this.heightSampler = options.heightSampler ?? null;
    this.fly = options.enableFly ?? this.heightSampler === null;

    if (options.autoConnect !== false) this.connect();
  }

  /** 暴露底层 PointerLockControls。 */
  get pointerLockControls(): PointerLockControls {
    return this.controls;
  }

  /** 当前是否处于指针锁定状态。 */
  get isLocked(): boolean {
    return this.controls.isLocked;
  }

  lock(): void {
    this.controls.lock();
  }

  unlock(): void {
    this.controls.unlock();
  }

  update(delta: number): void {
    if (!this.enabled) return;
    const sprint = this.isAny(KEY_BINDINGS.sprint);
    const speed = this.moveSpeed * (sprint ? this.sprintMultiplier : 1) * delta;

    const forward =
      (this.isAny(KEY_BINDINGS.forward) ? 1 : 0) -
      (this.isAny(KEY_BINDINGS.backward) ? 1 : 0);
    const strafe =
      (this.isAny(KEY_BINDINGS.right) ? 1 : 0) -
      (this.isAny(KEY_BINDINGS.left) ? 1 : 0);

    if (forward !== 0) this.controls.moveForward(forward * speed);
    if (strafe !== 0) this.controls.moveRight(strafe * speed);

    const position = this.camera.position;
    if (this.heightSampler) {
      position.y = this.heightSampler(position.x, position.z) + this.eyeHeight;
    } else if (this.fly) {
      const vertical =
        (this.isAny(KEY_BINDINGS.up) ? 1 : 0) -
        (this.isAny(KEY_BINDINGS.down) ? 1 : 0);
      if (vertical !== 0) position.y += vertical * speed;
    }
  }

  connect(): void {
    this.controls.connect(this.domElement);
    this.domElement.addEventListener("click", this.onClick);
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    this.connected = true;
  }

  disconnect(): void {
    this.controls.disconnect();
    this.domElement.removeEventListener("click", this.onClick);
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.pressed.clear();
    this.connected = false;
  }

  override dispose(): void {
    this.disconnect();
    this.controls.dispose();
  }

  override frame(
    target: THREE.Object3D | THREE.Box3,
    options?: FrameOptions,
  ): void {
    super.frame(target, options);
    if (this.heightSampler) {
      const p = this.camera.position;
      p.y = this.heightSampler(p.x, p.z) + this.eyeHeight;
    }
  }

  protected override onEnabledChanged(enabled: boolean): void {
    if (!enabled) {
      this.pressed.clear();
      if (this.controls.isLocked) this.controls.unlock();
    }
  }

  private isAny(codes: ReadonlySet<string>): boolean {
    for (const code of this.pressed) if (codes.has(code)) return true;
    return false;
  }
}
