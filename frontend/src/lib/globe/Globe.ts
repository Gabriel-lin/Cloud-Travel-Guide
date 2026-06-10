import * as THREE from "three";

import type { SceneContext, SceneUpdatable } from "../viewer";
import {
  EARTH_RADIUS,
  lonLatToVec3,
  lonToTileX,
  latToTileY,
  mercatorToLonLat,
  tilePolarKind,
  tilesAtZoom,
  vec3ToLonLat,
} from "./geo";
import { GlobeTile, type TileElevationGrid } from "./GlobeTile";

const DEG2RAD = Math.PI / 180;
const DEFAULT_DEM_URL =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const DEFAULT_IMAGERY_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const DEFAULT_ATTRIBUTION =
  "高程: Mapzen / AWS Terrain Tiles · 影像: Esri, Maxar, Earthstar Geographics";

/** 当前视点(相机正下方)的地理信息。 */
export interface SubPoint {
  lat: number;
  lon: number;
  /** 相机离地高度(米)。 */
  altitude: number;
}

/** Globe 配置。 */
export interface GlobeOptions {
  context: SceneContext;
  /** 起始(根)缩放级别。默认 2(16 块覆盖全球)。 */
  minZoom?: number;
  /** 最大细分级别。默认 15(Terrarium 高程上限)。 */
  maxZoom?: number;
  /** 每瓦片网格细分数。默认 16。 */
  tileResolution?: number;
  /** 垂直夸张系数。默认 1。 */
  exaggeration?: number;
  /** 细分激进程度:相机距离 < 瓦片地面边长 × 该系数时细分。默认 2.5。 */
  splitFactor?: number;
  /** 并发瓦片加载数。默认 16。 */
  concurrency?: number;
  /** DEM 高程栅格 LRU 缓存上限(瓦片数)。默认 512。 */
  demCacheSize?: number;
  demUrlTemplate?: string;
  imageryUrlTemplate?: string | null;
  attribution?: string;
  /** 相机距地形表面的最小净空(米),防止钻入地下。默认 2。 */
  minClearance?: number;
}

/**
 * 流式 LOD 3D 地球。
 *
 * 在 WGS84 球面上以 Web Mercator 四叉树组织瓦片:每帧根据相机位置(当前经纬度/高度)
 * 与视锥,自动细分加载离视点更近的高层级 **免费高程 + 影像** 瓦片,并释放远处层级。
 * 即"地形随当前经纬度动态加载"。以 {@link SceneUpdatable} 接入 {@link SceneViewer}。
 */
export class Globe implements SceneUpdatable {
  readonly name = "globe";
  readonly group = new THREE.Group();

  private readonly context: SceneContext;
  private readonly minZoom: number;
  private readonly maxZoom: number;
  private readonly resolution: number;
  private readonly exaggeration: number;
  private readonly splitFactor: number;
  private readonly concurrency: number;
  private readonly demUrlTemplate: string;
  private imageryUrlTemplate: string | null;
  private attributionText: string;
  private readonly minClearance: number;
  private readonly demCacheSize: number;

  private readonly roots: GlobeTile[] = [];
  private readonly queue: GlobeTile[] = [];
  private active = 0;
  private disposed = false;
  private imageryRevision = 0;

  /** 影像 URL → 共享加载 Promise,避免重复请求。 */
  private readonly imageCache = new Map<string, Promise<HTMLImageElement | null>>();
  /** 瓦片 key → 已解码 DEM,切换图层时复用。 */
  private readonly demGridCache = new Map<string, TileElevationGrid>();
  /** 后台升级网格密度中的瓦片(保持 loaded 可见,避免瑞士奶酪缺口)。 */
  private readonly upgradingTiles = new Set<GlobeTile>();

  private readonly camPosForPriority = new THREE.Vector3();

  private readonly frustum = new THREE.Frustum();
  private readonly projScreen = new THREE.Matrix4();
  private readonly scratchSphere = new THREE.Sphere();
  private readonly scratchDir = new THREE.Vector3();
  private readonly scratchTarget = new THREE.Vector3();
  private readonly scratchRayOrigin = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private readonly demCanvas: HTMLCanvasElement | null;
  private readonly demCtx: CanvasRenderingContext2D | null;

  constructor(options: GlobeOptions) {
    this.context = options.context;
    this.minZoom = options.minZoom ?? 2;
    this.maxZoom = options.maxZoom ?? 15;
    this.resolution = options.tileResolution ?? 24;
    this.exaggeration = options.exaggeration ?? 1;
    this.splitFactor = options.splitFactor ?? 2.5;
    this.concurrency = options.concurrency ?? 24;
    this.demCacheSize = options.demCacheSize ?? 512;
    this.demUrlTemplate = options.demUrlTemplate ?? DEFAULT_DEM_URL;
    this.imageryUrlTemplate =
      options.imageryUrlTemplate === null
        ? null
        : (options.imageryUrlTemplate ?? DEFAULT_IMAGERY_URL);
    this.attributionText = options.attribution ?? DEFAULT_ATTRIBUTION;
    this.minClearance = options.minClearance ?? 2;

    this.group.name = "globe";
    this.context.scene.add(this.group);

    if (typeof document !== "undefined") {
      this.demCanvas = document.createElement("canvas");
      this.demCanvas.width = 256;
      this.demCanvas.height = 256;
      this.demCtx = this.demCanvas.getContext("2d", {
        willReadFrequently: true,
      });
    } else {
      this.demCanvas = null;
      this.demCtx = null;
    }

    const n = tilesAtZoom(this.minZoom);
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        this.roots.push(new GlobeTile(this.minZoom, x, y));
      }
    }
  }

  getAttribution(): string {
    return this.attributionText;
  }

  /** 相机脚下所需层级是否就绪(仅据此显示加载指示,避免低空时队列永不排空)。 */
  get loading(): boolean {
    return !this.isFootprintTilesReady();
  }

  /** 当前视点(相机正下方)的经纬度与高度(相对真实地形的净空)。 */
  getSubPoint(): SubPoint {
    const { lat, lon } = vec3ToLonLat(this.context.camera.position);
    const surfaceR = this.getSurfaceRadiusAt(lat, lon);
    const camR = this.context.camera.position.length();
    return {
      lat,
      lon,
      altitude: Math.max(0, camR - surfaceR),
    };
  }

  /** 在指定经纬度处设置轨道目标(飞到预置点等一次性调用)。 */
  placeOrbitTargetAt(
    latDeg: number,
    lonDeg: number,
    outTarget: THREE.Vector3,
  ): { minDistance: number; surfaceRadius: number } {
    const surfaceR = this.getSurfaceRadiusAt(latDeg, lonDeg);
    lonLatToVec3(
      lonDeg * DEG2RAD,
      latDeg * DEG2RAD,
      surfaceR - EARTH_RADIUS,
      outTarget,
    );
    return { minDistance: this.minClearance, surfaceRadius: surfaceR };
  }

  /**
   * 将已有轨道目标贴合到其经纬度处的真实地表(只修正半径,不改水平角)。
   * 每帧调用不会干扰俯仰旋转与 ViewGizmo。
   */
  snapOrbitTargetOntoSurface(target: THREE.Vector3): {
    minDistance: number;
    surfaceRadius: number;
  } {
    if (target.lengthSq() < 1) {
      return { minDistance: this.minClearance, surfaceRadius: EARTH_RADIUS };
    }
    const { lat, lon } = vec3ToLonLat(target);
    const surfaceR = this.getSurfaceRadiusAt(lat, lon);
    target.normalize().multiplyScalar(surfaceR);
    return { minDistance: this.minClearance, surfaceRadius: surfaceR };
  }

  /** 沿径向把相机钳制到地形之上(在导航更新之后可再调用一次)。 */
  clampCameraToTerrain(): void {
    const camera = this.context.camera;
    const camPos = camera.position;
    const { lat, lon } = vec3ToLonLat(camPos);
    const camR = camPos.length();
    const camAlt = Math.max(camR - EARTH_RADIUS, 1);
    const radial = this.scratchDir.copy(camPos).normalize();
    let surfaceR = this.getSurfaceRadiusAt(lat, lon);
    if (camAlt < 30_000) {
      const meshR = this.raycastVisibleSurfaceRadius(camPos, radial);
      if (meshR !== null) surfaceR = meshR;
    }
    const minR = surfaceR + this.minClearance;
    if (camR < minR) {
      camPos.copy(radial).multiplyScalar(minR);
    }
    const clearance = Math.max(camPos.length() - surfaceR, this.minClearance);
    camera.near = Math.max(0.5, clearance * 0.05);
    camera.far = camPos.length() + EARTH_RADIUS * 1.5;
    camera.updateProjectionMatrix();
  }

  /** 飞到指定经纬度上空。 */
  flyTo(lat: number, lon: number, altitude = 80000): void {
    const surfaceR = this.getSurfaceRadiusAt(lat, lon);
    lonLatToVec3(
      lon * DEG2RAD,
      lat * DEG2RAD,
      surfaceR - EARTH_RADIUS + altitude,
      this.context.camera.position,
    );
    this.placeOrbitTargetAt(lat, lon, this.scratchTarget);
    this.context.camera.lookAt(this.scratchTarget);
  }

  /** 切换影像图层(保留已加载 DEM/几何,仅更新贴图)。 */
  setImageryLayer(template: string | null, attribution?: string): void {
    this.imageryUrlTemplate = template;
    if (attribution !== undefined) this.attributionText = attribution;
    this.imageryRevision += 1;
    for (const root of this.roots) {
      this.forEachTile(root, (tile) => {
        if (tile.state === "loaded" && tile.mesh) {
          void this.applyImageryToTile(tile);
        }
      });
    }
  }

  /** 清空并重建瓦片(用于切换图层等)。 */
  reset(): void {
    this.queue.length = 0;
    for (const root of this.roots) this.disposeTile(root);
    this.roots.length = 0;
    const n = tilesAtZoom(this.minZoom);
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        this.roots.push(new GlobeTile(this.minZoom, x, y));
      }
    }
  }

  update(_delta: number): void {
    if (this.disposed) return;
    const camera = this.context.camera;
    const camPos = camera.position;
    this.camPosForPriority.copy(camPos);

    camera.updateMatrixWorld();

    this.projScreen.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    this.frustum.setFromProjectionMatrix(this.projScreen);

    const { lat: footLat, lon: footLon } = vec3ToLonLat(camPos);
    const camAlt = this.getCameraTerrainAltitude(camPos);

    // 1) 先更新 LOD 可见性(含"无更细层时用最细可用层"回退)
    for (const root of this.roots) {
      this.visit(root, camPos, footLat, footLon, camAlt);
    }

    // 2) 再按已加载 DEM 贴地钳制
    this.clampCameraToTerrain();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.queue.length = 0;
    for (const root of this.roots) this.disposeTile(root);
    this.roots.length = 0;
    this.imageCache.clear();
    this.demGridCache.clear();
    this.context.scene.remove(this.group);
  }

  private visit(
    tile: GlobeTile,
    camPos: THREE.Vector3,
    footLat: number,
    footLon: number,
    camAlt: number,
  ): boolean {
    if (this.shouldLoadTile(tile, footLat, footLon, camAlt, camPos)) {
      this.ensureLoaded(tile);
      if (camAlt < 5000 && tile.state === "loaded") {
        this.maybeUpgradeTileDetail(tile);
      }
    }

    const inView = this.isVisible(tile, camPos);
    const wantSplit =
      inView && this.tileWantsSplit(tile, camPos, camAlt);

    if (wantSplit) {
      const children = tile.ensureChildren();
      const relevant = this.getRelevantChildren(
        children,
        camPos,
        footLat,
        footLon,
      );
      const seaLevelAlt = Math.max(camPos.length() - EARTH_RADIUS, 1);
      const toRefine =
        seaLevelAlt > 500_000
          ? children
          : relevant.length > 0
            ? relevant
            : children;
      const partialRefine = toRefine.length < children.length;
      // 低空预加载全部子象限,避免平移/斜视时出现未加载黑洞。
      const toLoad =
        camAlt < 8000 && inView
          ? children
          : toRefine;

      for (const child of toLoad) {
        if (this.shouldLoadTile(child, footLat, footLon, camAlt, camPos)) {
          this.ensureLoaded(child);
        }
      }

      let anyChildDrawn = false;
      for (const child of toRefine) {
        if (this.visit(child, camPos, footLat, footLon, camAlt)) {
          anyChildDrawn = true;
        }
      }

      const allLoaded = toRefine.every((c) => c.state === "loaded");
      const anyChildNeedsFiner = toRefine.some((c) =>
        this.tileWantsSplit(c, camPos, camAlt),
      );
      // 父瓦片在子级未就绪或仍需继续细分时保持可见,防止低空瑞士奶酪缺口。
      const showParent =
        tile.state === "loaded" &&
        inView &&
        (partialRefine ||
          !anyChildDrawn ||
          !allLoaded ||
          anyChildNeedsFiner);
      tile.setMeshVisible(showParent);
      if (tile.mesh) {
        const mat = tile.mesh.material as THREE.MeshBasicMaterial;
        // 子瓦片已绘制时父级不写深度,避免叠绘 z-fighting 产生锯齿缺口。
        mat.depthWrite = !(showParent && anyChildDrawn);
      }
      return showParent || anyChildDrawn;
    }

    const show = tile.state === "loaded" && inView;
    tile.setMeshVisible(show);
    if (!tile.containsLatLon(footLat, footLon) && camAlt > 80000) {
      this.disposeChildren(tile);
    }
    return show;
  }

  /** 离地高度(米),相对真实地形而非海平面。 */
  private getCameraTerrainAltitude(camPos: THREE.Vector3): number {
    const { lat, lon } = vec3ToLonLat(camPos);
    const surfaceR = this.getSurfaceRadiusAt(lat, lon);
    return Math.max(camPos.length() - surfaceR, 1);
  }

  /** 视锥内或脚下的瓦片才加载;脚下优先排序,避免黑洞但控制队列规模。 */
  private shouldLoadTile(
    tile: GlobeTile,
    footLat: number,
    footLon: number,
    camAlt: number,
    camPos: THREE.Vector3,
  ): boolean {
    if (camAlt > 20_000) return true;
    if (tile.containsLatLon(footLat, footLon)) return true;
    return this.isVisible(tile, camPos);
  }

  private getRelevantChildren(
    children: GlobeTile[],
    camPos: THREE.Vector3,
    footLat: number,
    footLon: number,
  ): GlobeTile[] {
    return children.filter(
      (c) => c.containsLatLon(footLat, footLon) || this.isVisible(c, camPos),
    );
  }

  /** 低空时提高网格细分数,改善 1km 内清晰度。 */
  private getTileResolution(tile: GlobeTile): number {
    const camAlt = this.getCameraTerrainAltitude(this.context.camera.position);
    let n = this.resolution;
    if (camAlt < 5000 && tile.z >= 10) n = Math.max(n, 28);
    if (camAlt < 2000 && tile.z >= 11) n = Math.max(n, 32);
    if (camAlt < 1000 && tile.z >= 12) n = Math.max(n, 36);
    return n;
  }

  private tileMeshResolution(tile: GlobeTile): number {
    return Math.max((tile.elevationGrid?.side ?? 0) - 1, 0);
  }

  private needsResolutionUpgrade(tile: GlobeTile): boolean {
    if (tile.state !== "loaded") return false;
    const want = this.getTileResolution(tile);
    const have = this.tileMeshResolution(tile);
    return have > 0 && have < want;
  }

  /** 相机下降后把已加载的低分辨率瓦片升级到当前高度对应的网格密度。 */
  private maybeUpgradeTileDetail(tile: GlobeTile): void {
    if (!this.needsResolutionUpgrade(tile)) {
      this.refreshImagerySharpness(tile);
      return;
    }
    const key = this.demCacheKey(tile);
    const cached = this.demGridCache.get(key);
    if (cached) {
      tile.elevationGrid = cached;
      tile.hasDem = true;
      this.replaceTileGeometry(tile, cached);
      this.refreshImagerySharpness(tile);
      return;
    }
    if (this.upgradingTiles.has(tile)) return;
    this.upgradingTiles.add(tile);
    void this.fetchDemGrid(tile)
      .then((grid) => {
        this.upgradingTiles.delete(tile);
        if (!grid || tile.disposed || !tile.mesh || tile.state !== "loaded") {
          return;
        }
        tile.elevationGrid = grid;
        tile.hasDem = true;
        this.replaceTileGeometry(tile, grid);
        this.refreshImagerySharpness(tile);
      })
      .catch(() => {
        this.upgradingTiles.delete(tile);
      });
  }

  private tileWantsSplit(
    tile: GlobeTile,
    camPos: THREE.Vector3,
    camAlt: number,
  ): boolean {
    const maxDetailZ = this.getRequiredDetailZoom(camAlt);
    const split = this.splitFactorForAltitude(camAlt);
    return (
      tile.z < this.maxZoom &&
      tile.z < maxDetailZ &&
      tile.distanceToCamera(camPos) < tile.groundSize * split
    );
  }

  private demCacheKey(tile: GlobeTile): string {
    return `${tile.key}@${this.getTileResolution(tile)}`;
  }

  private splitFactorForAltitude(camAlt: number): number {
    if (camAlt < 200) return 0.5;
    if (camAlt < 500) return 0.55;
    if (camAlt < 1000) return 0.65;
    if (camAlt < 2000) return 0.8;
    if (camAlt < 5000) return 1.0;
    if (camAlt < 20000) return 1.8;
    return this.splitFactor;
  }

  /** 按离地高度决定需要的最高瓦片层级(支持低至 ~100m)。 */
  private getRequiredDetailZoom(camAlt: number): number {
    if (camAlt > 8_000_000) return this.minZoom + 1;
    if (camAlt > 2_000_000) return this.minZoom + 3;
    if (camAlt > 500_000) return this.minZoom + 6;
    if (camAlt > 50_000) return this.minZoom + 9;
    if (camAlt > 5_000) return this.minZoom + 12;
    return this.maxZoom;
  }

  /** 相机脚下到目标层级的瓦片链是否已全部 loaded。 */
  private isFootprintTilesReady(): boolean {
    const camPos = this.context.camera.position;
    const { lat, lon } = vec3ToLonLat(camPos);
    const camAlt = this.getCameraTerrainAltitude(camPos);
    const needZ = this.getRequiredDetailZoom(camAlt);

    let cur: GlobeTile | null = null;
    for (const root of this.roots) {
      if (root.containsLatLon(lat, lon)) {
        cur = root;
        break;
      }
    }
    if (!cur) return this.active === 0 && this.queue.length === 0;

    while (cur) {
      if (cur.state === "loading" || cur.state === "queued") return false;
      if (cur.state !== "loaded") return false;
      if (cur.z >= needZ) return true;
      if (!cur.children) return false;
      const next: GlobeTile | undefined = cur.children.find((c) =>
        c.containsLatLon(lat, lon),
      );
      if (!next) return true;
      cur = next;
    }
    return true;
  }

  private isVisible(tile: GlobeTile, camPos: THREE.Vector3): boolean {
    const { lat, lon } = vec3ToLonLat(camPos);
    if (tile.containsLatLon(lat, lon)) return true;
    if (!tile.isAboveHorizon(camPos)) return false;
    const camDist = camPos.length();
    const spaceView = camDist > EARTH_RADIUS * 1.5;
    const margin = spaceView ? 1.75 : tile.isPolar() ? 1.5 : 1.2;
    this.scratchSphere.center.copy(tile.center);
    this.scratchSphere.radius = tile.boundingRadius * margin;
    return this.frustum.intersectsSphere(this.scratchSphere);
  }

  private ensureLoaded(tile: GlobeTile): void {
    if (tile.state !== "idle") return;
    tile.state = "queued";
    this.queue.push(tile);
    this.pump();
  }

  private pump(): void {
    const { lat, lon } = vec3ToLonLat(this.camPosForPriority);
    const camAlt = this.getCameraTerrainAltitude(this.camPosForPriority);
    const limit =
      camAlt < 5000 ? Math.max(this.concurrency, 32) : this.concurrency;

    this.queue.sort((a, b) => {
      const aFoot = a.containsLatLon(lat, lon) ? 0 : 1;
      const bFoot = b.containsLatLon(lat, lon) ? 0 : 1;
      if (aFoot !== bFoot) return aFoot - bFoot;
      return (
        a.distanceToCamera(this.camPosForPriority) -
        b.distanceToCamera(this.camPosForPriority)
      );
    });

    while (this.active < limit && this.queue.length > 0) {
      const tile = this.queue.shift()!;
      if (tile.disposed) continue;
      this.active += 1;
      void this.loadTile(tile).finally(() => {
        this.active -= 1;
        this.pump();
      });
    }
  }

  private async loadTile(tile: GlobeTile): Promise<void> {
    if (tile.disposed || this.disposed) return;
    tile.state = "loading";
    const imageryGen = this.imageryRevision;

    try {
      let elevGrid = this.demGridCache.get(this.demCacheKey(tile)) ?? null;
      const imageryUrl = this.imageryUrlTemplate
        ? this.formatUrl(this.imageryUrlTemplate, tile)
        : null;
      const imageryPromise = imageryUrl
        ? this.cacheImage(imageryUrl)
        : Promise.resolve(null);
      const demPromise = elevGrid ? null : this.fetchDemGrid(tile);

      const imageryImg = await imageryPromise;
      if (tile.disposed || this.disposed) return;

      this.mountTileMesh(tile, elevGrid, imageryImg);

      if (demPromise) {
        elevGrid = await demPromise;
        if (tile.disposed || this.disposed) return;
        if (elevGrid && tile.mesh) {
          tile.hasDem = true;
          tile.elevationGrid = elevGrid;
          this.replaceTileGeometry(tile, elevGrid);
        }
      }

      if (imageryGen !== this.imageryRevision) {
        await this.applyImageryToTile(tile);
      }
      tile.state = "loaded";
    } catch {
      if (tile.disposed || this.disposed) return;
      this.mountTileMesh(
        tile,
        this.demGridCache.get(this.demCacheKey(tile)) ?? null,
        null,
      );
      tile.state = "loaded";
    }
  }

  private async fetchDemGrid(tile: GlobeTile): Promise<TileElevationGrid | null> {
    const url = this.formatUrl(this.demUrlTemplate, tile);
    const img = await this.cacheImage(url);
    if (!img || !this.demCtx) return null;
    const grid = this.decodeDemToGrid(img, this.getTileResolution(tile));
    this.storeDemCache(this.demCacheKey(tile), grid);
    return grid;
  }

  private mountTileMesh(
    tile: GlobeTile,
    elevGrid: TileElevationGrid | null,
    imageryImg: HTMLImageElement | null,
  ): void {
    const { geometry, elevationGrid } = this.buildGeometry(tile, elevGrid);
    tile.elevationGrid = elevationGrid;
    tile.hasDem = elevGrid !== null;

    if (tile.mesh) {
      tile.mesh.geometry.dispose();
      tile.mesh.geometry = geometry;
      this.setImageryOnMaterial(
        tile.mesh.material as THREE.MeshBasicMaterial,
        imageryImg,
        tile,
      );
      return;
    }

    const material = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      color: imageryImg ? 0xffffff : 0x33485f,
    });
    this.setImageryOnMaterial(material, imageryImg, tile);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `tile-${tile.key}`;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = tile.z;
    tile.mesh = mesh;
    this.group.add(mesh);
  }

  private replaceTileGeometry(
    tile: GlobeTile,
    elevGrid: TileElevationGrid,
  ): void {
    if (!tile.mesh) return;
    const { geometry } = this.buildGeometry(tile, elevGrid);
    tile.mesh.geometry.dispose();
    tile.mesh.geometry = geometry;
  }

  private async applyImageryToTile(tile: GlobeTile): Promise<void> {
    if (!tile.mesh || tile.disposed) return;
    const material = tile.mesh.material as THREE.MeshBasicMaterial;
    if (!this.imageryUrlTemplate) {
      material.map?.dispose();
      material.map = null;
      material.color.set(0x33485f);
      material.needsUpdate = true;
      return;
    }
    const url = this.formatUrl(this.imageryUrlTemplate, tile);
    const img = await this.cacheImage(url);
    if (tile.disposed || !tile.mesh) return;
    this.setImageryOnMaterial(material, img, tile);
  }

  private shouldUseSharpImagery(tile: GlobeTile): boolean {
    const camAlt = this.getCameraTerrainAltitude(this.context.camera.position);
    return tile.z >= 12 || camAlt < 3000;
  }

  private refreshImagerySharpness(tile: GlobeTile): void {
    if (!tile.mesh) return;
    const material = tile.mesh.material as THREE.MeshBasicMaterial;
    const tex = material.map;
    if (!tex) return;
    const sharp = this.shouldUseSharpImagery(tile);
    tex.minFilter = sharp
      ? THREE.LinearFilter
      : THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = !sharp;
    tex.needsUpdate = true;
  }

  private setImageryOnMaterial(
    material: THREE.MeshBasicMaterial,
    imageryImg: HTMLImageElement | null,
    tile?: GlobeTile,
  ): void {
    material.map?.dispose();
    if (imageryImg) {
      const sharp = tile ? this.shouldUseSharpImagery(tile) : false;
      const texture = new THREE.Texture(imageryImg);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(
        sharp ? 16 : 8,
        this.context.renderer.capabilities.getMaxAnisotropy(),
      );
      texture.minFilter = sharp
        ? THREE.LinearFilter
        : THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = !sharp;
      texture.needsUpdate = true;
      material.map = texture;
      material.color.set(0xffffff);
    } else {
      material.map = null;
      material.color.set(0x33485f);
    }
    material.needsUpdate = true;
  }

  private decodeDemToGrid(
    img: HTMLImageElement,
    meshResolution: number,
  ): TileElevationGrid {
    const N = meshResolution;
    const side = N + 1;
    const elevGrid = new Float32Array(side * side);
    if (!this.demCtx) return { data: elevGrid, side };

    this.demCtx.clearRect(0, 0, 256, 256);
    this.demCtx.drawImage(img, 0, 0, 256, 256);
    const dem = this.demCtx.getImageData(0, 0, 256, 256).data;
    for (let j = 0; j < side; j += 1) {
      for (let i = 0; i < side; i += 1) {
        const px = Math.min(255, Math.round((i / N) * 255));
        const py = Math.min(255, Math.round((j / N) * 255));
        const p = (py * 256 + px) * 4;
        elevGrid[j * side + i] =
          dem[p]! * 256 + dem[p + 1]! + dem[p + 2]! / 256 - 32768;
      }
    }
    return { data: elevGrid, side };
  }

  private storeDemCache(key: string, grid: TileElevationGrid): void {
    if (this.demGridCache.has(key)) this.demGridCache.delete(key);
    this.demGridCache.set(key, grid);
    while (this.demGridCache.size > this.demCacheSize) {
      const oldest = this.demGridCache.keys().next().value;
      if (oldest === undefined) break;
      this.demGridCache.delete(oldest);
    }
  }

  private cacheImage(url: string): Promise<HTMLImageElement | null> {
    let pending = this.imageCache.get(url);
    if (!pending) {
      pending = this.loadImage(url).catch(() => null);
      this.imageCache.set(url, pending);
    }
    return pending;
  }

  private forEachTile(tile: GlobeTile, fn: (t: GlobeTile) => void): void {
    fn(tile);
    if (tile.children) {
      for (const child of tile.children) this.forEachTile(child, fn);
    }
  }

  /** 相机正下方、当前实际绘制的最细瓦片。 */
  private findDeepestVisibleTile(
    latDeg: number,
    lonDeg: number,
  ): GlobeTile | null {
    let best: GlobeTile | null = null;
    let bestZ = -1;

    for (const root of this.roots) {
      if (!root.containsLatLon(latDeg, lonDeg)) continue;
      let cur: GlobeTile | null = root;
      while (cur) {
        if (
          cur.state === "loaded" &&
          cur.mesh?.visible &&
          cur.containsLatLon(latDeg, lonDeg) &&
          cur.z > bestZ
        ) {
          bestZ = cur.z;
          best = cur;
        }
        if (!cur.children) break;
        const next: GlobeTile | undefined = cur.children.find((c) =>
          c.containsLatLon(latDeg, lonDeg),
        );
        cur = next ?? null;
      }
    }
    return best;
  }

  /**
   * 取经纬度处地表半径:优先**当前可见**瓦片(与屏幕一致),
   * 避免不可见粗瓦片 DEM 高估高程导致无法贴近地表。
   */
  private getSurfaceRadiusAt(latDeg: number, lonDeg: number): number {
    const lonRad = lonDeg * DEG2RAD;
    const latRad = latDeg * DEG2RAD;
    const tmp = this.scratchTarget;

    const visible = this.findDeepestVisibleTile(latDeg, lonDeg);
    if (visible) {
      if (visible.hasDem && visible.elevationGrid) {
        const elev = visible.sampleElevationAt(latDeg, lonDeg);
        if (elev !== null) {
          lonLatToVec3(lonRad, latRad, elev * this.exaggeration, tmp);
          return tmp.length();
        }
      }
      lonLatToVec3(lonRad, latRad, 0, tmp);
      return tmp.length();
    }

    let surfaceR = EARTH_RADIUS;
    let bestZ = -1;
    for (const root of this.roots) {
      if (!root.containsLatLon(latDeg, lonDeg)) continue;
      let cur: GlobeTile | null = root;
      while (cur) {
        if (cur.state === "loaded" && cur.hasDem && cur.elevationGrid) {
          const elev = cur.sampleElevationAt(latDeg, lonDeg);
          if (elev !== null && cur.z > bestZ) {
            bestZ = cur.z;
            lonLatToVec3(lonRad, latRad, elev * this.exaggeration, tmp);
            surfaceR = tmp.length();
          }
        }
        if (!cur.children) break;
        const next: GlobeTile | undefined = cur.children.find((c) =>
          c.containsLatLon(latDeg, lonDeg),
        );
        cur = next ?? null;
      }
    }
    return surfaceR;
  }

  /** 从相机外侧向地心投射,命中当前可见地形网格。 */
  private raycastVisibleSurfaceRadius(
    camPos: THREE.Vector3,
    radial: THREE.Vector3,
  ): number | null {
    if (this.group.children.length === 0) return null;
    const len = camPos.length();
    this.scratchRayOrigin.copy(radial).multiplyScalar(len + 80_000);
    this.raycaster.set(
      this.scratchRayOrigin,
      this.scratchDir.copy(radial).negate(),
    );
    this.raycaster.far = 200_000;
    const hits = this.raycaster.intersectObject(this.group, true);
    for (const hit of hits) {
      if (hit.object.visible) return hit.point.length();
    }
    return null;
  }

  /** 由 DEM 栅格在球面上构建网格;elevGrid 为 null 时使用平面。 */
  private buildGeometry(
    tile: GlobeTile,
    elevGrid: TileElevationGrid | null,
  ): { geometry: THREE.BufferGeometry; elevationGrid: TileElevationGrid } {
    const N = this.getTileResolution(tile);
    const side = N + 1;
    const positions = new Float32Array(side * side * 3);
    const uvs = new Float32Array(side * side * 2);
    const gridOk = elevGrid !== null && elevGrid.side === side;
    const elevationGrid: TileElevationGrid = gridOk
      ? elevGrid!
      : {
          data: new Float32Array(side * side),
          side,
        };

    const n = tilesAtZoom(tile.z);
    const tmp = new THREE.Vector3();
    for (let j = 0; j < side; j += 1) {
      for (let i = 0; i < side; i += 1) {
        const mx = (tile.x + i / N) / n;
        const my = (tile.y + j / N) / n;
        const { lonRad, latRad } = mercatorToLonLat(mx, my);

        const elevation = elevationGrid.data[j * side + i] ?? 0;

        lonLatToVec3(lonRad, latRad, elevation * this.exaggeration, tmp);
        const idx = j * side + i;
        positions[idx * 3] = tmp.x;
        positions[idx * 3 + 1] = tmp.y;
        positions[idx * 3 + 2] = tmp.z;
        uvs[idx * 2] = i / N;
        uvs[idx * 2 + 1] = 1 - j / N;
      }
    }

    const indices = new Uint16Array(N * N * 6);
    let o = 0;
    for (let j = 0; j < N; j += 1) {
      for (let i = 0; i < N; i += 1) {
        const a = j * side + i;
        const b = a + 1;
        const c = a + side;
        const d = c + 1;
        indices[o++] = a;
        indices[o++] = c;
        indices[o++] = b;
        indices[o++] = b;
        indices[o++] = c;
        indices[o++] = d;
      }
    }

    const polar = tilePolarKind(tile.z, tile.y);
    let finalPositions = positions;
    let finalUvs = uvs;
    let finalIndices = indices;

    if (polar) {
      const poleLat =
        polar === "north" ? Math.PI / 2 : -Math.PI / 2;
      const poleLon = mercatorToLonLat((tile.x + 0.5) / n, tile.y / n).lonRad;
      let poleElev = 0;
      if (polar === "north") {
        for (let i = 0; i < side; i += 1) poleElev += elevationGrid.data[i]!;
        poleElev /= side;
      } else {
        for (let i = 0; i < side; i += 1) {
          poleElev += elevationGrid.data[N * side + i]!;
        }
        poleElev /= side;
      }

      lonLatToVec3(poleLon, poleLat, poleElev * this.exaggeration, tmp);
      const poleIdx = side * side;
      const posList = Array.from(positions);
      posList.push(tmp.x, tmp.y, tmp.z);
      const uvList = Array.from(uvs);
      uvList.push(0.5, polar === "north" ? 0 : 1);

      const idxList: number[] = Array.from(indices);
      const edgeRow = polar === "north" ? 0 : N;
      for (let i = 0; i < N; i += 1) {
        const a = edgeRow * side + i;
        const b = edgeRow * side + i + 1;
        if (polar === "north") {
          idxList.push(poleIdx, b, a);
        } else {
          idxList.push(poleIdx, a, b);
        }
      }

      finalPositions = new Float32Array(posList);
      finalUvs = new Float32Array(uvList);
      finalIndices = new Uint16Array(idxList);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(finalPositions, 3),
    );
    geometry.setAttribute("uv", new THREE.BufferAttribute(finalUvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(finalIndices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return {
      geometry,
      elevationGrid,
    };
  }

  private disposeChildren(tile: GlobeTile): void {
    if (!tile.children) return;
    for (const child of tile.children) this.disposeTile(child);
    tile.children = null;
  }

  private disposeTile(tile: GlobeTile): void {
    tile.disposed = true;
    this.disposeChildren(tile);
    if (tile.mesh) {
      this.group.remove(tile.mesh);
      tile.mesh.geometry.dispose();
      const material = tile.mesh.material as THREE.MeshBasicMaterial;
      material.map?.dispose();
      material.dispose();
      tile.mesh = null;
    }
    tile.elevationGrid = null;
    tile.hasDem = false;
  }

  private formatUrl(template: string, tile: GlobeTile): string {
    return template
      .replace("{z}", String(tile.z))
      .replace("{x}", String(tile.x))
      .replace("{y}", String(tile.y));
  }

  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`瓦片加载失败:${url}`));
      img.src = url;
    });
  }
}

/** 便于按地名/经纬度计算根视角(预留工具)。 */
export function tileXYForLonLat(
  lonDeg: number,
  latDeg: number,
  zoom: number,
): { x: number; y: number } {
  return {
    x: Math.floor(lonToTileX(lonDeg, zoom)),
    y: Math.floor(latToTileY(latDeg, zoom)),
  };
}
