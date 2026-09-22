"use client";

/**
 * useRegionScene:区域场景主 Hook(必须在 R3F Canvas 内使用)。
 *
 * 接受经纬度/区域面积/模式/时段,负责整个 boot 状态机
 * (DEM → OSM → GPU 烘焙 → 场景构建),返回可挂载的世界与贴地探针。
 * 模式与时段变化不触发重建 —— 分别驱动相机 rig 与环境插值。
 */

import { useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import type { Renderer } from "three/webgpu";
import type { BootProgress, RegionParams } from "../types";
import { RegionWorld } from "../world/RegionWorld";

export type RegionSceneState = {
  progress: BootProgress;
  world: RegionWorld | null;
  error: string | null;
};

type BootState = {
  key: string;
  progress: BootProgress;
  world: RegionWorld | null;
  error: string | null;
};

const idleState = (key: string): BootState => ({
  key,
  progress: { status: "idle", value: 0 },
  world: null,
  error: null,
});

export function useRegionScene(
  params: RegionParams,
  onProgress?: (p: BootProgress) => void,
): RegionSceneState {
  const gl = useThree((s) => s.gl);
  const progressCb = useRef(onProgress);
  // 时段初值只在 boot 用一次,后续由下方 effect 驱动
  const initialTod = useRef(params.timeOfDay);

  const sizeKm = params.sizeKm;
  const seed = params.seed;
  const bootKey = `${params.lat},${params.lon},${sizeKm ?? ""},${seed ?? ""}`;

  const [state, setState] = useState<BootState>(() => idleState(bootKey));
  // 参数变化 → 渲染期重置(React 官方的 props 驱动状态重置模式)
  if (state.key !== bootKey) setState(idleState(bootKey));

  useEffect(() => {
    progressCb.current = onProgress;
  }, [onProgress]);

  useEffect(() => {
    let cancelled = false;
    const report = (p: BootProgress) => {
      if (cancelled) return;
      setState((prev) => (prev.key === bootKey ? { ...prev, progress: p } : prev));
      progressCb.current?.(p);
    };
    RegionWorld.create(
      gl as unknown as Renderer,
      {
        lat: params.lat,
        lon: params.lon,
        sizeKm,
        seed,
        mode: "fly",
        timeOfDay: initialTod.current,
      },
      report,
    )
      .then((w) => {
        if (cancelled) {
          w.dispose();
          return;
        }
        setState((prev) => (prev.key === bootKey ? { ...prev, world: w } : prev));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("[region-engine] boot failed", err);
        const message = err instanceof Error ? err.message : String(err);
        setState((prev) =>
          prev.key === bootKey ? { ...prev, error: message } : prev,
        );
        report({ status: "error", value: 0, detail: message });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootKey 已涵盖 lat/lon/sizeKm/seed
  }, [gl, bootKey]);

  const world = state.world;
  const error = state.error;
  const progress = state.progress;

  useEffect(() => {
    world?.env.setTimeOfDay(params.timeOfDay);
  }, [world, params.timeOfDay]);

  useEffect(() => {
    return () => {
      world?.dispose();
    };
  }, [world]);

  return { progress, world, error };
}
