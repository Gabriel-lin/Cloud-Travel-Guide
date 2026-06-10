import type * as THREE from "three";

/**
 * 3D 导航体系的公共类型定义。
 *
 * 与 `loaders` / `terrain` 一致采用"接口契约 → 抽象类 → 实体类"分层:
 * - `INavigationController` 描述"相机导航控制器"契约;
 * - 不同交互范式(轨道环视、第一人称漫游、未来的地球级导航)各实现一个实体类。
 */

/** 采样某点地表高度的函数(用于贴地行走 / 碰撞约束)。 */
export type HeightSampler = (x: number, z: number) => number;

/** 控制器公共配置。 */
export interface NavigationControllerOptions {
  /** 受控相机。 */
  camera: THREE.PerspectiveCamera;
  /** 事件绑定的 DOM 元素(通常是渲染器 canvas)。 */
  domElement: HTMLElement;
  /** 是否在构造后立即连接事件监听。默认 true。 */
  autoConnect?: boolean;
}

/** `frame()` 取景可选项。 */
export interface FrameOptions {
  /** 相机距目标的距离 = 包围球半径 × 该系数。默认 1.5。 */
  distanceFactor?: number;
  /** 俯仰角(弧度,自水平面向上)。默认 ~0.55。 */
  pitch?: number;
  /** 方位角(弧度,绕 Y 轴)。默认 ~0.8。 */
  azimuth?: number;
}

/** 相机导航控制器契约。 */
export interface INavigationController {
  /** 控制器名称。 */
  readonly name: string;
  /** 受控相机。 */
  readonly camera: THREE.PerspectiveCamera;
  /** 是否启用(禁用时忽略输入但仍可被 update 驱动惯性收尾)。 */
  enabled: boolean;

  /** 每帧驱动(传入秒级 delta)。 */
  update(delta: number): void;

  /** 将相机取景到给定对象 / 包围盒。 */
  frame(target: THREE.Object3D | THREE.Box3, options?: FrameOptions): void;

  /** 连接 / 断开事件监听。 */
  connect(): void;
  disconnect(): void;

  /** 释放全部资源。 */
  dispose(): void;
}
