/**
 * RegionWorld:区域世界总装。
 *
 * boot(一次):DEM → OSM → 光栅化 → GPU 流水线(放大/侵蚀/河道/湿度/生物群系)
 *            → 散布 → 世界纹理 → 各渲染系统(地形/水/植被/建筑/天空/云/粒子/光照)。
 * 每帧:环境推进(昼夜/风/时间)→ CDLOD 四叉树 → 植被近景环 → 光照/雾跟随。
 */

import {
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  PerspectiveCamera,
  Vector3,
} from "three";
import type { Renderer } from "three/webgpu";
import { DEFAULT_SIZE_KM } from "../const";
import { fetchDem } from "../geo/terrarium";
import { fetchOsm } from "../geo/overpass";
import { createProjector } from "../geo/project";
import { rasterizeMasks } from "../geo/rasterize";
import { runWorldPipeline } from "../gpu/pipeline";
import type { GroundProbe } from "../camera/WalkFlyRig";
import { cloudShadowFactor, createCloudLayer } from "../render/clouds";
import { EnvState } from "../render/env";
import {
  buildWorldTextures,
  sampleCpu,
  sampleWaterCpu,
} from "../render/fields";
import { createSkyDome, skyHorizonRgb } from "../render/skyAtmosphere";
import { scatterWorld } from "../veg/scatter";
import type { BootProgress, RegionParams, WorldFields } from "../types";
import { createBuildings } from "./Buildings";
import { createAmbientParticles, createFireflies } from "./Particles";
import { TerrainTiles } from "./TerrainTiles";
import { Vegetation } from "./Vegetation";
import { createWaterSurface } from "./WaterSurface";

export type ProgressFn = (p: BootProgress) => void;

const SHADOW_RANGE = 150;

export class RegionWorld {
  readonly group = new Group();
  readonly env = new EnvState();
  readonly fog = new FogExp2(0xcdd8e4, 0.00016);
  readonly groundProbe: GroundProbe;

  private terrain!: TerrainTiles;
  private vegetation!: Vegetation;
  private sky!: ReturnType<typeof createSkyDome>;
  private sun!: DirectionalLight;
  private hemi!: HemisphereLight;
  private fireflies!: ReturnType<typeof createFireflies>;
  private tmpColor = new Color();
  private tmpVec = new Vector3();

  private constructor(readonly fields: WorldFields) {
    const { res, size } = fields;
    this.groundProbe = (x: number, z: number) => ({
      ground: sampleCpu(fields.heights, x, z, res, size),
      water: sampleWaterCpu(fields.waterY, x, z, res, size),
    });
  }

  static async create(
    renderer: Renderer,
    params: RegionParams,
    onProgress: ProgressFn,
  ): Promise<RegionWorld> {
    const sizeM = (params.sizeKm ?? DEFAULT_SIZE_KM) * 1000;
    const seed =
      params.seed ?? (Math.round(params.lat * 1e4) * 31 + Math.round(params.lon * 1e4)) >>> 0;
    const proj = createProjector(params.lat, params.lon);

    // 1. DEM
    onProgress({ status: "fetching-dem", value: 0.02 });
    const dem = await fetchDem(proj, sizeM, (v) =>
      onProgress({ status: "fetching-dem", value: 0.02 + v * 0.14 }),
    );

    // 2. OSM 矢量 + 光栅化
    onProgress({ status: "fetching-osm", value: 0.17 });
    const osm = await fetchOsm(proj, sizeM, (v) =>
      onProgress({ status: "fetching-osm", value: 0.17 + v * 0.12 }),
    );
    const masks = rasterizeMasks(osm, dem.res, sizeM);

    // 3. GPU 流水线(WebGPU compute / CPU 降级)
    const backend = (renderer as unknown as { backend?: { isWebGLBackend?: boolean } }).backend;
    const gpuCompute = !backend?.isWebGLBackend;
    const fields = await runWorldPipeline({
      renderer,
      gpuCompute,
      dem,
      masks,
      seed,
      onProgress: (v, detail) =>
        onProgress({ status: "gpu-bake", value: 0.3 + v * 0.42, detail }),
    });

    // 4. 散布 + 场景构建
    onProgress({ status: "building", value: 0.74, detail: "scatter" });
    const world = new RegionWorld(fields);
    const env = world.env;
    env.setTimeOfDay(params.timeOfDay);
    env.nightK.value = params.timeOfDay === "night" ? 1 : 0;

    const scatter = scatterWorld(fields);
    const tex = buildWorldTextures(fields);

    onProgress({ status: "building", value: 0.8, detail: "terrain" });
    world.terrain = new TerrainTiles(tex, env, fields.heights, {
      cloudShadow: cloudShadowFactor(env),
    });
    world.group.add(world.terrain.mesh);
    world.group.add(createWaterSurface(tex, env));

    onProgress({ status: "building", value: 0.86, detail: "vegetation" });
    world.vegetation = new Vegetation(renderer, env, fields, scatter);
    await world.vegetation.init();
    world.group.add(world.vegetation.group);

    onProgress({ status: "building", value: 0.93, detail: "buildings" });
    world.group.add(createBuildings(osm, fields, env));

    // 天空/云/粒子/光照
    world.sky = createSkyDome(env);
    world.group.add(world.sky);
    world.group.add(createCloudLayer(env, fields.size));
    world.fireflies = createFireflies(env, scatter.fireflySpots);
    world.group.add(world.fireflies);
    world.group.add(createAmbientParticles(env));

    world.sun = new DirectionalLight(0xffffff, 3.2);
    world.sun.castShadow = true;
    world.sun.shadow.mapSize.set(2048, 2048);
    world.sun.shadow.camera.left = -SHADOW_RANGE;
    world.sun.shadow.camera.right = SHADOW_RANGE;
    world.sun.shadow.camera.top = SHADOW_RANGE;
    world.sun.shadow.camera.bottom = -SHADOW_RANGE;
    world.sun.shadow.camera.near = 1;
    world.sun.shadow.camera.far = 900;
    world.sun.shadow.bias = -0.0004;
    world.sun.shadow.normalBias = 0.5;
    world.group.add(world.sun);
    world.group.add(world.sun.target);
    world.hemi = new HemisphereLight(0xbfd4e8, 0x54503c, 0.55);
    world.group.add(world.hemi);

    onProgress({ status: "ready", value: 1 });
    return world;
  }

  /** 出生点:区域中心地表(或水面)上方 */
  spawnPoint(): Vector3 {
    const g = this.groundProbe(0, 0);
    return new Vector3(0, Math.max(g.ground, g.water) + 1.7, 0);
  }

  update(camera: PerspectiveCamera, dt: number): void {
    this.env.update(Math.min(dt, 0.1));
    this.terrain.update(camera);
    this.vegetation.update(camera);

    // 天空穹顶跟随相机
    this.sky.position.copy(camera.position);

    // 太阳跟随相机(近景阴影盒)
    const sunDir = this.env.sunDir.value as Vector3;
    this.sun.position.copy(camera.position).addScaledVector(sunDir, 420);
    this.sun.target.position.copy(camera.position);
    this.env.sunColor(this.tmpColor);
    this.sun.color.copy(this.tmpColor);
    this.sun.intensity = this.env.sunIntensity();
    this.hemi.intensity = this.env.ambientIntensity();

    // 雾色随昼夜
    const nightK = this.env.nightK.value as number;
    const [r, g, b] = skyHorizonRgb(nightK);
    this.fog.color.setRGB(r, g, b);
    this.fog.density = 0.00016 + nightK * 0.00006;

    // 萤火虫只在夜间绘制
    this.fireflies.visible = nightK > 0.03;
    void this.tmpVec;
  }
}
