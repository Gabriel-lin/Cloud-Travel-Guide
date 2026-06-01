"use client";

import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import { getIpcRenderer } from "@/lib/electron";

const CpuUsage = () => {
  const chartRef = useRef<HTMLDivElement>(null);
  const [cpuCount] = useState(20);
  const [data, setData] = useState<Array<Array<[number, number]>>>(() =>
    Array.from({ length: 20 }, () => []),
  );
  const chartInstance = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;

    chartInstance.current = echarts.init(chartRef.current);

    const handleResize = () => {
      chartInstance.current?.resize();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chartInstance.current?.dispose();
    };
  }, []);

  useEffect(() => {
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) return;

    const cpuUsageHandler = (...args: unknown[]) => {
      const cpuUsages = args[1] as { usage: number }[];
      setData((prevData) => {
        const now = Date.now();
        return prevData.map((cpuData, index) => {
          const usage = cpuUsages[index]?.usage ?? 0;
          const newCpuData = [...cpuData, [now, usage] as [number, number]];
          if (newCpuData.length > 60) newCpuData.shift();
          return newCpuData;
        });
      });
    };

    ipcRenderer.on("cpu-usage", cpuUsageHandler);

    return () => {
      ipcRenderer.removeListener("cpu-usage", cpuUsageHandler);
    };
  }, []);

  useEffect(() => {
    if (!chartInstance.current) return;

    const option = {
      title: {
        text: "CPU 使用率",
        top: "10px",
      },
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => {
          const list = Array.isArray(params) ? params : [params];
          if (!list.length) return "";

          const first = list[0] as { value: [number, number] };
          const formatDate = (timestamp: number) =>
            new Date(timestamp)
              .toLocaleString("zh-CN", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
              })
              .replace(/\//g, "-");

          let result = `<div style="font-size: 14px; font-weight: bold;">时间: ${formatDate(first.value[0])}</div>`;
          let count = 0;
          list.forEach((param) => {
            const p = param as { seriesName: string; value: [number, number] };
            if (count % 4 === 0) result += "<div></div>";
            result += `<span style="padding: 2px;">${p.seriesName}: ${p.value[1]}%</span>`;
            count++;
          });
          return result;
        },
      },
      legend: {
        data: Array.from({ length: cpuCount }, (_, i) => `CPU ${i}`),
        right: "10px",
        width: "60%",
      },
      xAxis: {
        type: "time",
        boundaryGap: false,
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 100,
      },
      series: Array.from({ length: cpuCount }, (_, i) => ({
        name: `CPU ${i}`,
        type: "line",
        showSymbol: false,
        data: data[i],
      })),
    };

    chartInstance.current.setOption(option as echarts.EChartsOption);
  }, [cpuCount, data]);

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold text-slate-800">CPU 使用率</h1>
      <div ref={chartRef} className="h-[70vh] w-[90%]" />
    </div>
  );
};

export default CpuUsage;
