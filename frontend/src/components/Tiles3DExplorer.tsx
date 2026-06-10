"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  Tiles3DTerrainProvider,
  type GeoLocation,
} from "@/lib/terrain";
import { SceneViewer } from "@/lib/viewer";

type Preset = GeoLocation & { id: string; label: string };

/** 预置可一键切换的实景三维地点。 */
const PRESETS: readonly Preset[] = [
  { id: "bund", label: "上海 · 外滩", lat: 31.24, lon: 121.49, height: 0 },
  { id: "forbidden", label: "北京 · 故宫", lat: 39.9163, lon: 116.3972, height: 0 },
  { id: "tokyo", label: "东京塔", lat: 35.6586, lon: 139.7454, height: 0 },
  { id: "eiffel", label: "巴黎 · 埃菲尔铁塔", lat: 48.8584, lon: 2.2945, height: 0 },
  { id: "manhattan", label: "纽约 · 曼哈顿", lat: 40.758, lon: -73.9855, height: 0 },
  { id: "grandcanyon", label: "美国 · 大峡谷", lat: 36.1069, lon: -112.1129, height: 0 },
];

export type Tiles3DExplorerProps = {
  className?: string;
  /** Google Maps Platform API Key;不传则读取 NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,再回退到输入框。 */
  apiKey?: string;
};

/**
 * 大范围实景三维可交互 Demo(独立组件)。
 *
 * 通过 SceneViewer 总装类 + Tiles3DTerrainProvider 在 Three.js 场景内
 * 流式加载 Google 实景三维(Photorealistic 3D Tiles),支持地球级导航
 * 与一键切换城市。需要 Google Maps Platform API Key(启用 Map Tiles API)。
 */
export function Tiles3DExplorer({ className, apiKey }: Tiles3DExplorerProps) {
  const envKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const initialKey = apiKey ?? envKey ?? "";

  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<SceneViewer | null>(null);
  const providerRef = useRef<Tiles3DTerrainProvider | null>(null);

  const [keyInput, setKeyInput] = useState(initialKey);
  const [activeKey, setActiveKey] = useState(initialKey);
  const [started, setStarted] = useState(Boolean(initialKey));
  const [activePreset, setActivePreset] = useState<string>(PRESETS[0]!.id);
  const activePresetRef = useRef(PRESETS[0]!.id);
  const [attributions, setAttributions] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!started || !activeKey) return;
    const container = containerRef.current;
    if (!container) return;

    let viewer: SceneViewer;
    try {
      viewer = new SceneViewer({
        container,
        fov: 60,
        near: 1,
        far: 1e8,
        background: 0x9ec5e8,
        rendererParameters: { logarithmicDepthBuffer: true },
      });
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "无法创建 WebGL 上下文(可能不支持)。";
      queueMicrotask(() => setError(message));
      return;
    }

    viewerRef.current = viewer;

    const start = PRESETS.find((p) => p.id === activePresetRef.current) ?? PRESETS[0]!;
    const provider = new Tiles3DTerrainProvider({
      context: viewer.context,
      source: { type: "google", apiToken: activeKey },
      reorientation: start,
      onAttributionsChange: setAttributions,
      onLoadError: (err) =>
        setError(`实景三维加载失败:${err.message}(请检查 API Key 与 Map Tiles API 是否已启用)`),
    });
    providerRef.current = provider;
    viewer.addUpdatable(provider);
    viewer.start();

    return () => {
      viewer.dispose();
      viewerRef.current = null;
      providerRef.current = null;
    };
  }, [started, activeKey]);

  const handleLoad = useCallback(() => {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    setError(null);
    setActiveKey(trimmed);
    setStarted(true);
  }, [keyInput]);

  const handlePreset = useCallback((preset: Preset) => {
    activePresetRef.current = preset.id;
    setActivePreset(preset.id);
    providerRef.current?.setView(preset);
  }, []);

  if (!started) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-4 bg-slate-900 p-8 text-center ${className ?? ""}`}
      >
        <div className="max-w-md space-y-3">
          <h3 className="text-lg font-semibold text-slate-100">
            实景三维导览 Demo
          </h3>
          <p className="text-sm text-slate-400">
            输入 Google Maps Platform API Key 以加载全球实景三维(Photorealistic 3D
            Tiles)。需在 Google Cloud 控制台启用 <span className="font-mono">Map Tiles API</span>。
          </p>
        </div>
        <div className="flex w-full max-w-md gap-2">
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLoad()}
            placeholder="粘贴 Google Maps API Key"
            className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-500"
          />
          <button
            type="button"
            onClick={handleLoad}
            disabled={!keyInput.trim()}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            加载
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden ${className ?? ""}`}>
      <div ref={containerRef} className="h-full w-full" />

      {/* 地点切换面板 */}
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

      {/* 操作提示 */}
      <div className="pointer-events-none absolute right-3 top-3 rounded-lg bg-slate-900/60 px-3 py-2 text-xs text-slate-300 backdrop-blur">
        拖拽旋转 · 滚轮缩放 · 右键平移
      </div>

      {/* 数据归属(Google 使用条款要求展示) */}
      {attributions ? (
        <div className="pointer-events-none absolute bottom-2 left-2 right-2 truncate rounded bg-black/50 px-2 py-1 text-[10px] text-slate-300">
          {attributions}
        </div>
      ) : null}

      {/* 错误提示 */}
      {error ? (
        <div className="absolute inset-x-3 bottom-8 rounded-lg bg-red-950/80 px-3 py-2 text-xs text-red-200 backdrop-blur">
          {error}
        </div>
      ) : null}
    </div>
  );
}
