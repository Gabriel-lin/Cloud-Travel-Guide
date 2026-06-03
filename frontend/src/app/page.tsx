"use client";

import { ThreeScene } from "@/components/ThreeScene";
import { useElectronRuntime } from "@/lib/electron";

export default function HomePage() {
  const { mounted, inDesktop, api } = useElectronRuntime();

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-10 px-6 py-12">
      <header className="space-y-3 text-center">
        <p className="text-sm font-medium uppercase tracking-widest text-brand-600">
          Cloud Travel Guide
        </p>
        <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          云旅行导览
        </h1>
        <p className="mx-auto max-w-xl text-lg text-slate-600">
          基于 Next.js、React、Electron 与 Tailwind CSS 的桌面端前端脚手架，支持
          Vite 构建主进程与 Vitest 单元测试。
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">运行环境</h2>
          <dl className="mt-4 space-y-2 text-sm text-slate-600">
            <div className="flex justify-between gap-4">
              <dt>壳层</dt>
              <dd className="font-medium text-slate-900">
                {!mounted
                  ? "—"
                  : inDesktop
                    ? "Electron 桌面"
                    : "浏览器 / Next 开发"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>平台</dt>
              <dd className="font-medium text-slate-900">
                {!mounted ? "—" : (api?.platform ?? "web")}
              </dd>
            </div>
            {mounted && api ? (
              <div className="flex justify-between gap-4">
                <dt>Electron</dt>
                <dd className="font-mono text-xs text-slate-800">
                  {api.versions.electron}
                </dd>
              </div>
            ) : null}
          </dl>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">技术栈</h2>
          <ul className="mt-4 list-inside list-disc space-y-2 text-sm text-slate-600">
            <li>UI：Next.js App Router + React 19</li>
            <li>样式：Tailwind CSS v4（PostCSS）</li>
            <li>主进程：Electron + Vite 打包</li>
            <li>分发：electron-builder</li>
            <li>3D：Three.js</li>
            <li>测试：Vitest（Vite 驱动）</li>
          </ul>
        </article>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-900 shadow-sm">
        <div className="border-b border-slate-700/80 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-100">3D 场景预览</h2>
          <p className="mt-1 text-xs text-slate-400">Three.js · 可在此扩展地图与导览内容</p>
        </div>
        <ThreeScene className="h-80 w-full sm:h-96" />
      </section>
    </main>
  );
}
