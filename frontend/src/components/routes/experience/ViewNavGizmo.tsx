"use client";

import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** 检查卡片视角。对齐 Blender 导航球:点击轴切到该方向,拖动则绕视口旋转。 */
export type InspectView = "front" | "back" | "left" | "right" | "top" | "bottom" | "reset";

type V = readonly [number, number, number];
/** 行主序,把物体坐标变到视口:x 右,y 上,z 朝向观察者。 */
type M = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

const FRONT: M = [1, 0, 0, 0, 0, 1, 0, 1, 0];

const SNAPS: Record<Exclude<InspectView, "reset">, M> = {
  front: FRONT,
  back: [-1, 0, 0, 0, 0, 1, 0, -1, 0],
  right: [0, 1, 0, 0, 0, 1, 1, 0, 0],
  left: [0, -1, 0, 0, 0, 1, -1, 0, 0],
  top: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  bottom: [1, 0, 0, 0, -1, 0, 0, 0, -1],
};

const AXES: readonly {
  id: Exclude<InspectView, "reset">;
  v: V;
  color: string;
  label: string;
  positive: boolean;
}[] = [
  { id: "right", v: [1, 0, 0], color: "#ff3352", label: "X", positive: true },
  { id: "left", v: [-1, 0, 0], color: "#ff3352", label: "", positive: false },
  { id: "front", v: [0, 1, 0], color: "#8bdc00", label: "Y", positive: true },
  { id: "back", v: [0, -1, 0], color: "#8bdc00", label: "", positive: false },
  { id: "top", v: [0, 0, 1], color: "#2890ff", label: "Z", positive: true },
  { id: "bottom", v: [0, 0, -1], color: "#2890ff", label: "", positive: false },
];

const CX = 60;
const CY = 60;
const LEN = 34;

function apply(m: M, [x, y, z]: V): V {
  return [
    m[0] * x + m[1] * y + m[2] * z,
    m[3] * x + m[4] * y + m[5] * z,
    m[6] * x + m[7] * y + m[8] * z,
  ];
}

function mul(a: M, b: M): M {
  const o = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] =
        (a[r * 3] as number) * (b[c] as number) +
        (a[r * 3 + 1] as number) * (b[3 + c] as number) +
        (a[r * 3 + 2] as number) * (b[6 + c] as number);
    }
  }
  return o as unknown as M;
}

function rotX(a: number): M {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}

function rotY(a: number): M {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

function project(m: M, v: V): { x: number; y: number; z: number } {
  const [x, y, z] = apply(m, v);
  return { x: CX + x * LEN, y: CY - y * LEN, z };
}

export function ViewNavGizmo({
  label,
  axisLabel,
  onChange,
  className,
}: {
  label: string;
  axisLabel: (view: Exclude<InspectView, "reset">) => string;
  onChange?: (view: InspectView) => void;
  className?: string;
}) {
  const [mat, setMat] = useState<M>(FRONT);
  const [hot, setHot] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean; pointer: number } | null>(null);
  const matRef = useRef(mat);

  const tips = AXES.map((axis) => ({ ...axis, p: project(mat, axis.v) })).sort(
    (a, b) => a.p.z - b.p.z,
  );

  const hitAt = (clientX: number, clientY: number, svg: SVGSVGElement) => {
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 120;
    const y = ((clientY - rect.top) / rect.height) * 120;
    let best: (typeof tips)[number] | null = null;
    let bestD = 16;
    for (const tip of tips) {
      const dx = tip.p.x - x;
      const dy = tip.p.y - y;
      const d = Math.hypot(dx, dy);
      const limit = tip.positive ? 14 : 10;
      if (d < limit && d < bestD && tip.p.z > -0.35) {
        best = tip;
        bestD = d;
      }
    }
    return best;
  };

  return (
    <svg
      viewBox="0 0 120 120"
      className={cn("size-30 touch-none select-none", className)}
      role="group"
      aria-label={label}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, moved: false, pointer: e.pointerId };
      }}
      onPointerMove={(e) => {
        const svg = e.currentTarget as SVGSVGElement;
        const rect = svg.getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * 120;
        const py = ((e.clientY - rect.top) / rect.height) * 120;
        const nearest = (m: M) => {
          let id: string | null = null;
          let bestD = 16;
          for (const axis of AXES) {
            const p = project(m, axis.v);
            const dist = Math.hypot(p.x - px, p.y - py);
            const limit = axis.positive ? 14 : 10;
            if (dist < limit && dist < bestD && p.z > -0.35) {
              bestD = dist;
              id = axis.id;
            }
          }
          return id;
        };
        const d = drag.current;
        if (!d || d.pointer !== e.pointerId) {
          setHot(nearest(matRef.current));
          return;
        }
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (!d.moved && dx * dx + dy * dy < 16) return;
        d.moved = true;
        d.x = e.clientX;
        d.y = e.clientY;
        const next = mul(mul(rotY(dx * 0.012), rotX(dy * 0.012)), matRef.current);
        matRef.current = next;
        setMat(next);
        setHot(nearest(next));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d || d.moved) return;
        const svg = e.currentTarget as SVGSVGElement;
        const hit = hitAt(e.clientX, e.clientY, svg);
        if (hit) {
          const next = SNAPS[hit.id];
          matRef.current = next;
          setMat(next);
          onChange?.(hit.id);
          return;
        }
        matRef.current = FRONT;
        setMat(FRONT);
        onChange?.("reset");
      }}
      onPointerLeave={() => {
        if (!drag.current) setHot(null);
      }}
      onDoubleClick={(e) => {
        e.preventDefault();
        matRef.current = FRONT;
        setMat(FRONT);
        onChange?.("reset");
      }}
    >
      <circle cx={CX} cy={CY} r={28} fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.18)" />
      <circle cx={CX} cy={CY} r={18} fill="none" stroke="rgba(255,255,255,0.08)" />
      {tips.map((tip) => {
        const fade = tip.p.z < 0 ? 0.38 : 1;
        const r = tip.positive ? 7.5 : 3.6;
        const active = hot === tip.id;
        return (
          <g key={tip.id} opacity={fade} style={{ cursor: "pointer" }}>
            <line
              x1={CX}
              y1={CY}
              x2={tip.p.x}
              y2={tip.p.y}
              stroke={tip.color}
              strokeWidth={tip.positive ? 2.25 : 1.25}
              strokeLinecap="round"
            />
            <circle
              cx={tip.p.x}
              cy={tip.p.y}
              r={active ? r + 1.5 : r}
              fill={tip.positive ? tip.color : "rgba(12,16,20,0.85)"}
              stroke={tip.color}
              strokeWidth={tip.positive ? 0 : 1.4}
            />
            {tip.label ? (
              <text
                x={tip.p.x}
                y={tip.p.y + 0.5}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#0c1014"
                fontSize="8"
                fontFamily="ui-sans-serif, system-ui, sans-serif"
                fontWeight="700"
                style={{ pointerEvents: "none" }}
              >
                {tip.label}
              </text>
            ) : null}
            <title>{axisLabel(tip.id)}</title>
          </g>
        );
      })}
    </svg>
  );
}
