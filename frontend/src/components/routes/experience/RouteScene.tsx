"use client";

import { PerformanceMonitor, Stats } from "@react-three/drei";
import { Canvas, events as createPointerEvents, useFrame, useThree } from "@react-three/fiber";
import { AlertTriangle } from "lucide-react";
import {
  Component,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PerspectiveCamera } from "three";
import { WebGPURenderer, type Renderer, type RenderPipeline } from "three/webgpu";

import { useAppLocale } from "@/hooks/use-app-locale";
import { WalkFlyRig } from "@/lib/region-engine/camera/WalkFlyRig";
import { useRegionScene } from "@/lib/region-engine/hooks/useRegionScene";
import { createRegionPostFX } from "@/lib/region-engine/render/postfx";
import type {
  BootProgress,
  RegionParams,
  SceneMode,
} from "@/lib/region-engine/types";
import { cn } from "@/lib/utils";

import type { RouteExperienceConfig, RouteToolbarState } from "./types";

export type RouteSceneProps = {
  config: RouteExperienceConfig;
  state: RouteToolbarState;
  /** 当前站点下标（俯视图选中,场景加载该站点的真实地理区域） */
  activeStopIndex?: number;
  /** 场景内交互(V 键切换模式)同步回工具栏 */
  onStateChange?: (patch: Partial<RouteToolbarState>) => void;
};

/**
 * R3F Canvas 在 WebGPU 异步 init / HMR 卸载后仍可能把 null 传给 events.connect,
 * 默认实现会直接 target.addEventListener → 整页 Uncaught TypeError。
 */
function createSafePointerEvents(
  store: Parameters<typeof createPointerEvents>[0],
) {
  const manager = createPointerEvents(store);
  const connect = manager.connect?.bind(manager);
  manager.connect = (target) => {
    if (!target) return;
    connect?.(target);
  };
  return manager;
}

/** WebGPU 优先,初始化失败自动回退 WebGL2(三方案见 docs/regional-terrain-engine-plan.md) */
async function createRenderer(props: unknown): Promise<WebGPURenderer> {
  const base = props as ConstructorParameters<typeof WebGPURenderer>[0];
  const requiredLimits: Record<string, number> = {};
  try {
    const gpu = (
      navigator as Navigator & {
        gpu?: {
          requestAdapter: () => Promise<{
            limits: { maxStorageBuffersPerShaderStage: number };
          } | null>;
        };
      }
    ).gpu;
    const adapter = await gpu?.requestAdapter();
    const maxSb = adapter?.limits.maxStorageBuffersPerShaderStage ?? 0;
    if (maxSb >= 12) {
      requiredLimits.maxStorageBuffersPerShaderStage = Math.min(maxSb, 16);
    }
  } catch {
    /* adapter 查询失败则走默认限额 */
  }
  try {
    const renderer = new WebGPURenderer({ ...base, antialias: false, requiredLimits });
    await renderer.init();
    return renderer;
  } catch (err) {
    console.warn("[region-engine] WebGPU unavailable, falling back to WebGL2", err);
    const renderer = new WebGPURenderer({ ...base, antialias: false, forceWebGL: true });
    await renderer.init();
    return renderer;
  }
}

/** Canvas / 渲染器崩溃时的诊断边界(两个后端都失败等) */
class SceneErrorBoundary extends Component<
  { fallback: (message: string) => ReactNode; children: ReactNode },
  { message: string | null }
> {
  state = { message: null as string | null };

  static getDerivedStateFromError(err: unknown): { message: string } {
    return { message: err instanceof Error ? err.message : String(err) };
  }

  render() {
    if (this.state.message !== null) return this.props.fallback(this.state.message);
    return this.props.children;
  }
}

type SceneContentProps = {
  params: RegionParams;
  onProgress: (p: BootProgress) => void;
  onRigMode: (mode: SceneMode) => void;
};

/** Canvas 内部:boot 世界 + 相机 rig + 每帧推进 */
function SceneContent({ params, onProgress, onRigMode }: SceneContentProps) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const rigRef = useRef<WalkFlyRig | null>(null);
  const rigModeCb = useRef(onRigMode);

  const { world } = useRegionScene(params, onProgress);

  useEffect(() => {
    rigModeCb.current = onRigMode;
  }, [onRigMode]);

  useEffect(() => {
    const dom = gl.domElement;
    if (!dom) return;
    const rig = new WalkFlyRig(camera as PerspectiveCamera, dom);
    rig.onModeChange = (mode) => rigModeCb.current(mode);
    rigRef.current = rig;
    return () => {
      rig.dispose();
      rigRef.current = null;
    };
  }, [camera, gl]);

  // 世界就绪:安装贴地探针、出生位姿(中心上空俯瞰入场)
  useEffect(() => {
    const rig = rigRef.current;
    if (!world || !rig) return;
    rig.groundProbe = world.groundProbe;
    const spawn = world.spawnPoint();
    rig.setPose(spawn.x + 140, spawn.y + 220, spawn.z + 300, 0.42, -0.5);
    return () => {
      rig.groundProbe = null;
    };
  }, [world]);

  // 工具栏视角 → rig 模式(walk 需等待贴地探针)
  useEffect(() => {
    rigRef.current?.setMode(params.mode);
  }, [params.mode, world]);

  // 浏览器自动播放策略:首次指针/键盘手势解锁 AudioContext
  useEffect(() => {
    if (!world) return;
    return world.sound.installUnlock(gl.domElement);
  }, [world, gl]);

  useFrame((rootState, dt) => {
    rigRef.current?.update(dt);
    world?.update(rootState.camera as PerspectiveCamera, dt);
  });

  if (!world) return null;
  return (
    <>
      <primitive object={world.group} />
      {/* 雾挂到 scene.fog(R3F 声明式 attach,昼夜色由 world.update 每帧驱动) */}
      <primitive object={world.fog} attach="fog" />
      <RegionPostFX />
    </>
  );
}

/** 全屏 FXAA + 近景反锐化;priority>0 接管 R3F 默认 render */
function RegionPostFX() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const pipeRef = useRef<RenderPipeline | null>(null);

  useEffect(() => {
    try {
      const pipe = createRegionPostFX(gl as unknown as Renderer, scene, camera);
      pipeRef.current = pipe;
      return () => {
        pipe.dispose();
        pipeRef.current = null;
      };
    } catch (err) {
      console.warn("[region-engine] postfx skipped", err);
      pipeRef.current = null;
      return undefined;
    }
  }, [gl, scene, camera]);

  useFrame(() => {
    const pipe = pipeRef.current;
    if (pipe) pipe.render();
    else gl.render(scene, camera);
  }, 1);

  return null;
}

const BOOT_LABEL_KEYS: Record<BootProgress["status"], string> = {
  idle: "idle",
  "fetching-dem": "fetchingDem",
  "fetching-osm": "fetchingOsm",
  "gpu-bake": "gpuBake",
  building: "building",
  ready: "ready",
  error: "error",
};

/**
 * 场景模块:区域程序化地形引擎(region-engine)。
 *
 * R3F Canvas + WebGPU(回退 WebGL2)渲染站点真实地理场景:
 * DEM 地形 + OSM 水系/建筑/土地利用 + 程序化植被/天空/云/粒子。
 * 工具栏映射:第一人称 → walk(贴地),第三人称 → fly;Sun/Moon → 昼夜。
 */
export function RouteScene({
  config,
  state,
  activeStopIndex = 0,
  onStateChange,
}: RouteSceneProps) {
  const { t } = useAppLocale();
  const [progress, setProgress] = useState<BootProgress>({ status: "idle", value: 0 });
  // 质量分档:掉帧时降低渲染分辨率上限(low),恢复后升回(high)
  const [dprMax, setDprMax] = useState(1.5);

  const stop = config.stops[activeStopIndex] ?? config.stops[0];
  const params = useMemo<RegionParams>(
    () => ({
      lat: stop?.coord.lat ?? 30.57,
      lon: stop?.coord.lon ?? 104.07,
      sizeKm: 4,
      mode: state.viewMode === "first-person" ? "walk" : "fly",
      timeOfDay: state.lighting,
    }),
    [stop, state.viewMode, state.lighting],
  );

  const handleRigMode = useCallback(
    (mode: SceneMode) => {
      onStateChange?.({ viewMode: mode === "walk" ? "first-person" : "third-person" });
    },
    [onStateChange],
  );

  const booting = progress.status !== "ready" && progress.status !== "error";
  const failed = progress.status === "error";

  const diagnostics = (message: string) => (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="flex max-w-md flex-col items-center gap-3 rounded-2xl border border-surface-700/50 bg-surface-900/80 px-8 py-6 text-center shadow-xl backdrop-blur-md">
        <AlertTriangle className="size-8 text-amber-400" />
        <p className="text-sm font-medium text-ink-100">
          {t("routes.experience.scene.rendererError")}
        </p>
        <p className="break-all text-xs text-ink-400">{message}</p>
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        "absolute inset-0 z-0 overflow-hidden bg-surface-950",
        state.pointerTool === "hand" ? "cursor-grab" : "cursor-default",
      )}
      data-view-mode={state.viewMode}
    >
      <SceneErrorBoundary fallback={diagnostics}>
        <Canvas
          // WebGPURenderer(异步 init)为 R3F v9 支持的 promise 工厂
          gl={createRenderer as never}
          events={createSafePointerEvents}
          shadows
          dpr={[0.75, dprMax]}
          camera={{ fov: 62, near: 0.2, far: 30000, position: [140, 220, 300] }}
          frameloop="always"
        >
          <PerformanceMonitor
            onDecline={() => setDprMax(1)}
            onIncline={() => setDprMax(1.5)}
          >
            <SceneContent
              params={params}
              onProgress={setProgress}
              onRigMode={handleRigMode}
            />
          </PerformanceMonitor>
          {process.env.NODE_ENV === "development" && <Stats />}
        </Canvas>
      </SceneErrorBoundary>

      {/* boot 进度条 */}
      {booting && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-surface-950/60 backdrop-blur-sm">
          <div className="flex w-72 flex-col items-center gap-3 rounded-2xl border border-surface-700/50 bg-surface-900/70 px-8 py-6 shadow-xl">
            <p className="text-sm font-medium text-ink-100">
              {t(`${config.i18nKey}.stops.${stop?.id ?? ""}`)}
            </p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-800">
              <div
                className="h-full rounded-full bg-brand-500 transition-[width] duration-300"
                style={{ width: `${Math.round(progress.value * 100)}%` }}
              />
            </div>
            <p className="text-xs text-ink-400">
              {t(`routes.experience.scene.boot.${BOOT_LABEL_KEYS[progress.status]}`)}
              {progress.detail ? ` · ${progress.detail}` : ""}
            </p>
          </div>
        </div>
      )}

      {/* boot 失败诊断 */}
      {failed && diagnostics(progress.detail ?? "unknown error")}

      {/* 操作提示 */}
      {!booting && !failed && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-surface-900/60 px-4 py-1.5 text-[11px] text-ink-300 ring-1 ring-surface-700/50 backdrop-blur-sm">
          {t("routes.experience.scene.controls")}
        </div>
      )}
    </div>
  );
}
