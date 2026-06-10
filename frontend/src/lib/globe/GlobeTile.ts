import * as THREE from "three";

import {
  EARTH_RADIUS,
  latToTileY,
  lonLatToVec3,
  lonToTileX,
  mercatorToLonLat,
  tileCenterLonLat,
  tileGroundSize,
  tilePolarKind,
  tilesAtZoom,
} from "./geo";

/** 加载状态机。 */
export type GlobeTileState = "idle" | "queued" | "loading" | "loaded" | "error";

/** 地形可能的最大起伏(米),用于在加载前给包围球留出余量。 */
const MAX_TERRAIN_HEIGHT = 9000;

/** 瓦片内高程栅格(米),行优先 side×side。 */
export type TileElevationGrid = {
  data: Float32Array;
  side: number;
};

/**
 * 四叉树瓦片节点(Web Mercator z/x/y)。
 *
 * 持有该瓦片在球面上的网格、加载状态与四个子节点;
 * LOD 调度逻辑在 {@link Globe} 管理器中实现,本类只承载数据与几何工具。
 */
export class GlobeTile {
  readonly key: string;
  children: GlobeTile[] | null = null;
  mesh: THREE.Mesh | null = null;
  state: GlobeTileState = "idle";
  disposed = false;
  /** 是否已解码真实 DEM(非平面占位)。 */
  hasDem = false;
  /** 解码后的高程栅格(米);用于贴地采样,不依赖 mesh.visible。 */
  elevationGrid: TileElevationGrid | null = null;

  /** 瓦片中心(海拔 0)的 ECEF 坐标。 */
  readonly center = new THREE.Vector3();
  /** 用于视锥/距离判定的包围球半径。 */
  boundingRadius = 0;
  /** 中心纬度处的地面边长(米)。 */
  readonly groundSize: number;
  /** 中心点的单位法向(由地心指向瓦片中心)。 */
  readonly normal = new THREE.Vector3();
  /** 最北/最南行瓦片,需补极点扇形。 */
  readonly polar: "north" | "south" | null;

  constructor(
    readonly z: number,
    readonly x: number,
    readonly y: number,
  ) {
    this.key = `${z}/${x}/${y}`;
    this.polar = tilePolarKind(z, y);
    const { lonRad, latRad } = tileCenterLonLat(z, x, y);
    this.groundSize = tileGroundSize(z, latRad);
    lonLatToVec3(lonRad, latRad, 0, this.center);
    this.normal.copy(this.center).normalize();
    this.computeApproxBounds();
  }

  /** 四个角点(海拔 0)估算包围半径,并叠加最大地形起伏余量。 */
  private computeApproxBounds(): void {
    const n = tilesAtZoom(this.z);
    const corner = new THREE.Vector3();
    let maxDist = 0;
    for (let j = 0; j <= 1; j += 1) {
      for (let i = 0; i <= 1; i += 1) {
        const { lonRad, latRad } = mercatorToLonLat(
          (this.x + i) / n,
          (this.y + j) / n,
        );
        lonLatToVec3(lonRad, latRad, 0, corner);
        maxDist = Math.max(maxDist, corner.distanceTo(this.center));
      }
    }
    this.boundingRadius = maxDist + MAX_TERRAIN_HEIGHT;
    if (this.polar) {
      const pole = new THREE.Vector3(
        0,
        this.polar === "north" ? EARTH_RADIUS : -EARTH_RADIUS,
        0,
      );
      maxDist = Math.max(maxDist, pole.distanceTo(this.center));
      this.boundingRadius = maxDist + MAX_TERRAIN_HEIGHT;
    }
  }

  isPolar(): boolean {
    return this.polar !== null;
  }

  /** 创建四个子瓦片(若尚未创建)。 */
  ensureChildren(): GlobeTile[] {
    if (!this.children) {
      const z = this.z + 1;
      const x = this.x * 2;
      const y = this.y * 2;
      this.children = [
        new GlobeTile(z, x, y),
        new GlobeTile(z, x + 1, y),
        new GlobeTile(z, x, y + 1),
        new GlobeTile(z, x + 1, y + 1),
      ];
    }
    return this.children;
  }

  setMeshVisible(visible: boolean): void {
    if (this.mesh) this.mesh.visible = visible;
  }

  /** 该瓦片是否包含给定经纬度(度)。 */
  containsLatLon(latDeg: number, lonDeg: number): boolean {
    const n = tilesAtZoom(this.z);
    const tx = lonToTileX(lonDeg, this.z);
    const ty = latToTileY(latDeg, this.z);
    return tx >= this.x && tx < this.x + 1 && ty >= this.y && ty < this.y + 1;
  }

  /** 双线性插值采样瓦片内高程(米)。 */
  sampleElevationAt(latDeg: number, lonDeg: number): number | null {
    const grid = this.elevationGrid;
    if (!grid) return null;
    const n = tilesAtZoom(this.z);
    const u = lonToTileX(lonDeg, this.z) - this.x;
    const v = latToTileY(latDeg, this.z) - this.y;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;

    const { side, data } = grid;
    const max = side - 1;
    const gc = u * max;
    const gr = v * max;
    const c0 = Math.floor(gc);
    const r0 = Math.floor(gr);
    const c1 = Math.min(c0 + 1, max);
    const r1 = Math.min(r0 + 1, max);
    const tx = gc - c0;
    const ty = gr - r0;

    const h00 = data[r0 * side + c0]!;
    const h10 = data[r0 * side + c1]!;
    const h01 = data[r1 * side + c0]!;
    const h11 = data[r1 * side + c1]!;
    const top = h00 + (h10 - h00) * tx;
    const bottom = h01 + (h11 - h01) * tx;
    return top + (bottom - top) * ty;
  }

  /** 相机到瓦片表面的近似距离(已扣除包围半径)。 */
  distanceToCamera(cameraPos: THREE.Vector3): number {
    return Math.max(0, cameraPos.distanceTo(this.center) - this.boundingRadius);
  }

  /** 基于地平线的可见性:瓦片中心是否在相机可见半球内。 */
  isAboveHorizon(cameraPos: THREE.Vector3): boolean {
    const camDist = cameraPos.length();
    if (camDist <= EARTH_RADIUS) return true;
    const cosHorizon = EARTH_RADIUS / camDist;
    const camDir = cameraPos.clone().normalize();
    const dot = camDir.dot(this.normal);
    const farView = camDist > EARTH_RADIUS * 1.5;
    const angularMargin = (this.boundingRadius / camDist) * (farView ? 2.2 : 1.15);
    return dot >= cosHorizon - angularMargin;
  }
}
