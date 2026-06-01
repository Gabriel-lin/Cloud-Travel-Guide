"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { getIpcRenderer } from "@/lib/electron";

interface CpuPerformanceData {
  pid: number;
  name: string;
  usage: number;
  children?: CpuPerformanceData[];
}

const CpuFlameDiagram = () => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [performanceData, setPerformanceData] = useState<CpuPerformanceData>({
    pid: 0,
    name: "System",
    usage: 0,
    children: [],
  });

  const getColor = (node: CpuPerformanceData) => {
    const colorPalette = [
      { name: "System", color: "#FF6F61" },
      { name: "Kernel", color: "#6B5B95" },
      { name: "User Processes", color: "#88B04B" },
      { name: "Memory", color: "#FFA500" },
      { name: "Scheduling", color: "#4B0082" },
      { name: "Browser", color: "#1E90FF" },
      { name: "IDE", color: "#FF1493" },
      { name: "Terminal", color: "#00CED1" },
    ];

    const matchedColor = colorPalette.find(
      (item) => node.name.toLowerCase() === item.name.toLowerCase(),
    );
    if (matchedColor) return matchedColor.color;

    const fuzzyMatch = colorPalette.find((item) =>
      node.name.toLowerCase().includes(item.name.toLowerCase()),
    );
    if (fuzzyMatch) return fuzzyMatch.color;

    const intensity = Math.min(node.usage / 100, 1);
    return d3.interpolateRgb("#D3D3D3", "#FF0000")(intensity);
  };

  const renderFlameGraph = () => {
    if (!svgRef.current || !containerRef.current) return;

    d3.select(svgRef.current).selectAll("*").remove();

    const containerWidth = containerRef.current.clientWidth;
    const containerHeight = 400;

    const svg = d3
      .select(svgRef.current)
      .attr("width", containerWidth)
      .attr("height", containerHeight);

    const hierarchyLayout = d3
      .hierarchy(performanceData)
      .sum((d) => d.usage || 0);

    const treemap = d3
      .treemap<CpuPerformanceData>()
      .size([containerWidth, containerHeight])
      .padding(1)
      .round(true);

    const root = treemap(hierarchyLayout);

    const cell = svg
      .selectAll("g")
      .data(root.leaves())
      .enter()
      .append("g")
      .attr("transform", (d) => `translate(${d.x0},${d.y0})`);

    cell
      .append("rect")
      .attr("width", (d) => Math.max(0, d.x1 - d.x0))
      .attr("height", (d) => Math.max(0, d.y1 - d.y0))
      .attr("fill", (d) => getColor(d.data))
      .attr("stroke", "white")
      .attr("stroke-width", 1);

    cell
      .append("text")
      .attr("x", 5)
      .attr("y", 15)
      .text((d) => `${d.data.name} (${d.data.usage.toFixed(2)}%)`)
      .attr("font-size", "10px")
      .attr("fill", "white");

    cell.append("title").text(
      (d) =>
        `${d.data.name}\nUsage: ${d.data.usage.toFixed(2)}%\nPID: ${d.data.pid}`,
    );
  };

  useEffect(() => {
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) return;

    const cpuPerformanceHandler: (...args: unknown[]) => void = (
      _,
      data,
    ) => {
      setPerformanceData(data as CpuPerformanceData);
    };

    ipcRenderer.on("cpu-performance", cpuPerformanceHandler);

    const handleResize = () => renderFlameGraph();
    window.addEventListener("resize", handleResize);

    return () => {
      ipcRenderer.removeListener("cpu-performance", cpuPerformanceHandler);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    renderFlameGraph();
  }, [performanceData]);

  return (
    <div ref={containerRef} className="relative h-[500px] w-full">
      <h2 className="mb-4 text-xl font-semibold text-slate-800">
        CPU 性能火焰图 (Nsight 风格)
      </h2>
      <svg
        ref={svgRef}
        className="h-[400px] w-full rounded-lg bg-[#1E1E1E]"
      />
    </div>
  );
};

export default CpuFlameDiagram;
