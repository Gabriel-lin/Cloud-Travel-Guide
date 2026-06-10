import type * as THREE from "three";

/**
 * 地形体系的公共类型定义。
 *
 * 与 `loaders` 一致采用"接口契约 → 抽象类 → 实体类"的分层:
 * - `ITerrainProvider` 描述"地形提供者"契约;
 * - 不同高程来源(高程图、程序化噪声、未来的瓦片/DEM)各实现一个实体类。
 */

/**
 * 地形高度生成器:输入归一化坐标 [0,1],返回该处高度。
 * 返回值无需归一化,抽象基类会统一处理。
 */
export type TerrainHeightGenerator = (nx: number, nz: number) => number;

/** 归一化高度场:行优先存储,值域约 [0,1]。 */
export interface TerrainHeightField {
  data: Float32Array;
  /** 列数(沿 X 的顶点数)。 */
  cols: number;
  /** 行数(沿 Z 的顶点数)。 */
  rows: number;
}

/** 地形提供者的公共配置。 */
export interface TerrainProviderOptions {
  /** 地形在世界中的宽度(X 轴跨度)。默认 200。 */
  width?: number;
  /** 地形在世界中的进深(Z 轴跨度)。默认 200。 */
  depth?: number;
  /** 归一化高度到世界高度的缩放系数。默认 30。 */
  heightScale?: number;
  /** 地形原点(网格中心)在世界中的位置。默认 (0,0,0)。 */
  origin?: THREE.Vector3;
  /** 自定义材质;不传则使用按高程着色的标准材质。 */
  material?: THREE.Material;
  /** 是否按高程进行顶点着色(水→草→岩→雪)。默认 true。 */
  colorByElevation?: boolean;
  /** 是否线框显示。默认 false。 */
  wireframe?: boolean;
  /**
   * 是否把高度场归一化到 [0,1] 再乘以 heightScale。默认 true。
   * 真实地形(高度即米)应设为 false,此时 heightScale 作为垂直夸张系数(默认 1)。
   */
  normalizeHeights?: boolean;
}

/** 地形构建结果。 */
export interface TerrainBuildResult {
  /** 可直接加入场景的对象(即 `mesh`)。 */
  object: THREE.Object3D;
  /** 地形网格。 */
  mesh: THREE.Mesh;
  /** 世界坐标系下的包围盒。 */
  boundingBox: THREE.Box3;
  /** 尺寸与高程统计。 */
  size: {
    width: number;
    depth: number;
    minHeight: number;
    maxHeight: number;
  };
  /** 采样指定世界坐标 (x,z) 处的地表高度(世界 Y)。 */
  getHeightAt(x: number, z: number): number;
  /** 采样指定世界坐标 (x,z) 处的地表法线。 */
  getNormalAt(x: number, z: number, target?: THREE.Vector3): THREE.Vector3;
  /** 释放几何体与材质。 */
  dispose(): void;
}

/** 地形提供者契约。 */
export interface ITerrainProvider {
  /** 提供者名称。 */
  readonly name: string;
  /** 构建地形并返回结果。 */
  build(): Promise<TerrainBuildResult>;
  /** 释放提供者自身持有的资源。 */
  dispose(): void;
}
