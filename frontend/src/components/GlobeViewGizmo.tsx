"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const SIZE = 120;
const CENTER = SIZE / 2;
const SPHERE_R = 42;
const DEG2RAD = Math.PI / 180;
const ROTATE_SPEED = 0.009;

type AxisDef = {
  id: string;
  label: string;
  color: string;
  direction: THREE.Vector3;
};

const AXES: readonly AxisDef[] = [
  { id: "posX", label: "X", color: "#f87171", direction: new THREE.Vector3(1, 0, 0) },
  { id: "negX", label: "X", color: "#f87171", direction: new THREE.Vector3(-1, 0, 0) },
  { id: "posY", label: "Y", color: "#4ade80", direction: new THREE.Vector3(0, 1, 0) },
  { id: "negY", label: "Y", color: "#4ade80", direction: new THREE.Vector3(0, -1, 0) },
  { id: "posZ", label: "Z", color: "#60a5fa", direction: new THREE.Vector3(0, 0, 1) },
  { id: "negZ", label: "Z", color: "#60a5fa", direction: new THREE.Vector3(0, 0, -1) },
];

type ProjectedPoint = { x: number; y: number; z: number };

type GizmoFrame = {
  meridians: string[];
  parallels: string[];
  axes: Array<{
    def: AxisDef;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    tipX: number;
    tipY: number;
    depth: number;
    front: boolean;
  }>;
  highlight: ProjectedPoint;
};

function projectUnit(
  dir: THREE.Vector3,
  invQuat: THREE.Quaternion,
  radius: number,
): ProjectedPoint {
  const v = dir.clone().applyQuaternion(invQuat);
  return {
    x: CENTER + v.x * radius,
    y: CENTER - v.y * radius,
    z: v.z,
  };
}

function latLonToUnit(latDeg: number, lonDeg: number, target = new THREE.Vector3()): THREE.Vector3 {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  return target.set(
    Math.cos(lat) * Math.cos(lon),
    Math.sin(lat),
    Math.cos(lat) * Math.sin(lon),
  );
}

function buildFrame(quat: THREE.Quaternion): GizmoFrame {
  const inv = quat.clone().invert();
  const meridians: string[] = [];
  const parallels: string[] = [];

  for (let i = 0; i < 8; i += 1) {
    const lon = i * 45;
    const pts: string[] = [];
    for (let lat = -90; lat <= 90; lat += 9) {
      const p = projectUnit(latLonToUnit(lat, lon), inv, SPHERE_R);
      if (p.z > -0.08) pts.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    }
    if (pts.length > 1) meridians.push(pts.join(" "));
  }

  for (let j = 1; j < 5; j += 1) {
    const lat = -60 + j * 30;
    const pts: string[] = [];
    for (let lon = -180; lon <= 180; lon += 12) {
      const p = projectUnit(latLonToUnit(lat, lon), inv, SPHERE_R);
      if (p.z > -0.08) pts.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    }
    if (pts.length > 1) parallels.push(pts.join(" "));
  }

  const axes = AXES.map((def) => {
    const tip = projectUnit(def.direction, inv, SPHERE_R);
    const tail = projectUnit(def.direction.clone().negate(), inv, SPHERE_R * 0.15);
    return {
      def,
      x1: tail.x,
      y1: tail.y,
      x2: tip.x,
      y2: tip.y,
      tipX: tip.x,
      tipY: tip.y,
      depth: tip.z,
      front: tip.z > 0.12,
    };
  }).sort((a, b) => a.depth - b.depth);

  const highlight = projectUnit(new THREE.Vector3(0.35, 0.55, 0.75), inv, SPHERE_R * 0.55);

  return { meridians, parallels, axes, highlight };
}

function orbitCameraByDrag(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  dx: number,
  dy: number,
): void {
  const offset = camera.position.clone().sub(controls.target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  spherical.theta -= dx * ROTATE_SPEED;
  spherical.phi = THREE.MathUtils.clamp(
    spherical.phi + dy * ROTATE_SPEED,
    controls.minPolarAngle + 0.001,
    controls.maxPolarAngle - 0.001,
  );
  offset.setFromSpherical(spherical);
  camera.position.copy(controls.target).add(offset);
  controls.update();
}

function snapCameraToAxis(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  direction: THREE.Vector3,
): void {
  const target = controls.target;
  const offset = camera.position.clone().sub(target);
  const dist = Math.max(offset.length(), controls.minDistance + 1);
  const viewDir = direction.clone().normalize();
  camera.position.copy(target).addScaledVector(viewDir, dist);

  const worldUp = new THREE.Vector3(0, 1, 0);
  if (Math.abs(viewDir.dot(worldUp)) > 0.95) {
    camera.up.set(0, 0, viewDir.y > 0 ? -1 : 1);
  } else {
    camera.up.copy(worldUp);
  }
  controls.update();
}

export type GlobeViewGizmoProps = {
  camera: THREE.PerspectiveCamera | null;
  controls: OrbitControls | null;
  className?: string;
};

/**
 * Blender 风格视角球:可拖动旋转视角,点击轴端对齐正交视图。
 */
export function GlobeViewGizmo({ camera, controls, className }: GlobeViewGizmoProps) {
  const [frame, setFrame] = useState<GizmoFrame>(() => buildFrame(new THREE.Quaternion()));
  const [dragging, setDragging] = useState(false);
  const rafRef = useRef(0);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!camera) return;
    let tick = 0;
    const loop = () => {
      tick += 1;
      if (tick % 2 === 0) setFrame(buildFrame(camera.quaternion));
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [camera]);

  const applyDrag = useCallback(
    (dx: number, dy: number) => {
      if (!camera || !controls) return;
      orbitCameraByDrag(camera, controls, dx, dy);
    },
    [camera, controls],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!camera || !controls) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      setDragging(true);
    },
    [camera, controls],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging || !lastPointerRef.current) return;
      const dx = e.clientX - lastPointerRef.current.x;
      const dy = e.clientY - lastPointerRef.current.y;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      if (dx !== 0 || dy !== 0) applyDrag(dx, dy);
    },
    [applyDrag, dragging],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    lastPointerRef.current = null;
    setDragging(false);
  }, []);

  const onAxisSnap = useCallback(
    (axis: AxisDef) => {
      if (!camera || !controls) return;
      snapCameraToAxis(camera, controls, axis.direction);
    },
    [camera, controls],
  );

  return (
    <div
      ref={rootRef}
      className={`pointer-events-auto select-none ${className ?? ""}`}
      style={{ touchAction: "none", width: SIZE, height: SIZE }}
      title="拖动球体旋转视角 · 点击轴端对齐"
    >
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className={`overflow-visible ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
        aria-label="视角控制器"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <defs>
          <radialGradient id="gizmo-sphere" cx="38%" cy="32%" r="68%">
            <stop offset="0%" stopColor="#94a3b8" />
            <stop offset="45%" stopColor="#475569" />
            <stop offset="100%" stopColor="#1e293b" />
          </radialGradient>
          <radialGradient id="gizmo-highlight" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.55)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
          <filter id="gizmo-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity="0.45" />
          </filter>
          <clipPath id="gizmo-clip">
            <circle cx={CENTER} cy={CENTER} r={SPHERE_R} />
          </clipPath>
        </defs>

        {/* 外圈光晕 */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={SPHERE_R + 5}
          fill="none"
          stroke="rgba(148,163,184,0.18)"
          strokeWidth={1}
        />

        {/* 球体主体 */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={SPHERE_R}
          fill="url(#gizmo-sphere)"
          filter="url(#gizmo-glow)"
          stroke="rgba(203,213,225,0.25)"
          strokeWidth={1}
        />

        {/* 经纬网格 */}
        <g clipPath="url(#gizmo-clip)" opacity={0.45}>
          {frame.parallels.map((pts, i) => (
            <polyline
              key={`par-${i}`}
              points={pts}
              fill="none"
              stroke="rgba(226,232,240,0.35)"
              strokeWidth={0.75}
            />
          ))}
          {frame.meridians.map((pts, i) => (
            <polyline
              key={`mer-${i}`}
              points={pts}
              fill="none"
              stroke="rgba(226,232,240,0.28)"
              strokeWidth={0.75}
            />
          ))}
        </g>

        {/* 高光 */}
        <ellipse
          cx={frame.highlight.x}
          cy={frame.highlight.y}
          rx={14}
          ry={10}
          fill="url(#gizmo-highlight)"
          pointerEvents="none"
        />

        {/* 坐标轴 */}
        {frame.axes.map(({ def, x1, y1, x2, y2, tipX, tipY, front }) => (
          <g key={def.id} opacity={front ? 1 : 0.35}>
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={def.color}
              strokeWidth={def.id.includes("Y") ? 2.4 : 2}
              strokeLinecap="round"
              pointerEvents="none"
            />
            {front ? (
              <g
                className="cursor-pointer"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onAxisSnap(def)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onAxisSnap(def);
                }}
                role="button"
                tabIndex={0}
                aria-label={`对齐 ${def.label} 轴`}
              >
                <circle cx={tipX} cy={tipY} r={10} fill="rgba(15,23,42,0.75)" />
                <circle
                  cx={tipX}
                  cy={tipY}
                  r={8}
                  fill={def.color}
                  stroke="rgba(255,255,255,0.65)"
                  strokeWidth={1}
                />
                <text
                  x={tipX}
                  y={tipY + 3.5}
                  textAnchor="middle"
                  fontSize={8}
                  fontWeight={800}
                  fill="#0f172a"
                  pointerEvents="none"
                >
                  {def.label}
                </text>
              </g>
            ) : null}
          </g>
        ))}

        {/* 透明拖拽热区(覆盖球体) */}
        <circle cx={CENTER} cy={CENTER} r={SPHERE_R} fill="transparent" />
      </svg>
    </div>
  );
}
