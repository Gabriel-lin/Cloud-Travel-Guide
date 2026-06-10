"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { OrbitNavigationController } from "@/lib/navigation";
import {
  TiledDemTerrainProvider,
  type TerrainCenter,
} from "@/lib/terrain";
import type { TerrainBuildResult } from "@/lib/terrain";
import { SceneViewer } from "@/lib/viewer";

type Preset = TerrainCenter & {
  id: string;
  label: string;
  zoom?: number;
  exaggeration?: number;
};

/** 适合展示真实地形起伏的地点(无需任何 API Key)。 */
const PRESETS: readonly Preset[] = [
  { id: "fuji", label: "富士山", lat: 35.3606, lon: 138.7274, zoom: 12, exaggeration: 1.6 },
  { id: "grandcanyon", label: "大峡谷", lat: 36.1069, lon: -112.1129, zoom: 12, exaggeration: 1.4 },
  { id: "matterhorn", label: "马特洪峰", lat: 45.9763, lon: 7.6586, zoom: 12, exaggeration: 1.5 },
  { id: "everest", label: "珠穆朗玛峰", lat: 27.9881, lon: 86.925, zoom: 11, exaggeration: 1.4 },
  { id: "huangshan", label: "黄山", lat: 30.13, lon: 118.167, zoom: 12, exaggeration: 1.8 },
  { id: "yosemite", label: "优胜美地", lat: 37.745, lon: -119.533, zoom: 12, exaggeration: 1.6 },
];

export type RealTerrainExplorerProps = {
  className?: string;
};

/**
 * 免费真实地形可交互 Demo(独立组件,无需 API Key)。
 *
 * 通过 SceneViewer + TiledDemTerrainProvider 解码开放高程瓦片(AWS Terrarium)
 * 并叠加免费卫星影像(Esri),在 Three.js 中渲染真实地形,支持轨道导航与一键切换地点。
 */
export function RealTerrainExplorer({ className }: RealTerrainExplorerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<SceneViewer | null>(null);
  const terrainRef = useRef<TerrainBuildResult | null>(null);

  const [activePreset, setActivePreset] = useState<string>(PRESETS[0]!.id);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attribution, setAttribution] = useState("");
  const [error, setError] = useState<string | null>(null);

  // 创建查看器与导航控制器(仅一次)。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let viewer: SceneViewer;
    try {
      viewer = new SceneViewer({
        container,
        fov: 55,
        near: 1,
        far: 1e7,
        background: 0x9ec5e8,
      });
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "无法创建 WebGL 上下文(可能不支持)。";
      queueMicrotask(() => {
        setError(message);
        setStatus("error");
      });
      return;
    }

    viewerRef.current = viewer;
    viewer.setNavigation(
      new OrbitNavigationController({
        camera: viewer.camera,
        domElement: viewer.context.domElement,
        enableDamping: true,
      }),
    );
    viewer.start();

    return () => {
      terrainRef.current?.dispose();
      terrainRef.current = null;
      viewer.dispose();
      viewerRef.current = null;
    };
  }, []);

  // 按当前地点(重新)构建地形。
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const preset = PRESETS.find((p) => p.id === activePreset) ?? PRESETS[0]!;
    const provider = new TiledDemTerrainProvider({
      center: { lat: preset.lat, lon: preset.lon },
      zoom: preset.zoom,
      exaggeration: preset.exaggeration,
    });

    let cancelled = false;
    const run = async () => {
      setStatus("loading");
      setError(null);
      try {
        const result = await provider.build();
        if (cancelled) {
          result.dispose();
          return;
        }
        terrainRef.current?.dispose();
        if (terrainRef.current) viewer.remove(terrainRef.current.object);
        terrainRef.current = result;
        viewer.add(result.object);
        viewer.frame(result.object);
        setAttribution(provider.getAttribution());
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "地形加载失败。");
        setStatus("error");
      }
    };
    run();

    return () => {
      cancelled = true;
    };
  }, [activePreset]);

  const handlePreset = useCallback((preset: Preset) => {
    setActivePreset(preset.id);
  }, []);

  return (
    <div className={`relative overflow-hidden ${className ?? ""}`}>
      <div ref={containerRef} className="h-full w-full" />

      <div className="pointer-events-auto absolute left-3 top-3 flex max-w-[80%] flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => handlePreset(preset)}
            className={`rounded-full px-3 py-1 text-xs font-medium backdrop-blur transition ${
              activePreset === preset.id
                ? "bg-brand-600 text-white"
                : "bg-slate-900/60 text-slate-200 hover:bg-slate-900/80"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="pointer-events-none absolute right-3 top-3 rounded-lg bg-slate-900/60 px-3 py-2 text-xs text-slate-300 backdrop-blur">
        免费 · 无需 Key · 拖拽旋转 / 滚轮缩放
      </div>

      {status === "loading" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rounded-lg bg-slate-900/70 px-4 py-2 text-sm text-slate-100 backdrop-blur">
            正在加载真实地形…
          </span>
        </div>
      ) : null}

      {attribution ? (
        <div className="pointer-events-none absolute bottom-2 left-2 right-2 truncate rounded bg-black/50 px-2 py-1 text-[10px] text-slate-300">
          {attribution}
        </div>
      ) : null}

      {error ? (
        <div className="absolute inset-x-3 bottom-8 rounded-lg bg-red-950/80 px-3 py-2 text-xs text-red-200 backdrop-blur">
          {error}
        </div>
      ) : null}
    </div>
  );
}
