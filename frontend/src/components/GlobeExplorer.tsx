"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { EARTH_RADIUS, Globe, vec3ToLonLat } from "@/lib/globe";
import { OrbitNavigationController } from "@/lib/navigation";
import { SceneViewer } from "@/lib/viewer";

import { GlobeViewGizmo } from "./GlobeViewGizmo";

type Preset = {
  id: string;
  label: string;
  lat: number;
  lon: number;
  altitude: number;
};

type Layer = {
  id: string;
  label: string;
  url: string;
  attribution: string;
};

const DEM_ATTR = "高程: Mapzen / AWS Terrain Tiles";

const LAYERS: readonly Layer[] = [
  {
    id: "sat",
    label: "卫星影像",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: `影像: Esri, Maxar, Earthstar Geographics · ${DEM_ATTR}`,
  },
  {
    id: "topo",
    label: "地形图",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: `地图: Esri · ${DEM_ATTR}`,
  },
  {
    id: "street",
    label: "街道",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: `地图: Esri · ${DEM_ATTR}`,
  },
];

const PRESETS: readonly Preset[] = [
  { id: "space", label: "地球", lat: 20, lon: 30, altitude: EARTH_RADIUS * 1.8 },
  { id: "everest", label: "珠穆朗玛峰", lat: 27.9881, lon: 86.925, altitude: 45000 },
];

export type GlobeExplorerProps = {
  className?: string;
};

/**
 * 3D 地球 + 动态地形 Demo(独立组件,无需 API Key)。
 */
export function GlobeExplorer({ className }: GlobeExplorerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<SceneViewer | null>(null);
  const globeRef = useRef<Globe | null>(null);
  const navRef = useRef<OrbitNavigationController | null>(null);
  const orbitTargetRef = useRef(new THREE.Vector3());

  const [coords, setCoords] = useState<{ lat: number; lon: number; alt: number } | null>(
    null,
  );
  const [streaming, setStreaming] = useState(false);
  const [attribution, setAttribution] = useState("");
  const [activeLayer, setActiveLayer] = useState<string>(LAYERS[0]!.id);
  const [error, setError] = useState<string | null>(null);
  const [viewHandles, setViewHandles] = useState<{
    camera: THREE.PerspectiveCamera | null;
    controls: OrbitControls | null;
  }>({ camera: null, controls: null });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let viewer: SceneViewer;
    try {
      viewer = new SceneViewer({
        container,
        fov: 50,
        near: 1,
        far: EARTH_RADIUS * 8,
        cameraPosition: [0, EARTH_RADIUS * 0.6, EARTH_RADIUS * 2.6],
        background: 0x05070d,
        rendererParameters: { logarithmicDepthBuffer: true },
      });
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "无法创建 WebGL 上下文(可能不支持)。";
      queueMicrotask(() => setError(message));
      return;
    }

    viewerRef.current = viewer;

    const nav = new OrbitNavigationController({
      camera: viewer.camera,
      domElement: viewer.context.domElement,
      enableDamping: true,
      minDistance: 2,
      maxDistance: EARTH_RADIUS * 6,
    });
    navRef.current = nav;
    const controls = nav.orbitControls;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
    controls.zoomSpeed = 1.2;
    controls.rotateSpeed = 0.85;
    viewer.setNavigation(nav);

    const globe = new Globe({ context: viewer.context, minClearance: 2 });
    globeRef.current = globe;
    viewer.addUpdatable(globe);

    const { lat, lon } = vec3ToLonLat(viewer.camera.position);
    const { minDistance } = globe.placeOrbitTargetAt(
      lat,
      lon,
      orbitTargetRef.current,
    );
    controls.target.copy(orbitTargetRef.current);
    controls.minDistance = minDistance;
    viewer.camera.lookAt(orbitTargetRef.current);

    viewer.addRenderCallback(() => {
      const g = globeRef.current;
      const n = navRef.current;
      if (!g || !n) return;
      const { minDistance: minDist } = g.snapOrbitTargetOntoSurface(
        n.orbitControls.target,
      );
      n.orbitControls.minDistance = minDist;
      g.clampCameraToTerrain();
    });

    queueMicrotask(() => {
      setAttribution(globe.getAttribution());
      setViewHandles({ camera: viewer.camera, controls });
    });

    viewer.start();

    const statusTimer = window.setInterval(() => {
      const g = globeRef.current;
      if (!g) return;
      const sub = g.getSubPoint();
      setCoords({ lat: sub.lat, lon: sub.lon, alt: sub.altitude });
      setStreaming(g.loading);
    }, 400);

    return () => {
      window.clearInterval(statusTimer);
      viewer.dispose();
      viewerRef.current = null;
      globeRef.current = null;
      navRef.current = null;
      setViewHandles({ camera: null, controls: null });
    };
  }, []);

  const handlePreset = useCallback((preset: Preset) => {
    const globe = globeRef.current;
    const nav = navRef.current;
    if (!globe || !nav) return;
    globe.flyTo(preset.lat, preset.lon, preset.altitude);
    globe.placeOrbitTargetAt(preset.lat, preset.lon, orbitTargetRef.current);
    nav.orbitControls.target.copy(orbitTargetRef.current);
  }, []);

  const handleLayer = useCallback((layer: Layer) => {
    globeRef.current?.setImageryLayer(layer.url, layer.attribution);
    setActiveLayer(layer.id);
    setAttribution(layer.attribution);
  }, []);

  const formatAlt = (alt: number): string =>
    alt >= 1000 ? `${(alt / 1000).toFixed(1)} km` : `${Math.round(alt)} m`;

  return (
    <div className={`relative overflow-hidden ${className ?? ""}`}>
      <div ref={containerRef} className="absolute inset-0" />

      <div className="pointer-events-none absolute inset-0">
        <div className="pointer-events-auto absolute left-3 top-3 flex max-w-[85%] flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => handlePreset(preset)}
                className="rounded-full bg-slate-900/70 px-3 py-1 text-xs font-medium text-slate-200 backdrop-blur transition hover:bg-slate-900/90"
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {LAYERS.map((layer) => (
              <button
                key={layer.id}
                type="button"
                onClick={() => handleLayer(layer)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium backdrop-blur transition ${
                  activeLayer === layer.id
                    ? "bg-brand-600 text-white"
                    : "bg-slate-800/70 text-slate-300 hover:bg-slate-800/90"
                }`}
              >
                {layer.label}
              </button>
            ))}
          </div>
        </div>

        <div className="absolute right-3 top-3 space-y-1 text-right">
          <div className="rounded-lg bg-slate-900/70 px-3 py-2 text-xs text-slate-300 backdrop-blur">
            左键旋转 · 滚轮缩放 · 右键平移 · 右下角拖动视角球
          </div>
          {coords ? (
            <div className="rounded-lg bg-slate-900/70 px-3 py-2 font-mono text-[11px] text-slate-200 backdrop-blur">
              {coords.lat.toFixed(3)}°, {coords.lon.toFixed(3)}°
              <br />
              高度 {formatAlt(coords.alt)}
            </div>
          ) : null}
          {streaming ? (
            <div className="rounded-lg bg-brand-600/80 px-3 py-1 text-[11px] text-white backdrop-blur">
              ● 动态加载地形中…
            </div>
          ) : null}
        </div>

        <GlobeViewGizmo
          camera={viewHandles.camera}
          controls={viewHandles.controls}
          className="absolute bottom-10 right-3"
        />

        {attribution ? (
          <div className="absolute bottom-2 left-2 right-32 truncate rounded bg-black/50 px-2 py-1 text-[10px] text-slate-300 backdrop-blur">
            {attribution}
          </div>
        ) : null}

        {error ? (
          <div className="absolute inset-x-3 bottom-28 rounded-lg bg-red-950/80 px-3 py-2 text-xs text-red-200 backdrop-blur">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
