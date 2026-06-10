"use client";

import dynamic from "next/dynamic";

const GlobeExplorer = dynamic(
  () => import("@/components/GlobeExplorer").then((m) => m.GlobeExplorer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-slate-950 text-sm text-slate-400">
        正在加载 3D 地球模块…
      </div>
    ),
  },
);

export default function HomePage() {
  return (
    <main className="fixed inset-0 overflow-hidden bg-slate-950">
      <h2 className="sr-only">3D 地球 · 动态地形</h2>
      <GlobeExplorer className="h-full w-full" />
    </main>
  );
}
