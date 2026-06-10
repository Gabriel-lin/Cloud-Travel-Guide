import * as THREE from "three";
// 直接从源码深路径导入,绕开会拉入 WMS/PMTiles/vector-tile 等可选依赖的 `/plugins` 聚合入口。
import { GlobeControls, TilesRenderer } from "3d-tiles-renderer/src/index.js";
import { GoogleCloudAuthPlugin } from "3d-tiles-renderer/src/core/plugins/GoogleCloudAuthPlugin.js";
// 使用 core 版 CesiumIonAuthPlugin:三层版会引入 EPSG/QuantizedMesh(依赖 pmtiles/vector-tile),此处用不到。
import { CesiumIonAuthPlugin } from "3d-tiles-renderer/src/core/plugins/CesiumIonAuthPlugin.js";
import { ReorientationPlugin } from "3d-tiles-renderer/src/three/plugins/ReorientationPlugin.js";
import { TileCompressionPlugin } from "3d-tiles-renderer/src/three/plugins/TileCompressionPlugin.js";
import { TilesFadePlugin } from "3d-tiles-renderer/src/three/plugins/fade/TilesFadePlugin.js";

import type { SceneContext, SceneUpdatable } from "../viewer";

/** 经纬度坐标(单位:度)。 */
export interface GeoLocation {
  lat: number;
  lon: number;
  /** 海拔高度(米)。默认 0。 */
  height?: number;
}

/** 3D Tiles 数据源:Google 实景三维 / Cesium Ion / 通用 tileset。 */
export type Tiles3DSource =
  | { type: "google"; apiToken: string }
  | { type: "ion"; apiToken: string; assetId?: string }
  | { type: "url"; url: string };

/** Tiles3DTerrainProvider 配置。 */
export interface Tiles3DTerrainProviderOptions {
  /** 渲染上下文(可由 `sceneViewer.context` 提供)。 */
  context: SceneContext;
  /** 数据源。 */
  source: Tiles3DSource;
  /** 是否使用 GlobeControls 进行地球级导航。默认 true。 */
  useGlobeControls?: boolean;
  /**
   * 将指定经纬度重定位到世界原点(+Y 朝上),便于聚焦某地并简化相机。
   * 不传则保持原始 ECEF 坐标(整颗地球)。
   */
  reorientation?: GeoLocation | null;
  /** 屏幕空间像素误差目标(越小越清晰、越耗费)。默认 16。 */
  errorTarget?: number;
  /** 是否启用瓦片淡入。默认 true。 */
  fade?: boolean;
  /** 是否启用几何压缩以省显存。默认 true。 */
  compress?: boolean;
  /** 首次加载根 tileset 后是否自动取景。默认 true。 */
  autoFrame?: boolean;
  /** 加载错误回调。 */
  onLoadError?: (error: Error, url: string | URL) => void;
  /** 版权归属变更回调(Google/Ion 需展示数据来源)。 */
  onAttributionsChange?: (attributions: string) => void;
}

const DEG2RAD = Math.PI / 180;

/**
 * 大范围实景三维(3D Tiles)地形提供者。
 *
 * 基于 [3d-tiles-renderer](https://github.com/NASA-AMMOS/3DTilesRendererJS),
 * 在 **Three.js 场景内** 流式加载并渲染:
 * - Google 实景三维(Photorealistic 3D Tiles);
 * - Cesium Ion 资产(World Terrain / 自有 tileset);
 * - 任意符合 3D Tiles 规范的 tileset.json。
 *
 * 以 {@link SceneUpdatable} 形式接入 {@link SceneViewer}:每帧同步分辨率、更新瓦片与控制器。
 * 这是大范围实景的"地形提供者",与本地高程的 HeightmapTerrainProvider 互补,
 * 接入它无需改动 SceneViewer 架构。
 */
export class Tiles3DTerrainProvider implements SceneUpdatable {
  readonly name = "tiles-3d";
  readonly tiles: TilesRenderer;
  readonly controls: GlobeControls | null = null;

  private readonly context: SceneContext;
  private readonly autoFrame: boolean;
  private readonly onAttributionsChange?: (attributions: string) => void;
  private reorientPlugin: ReorientationPlugin | null = null;
  private framed = false;
  private disposed = false;
  private lastAttributions = "";
  private readonly raycaster = new THREE.Raycaster();

  constructor(options: Tiles3DTerrainProviderOptions) {
    const {
      context,
      source,
      useGlobeControls = true,
      reorientation = null,
      errorTarget = 16,
      fade = true,
      compress = true,
      autoFrame = true,
    } = options;

    this.context = context;
    this.autoFrame = autoFrame;
    this.onAttributionsChange = options.onAttributionsChange;

    this.tiles = this.createTiles(source);
    this.tiles.errorTarget = errorTarget;

    if (reorientation) {
      this.reorientPlugin = new ReorientationPlugin({
        lat: reorientation.lat * DEG2RAD,
        lon: reorientation.lon * DEG2RAD,
        height: reorientation.height ?? 0,
        recenter: true,
      });
      this.tiles.registerPlugin(this.reorientPlugin);
    }
    if (compress) this.tiles.registerPlugin(new TileCompressionPlugin());
    if (fade) this.tiles.registerPlugin(new TilesFadePlugin());

    this.tiles.setCamera(context.camera);
    this.tiles.setResolutionFromRenderer(context.camera, context.renderer);
    context.scene.add(this.tiles.group);

    this.tiles.addEventListener("load-error", (event) => {
      options.onLoadError?.(event.error, event.url);
    });
    this.tiles.addEventListener("load-tileset", () => {
      if (this.autoFrame && !this.framed) this.frameToTiles();
    });

    if (useGlobeControls) {
      const controls = new GlobeControls(
        context.scene,
        context.camera,
        context.domElement,
        this.tiles,
      );
      controls.enableDamping = true;
      this.controls = controls;
    }
  }

  /** 每帧更新:控制器 → 相机矩阵 → 分辨率 → 瓦片。 */
  update(_delta: number): void {
    if (this.disposed) return;
    const { camera, renderer } = this.context;
    this.controls?.update();
    camera.updateMatrixWorld();
    this.tiles.setResolutionFromRenderer(camera, renderer);
    this.tiles.update();
    this.pollAttributions();
  }

  /** 切换到指定经纬度(需在构造时启用 reorientation)。 */
  setView(location: GeoLocation): void {
    if (!this.reorientPlugin) {
      throw new Error(
        `[${this.name}] setView 需要在构造时提供 reorientation 以启用重定位。`,
      );
    }
    this.reorientPlugin.transformLatLonHeightToOrigin(
      location.lat * DEG2RAD,
      location.lon * DEG2RAD,
      location.height ?? 0,
    );
    this.framed = false;
    this.frameToTiles();
  }

  /**
   * 估算 (x,z) 处地表高度:自高空向下投射射线命中瓦片。
   * 适用于已重定位(+Y 朝上)的局部场景;未命中返回 0。
   */
  getHeightAt(x: number, z: number): number {
    this.raycaster.set(
      new THREE.Vector3(x, 1e6, z),
      new THREE.Vector3(0, -1, 0),
    );
    const hits = this.raycaster.intersectObject(this.tiles.group, true);
    return hits.length > 0 ? hits[0]!.point.y : 0;
  }

  /** 获取数据归属文本(Google/Ion 的使用条款要求展示)。 */
  getAttributions(): string {
    return this.tiles
      .getAttributions()
      .map((entry) => entry.value)
      .filter(Boolean)
      .join(" · ");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.controls?.dispose();
    this.context.scene.remove(this.tiles.group);
    this.tiles.dispose();
  }

  private createTiles(source: Tiles3DSource): TilesRenderer {
    switch (source.type) {
      case "google": {
        const tiles = new TilesRenderer();
        tiles.registerPlugin(
          new GoogleCloudAuthPlugin({
            apiToken: source.apiToken,
            autoRefreshToken: true,
          }),
        );
        return tiles;
      }
      case "ion": {
        const tiles = new TilesRenderer();
        tiles.registerPlugin(
          new CesiumIonAuthPlugin({
            apiToken: source.apiToken,
            assetId: source.assetId ?? null,
            autoRefreshToken: true,
          }),
        );
        return tiles;
      }
      case "url":
        return new TilesRenderer(source.url);
      default: {
        const exhaustive: never = source;
        throw new Error(`未知的 3D Tiles 数据源:${JSON.stringify(exhaustive)}`);
      }
    }
  }

  private frameToTiles(): void {
    const sphere = new THREE.Sphere();
    if (!this.tiles.getBoundingSphere(sphere)) return;
    this.framed = true;

    const { camera } = this.context;
    const radius = sphere.radius || 1000;
    const offset = new THREE.Vector3(0, radius * 0.6, radius * 1.1);
    camera.position.copy(sphere.center).add(offset);
    camera.near = Math.max(1, radius / 1000);
    camera.far = Math.max(camera.far, radius * 20);
    camera.updateProjectionMatrix();
    camera.lookAt(sphere.center);
    this.controls?.update();
  }

  private pollAttributions(): void {
    if (!this.onAttributionsChange) return;
    const current = this.getAttributions();
    if (current !== this.lastAttributions) {
      this.lastAttributions = current;
      this.onAttributionsChange(current);
    }
  }
}
