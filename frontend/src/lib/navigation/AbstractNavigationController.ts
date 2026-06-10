import * as THREE from "three";

import type {
  FrameOptions,
  INavigationController,
  NavigationControllerOptions,
} from "./types";

/**
 * 导航控制器抽象基类。
 *
 * 统一管理 相机 / DOM / 启用状态 / 连接生命周期,并实现与具体交互无关的
 * {@link frame}(包围盒取景)算法;实体类只需实现 输入监听 与 {@link update}。
 */
export abstract class AbstractNavigationController
  implements INavigationController
{
  abstract readonly name: string;

  readonly camera: THREE.PerspectiveCamera;
  protected readonly domElement: HTMLElement;
  protected connected = false;

  private _enabled = true;

  constructor(options: NavigationControllerOptions) {
    this.camera = options.camera;
    this.domElement = options.domElement;
    if (options.autoConnect !== false) {
      // 延迟到子类构造完成后再连接,避免访问未初始化字段。
      queueMicrotask(() => {
        if (!this.connected) this.connect();
      });
    }
  }

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    if (this._enabled === value) return;
    this._enabled = value;
    this.onEnabledChanged(value);
  }

  abstract update(delta: number): void;
  abstract connect(): void;
  abstract disconnect(): void;

  dispose(): void {
    this.disconnect();
  }

  /**
   * 取景:把相机放到能完整看到目标包围盒的位置,并朝向其中心。
   * 子类如有自身目标点(如 OrbitControls.target),应覆写并同步。
   */
  frame(target: THREE.Object3D | THREE.Box3, options: FrameOptions = {}): void {
    const box =
      target instanceof THREE.Box3
        ? target.clone()
        : new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = sphere.radius || 1;

    const distanceFactor = options.distanceFactor ?? 1.5;
    const pitch = options.pitch ?? 0.55;
    const azimuth = options.azimuth ?? 0.8;

    // 依据竖直 FOV 计算恰好容纳半径所需的距离,再乘以系数留出余量。
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const fitDistance = radius / Math.sin(Math.min(fov, Math.PI / 2) / 2);
    const distance = fitDistance * distanceFactor;

    const offset = new THREE.Vector3(
      distance * Math.cos(pitch) * Math.sin(azimuth),
      distance * Math.sin(pitch),
      distance * Math.cos(pitch) * Math.cos(azimuth),
    );

    this.camera.position.copy(center).add(offset);
    this.camera.lookAt(center);
    this.camera.near = Math.max(0.01, distance / 1000);
    this.camera.far = Math.max(this.camera.far, distance * 100);
    this.camera.updateProjectionMatrix();

    this.onFramed(center, distance);
  }

  /** 子类钩子:启用状态变更。 */
  protected onEnabledChanged(_enabled: boolean): void {}

  /** 子类钩子:取景完成后同步内部目标点等。 */
  protected onFramed(_center: THREE.Vector3, _distance: number): void {}
}
