import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { AbstractNavigationController } from "./AbstractNavigationController";
import type { FrameOptions, NavigationControllerOptions } from "./types";

/** 轨道导航控制器配置。 */
export interface OrbitNavigationControllerOptions
  extends NavigationControllerOptions {
  /** 阻尼(惯性)。默认 true。 */
  enableDamping?: boolean;
  /** 阻尼系数。默认 0.08。 */
  dampingFactor?: number;
  /** 最近 / 最远距离。 */
  minDistance?: number;
  maxDistance?: number;
  /** 最大俯仰角(防止穿到地形下方)。默认 ~85°。 */
  maxPolarAngle?: number;
  /** 是否在 XZ 平面平移(地图式);false 为屏幕空间平移。默认 true。 */
  screenSpacePanning?: boolean;
  /** 自动旋转。默认 false。 */
  autoRotate?: boolean;
}

/**
 * 轨道环视导航控制器。
 *
 * 基于 three.js {@link OrbitControls},围绕目标点旋转 / 缩放 / 平移,
 * 适合"绕着景点 / 模型查看"的导览场景。`frame()` 会自动把环视中心对准目标。
 */
export class OrbitNavigationController extends AbstractNavigationController {
  readonly name = "orbit";

  private readonly controls: OrbitControls;

  constructor(options: OrbitNavigationControllerOptions) {
    super({ ...options, autoConnect: false });
    const controls = new OrbitControls(this.camera, this.domElement);
    controls.enableDamping = options.enableDamping ?? true;
    controls.dampingFactor = options.dampingFactor ?? 0.08;
    controls.screenSpacePanning = options.screenSpacePanning ?? true;
    controls.autoRotate = options.autoRotate ?? false;
    controls.maxPolarAngle =
      options.maxPolarAngle ?? THREE.MathUtils.degToRad(85);
    if (options.minDistance !== undefined) {
      controls.minDistance = options.minDistance;
    }
    if (options.maxDistance !== undefined) {
      controls.maxDistance = options.maxDistance;
    }
    this.controls = controls;

    // 基类按 autoConnect 默认开启;此处显式连接以确保 controls 已就绪。
    if (options.autoConnect !== false) this.connect();
  }

  /** 暴露底层 OrbitControls 以便高级定制。 */
  get orbitControls(): OrbitControls {
    return this.controls;
  }

  update(delta: number): void {
    this.controls.update(delta);
  }

  connect(): void {
    this.controls.connect(this.domElement);
    this.controls.enabled = this.enabled;
    this.connected = true;
  }

  disconnect(): void {
    this.controls.disconnect();
    this.connected = false;
  }

  override dispose(): void {
    this.controls.dispose();
    this.connected = false;
  }

  override frame(
    target: THREE.Object3D | THREE.Box3,
    options?: FrameOptions,
  ): void {
    super.frame(target, options);
  }

  protected override onEnabledChanged(enabled: boolean): void {
    this.controls.enabled = enabled;
  }

  protected override onFramed(center: THREE.Vector3): void {
    this.controls.target.copy(center);
    this.controls.update();
  }
}
