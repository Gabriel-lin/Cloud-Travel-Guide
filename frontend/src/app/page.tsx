import CpuFlameDiagram from "@/components/CpuFlameDiagram";
import CpuUsage from "@/components/CpuUsage";
import DynamicLineChart from "@/components/DynamicLineChart";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 p-6">
      <header className="text-center">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Cloud Travel Guide
        </h1>
        <p className="mt-2 text-slate-600">系统监控与性能可视化</p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <CpuUsage />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <CpuFlameDiagram />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <DynamicLineChart />
      </section>
    </main>
  );
}
