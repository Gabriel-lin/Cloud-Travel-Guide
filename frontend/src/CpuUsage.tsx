import React, { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";

// 只在 Electron 环境下引入 ipcRenderer
const ipcRenderer = window.require
  ? window.require("electron").ipcRenderer
  : undefined;

const CpuUsage = () => {
  const chartRef = useRef<HTMLDivElement>(null);
  const [cpuCount, setCpuCount] = useState(20);
  const [data, setData] = useState<Array<Array<[number, number]>>>(() => 
    Array.from({ length: 20 }, () => [])
  );
  const chartInstance = useRef<echarts.ECharts | null>(null);

  // 初始化 ECharts 实例
  useEffect(() => {
    if (chartRef.current) {
      chartInstance.current = echarts.init(chartRef.current);

      // 监听窗口大小变化事件
      const handleResize = () => {
        chartInstance.current?.resize();
      };
      window.addEventListener("resize", handleResize);

      // 组件卸载时销毁 ECharts 实例
      return () => {
        window.removeEventListener("resize", handleResize);
        chartInstance.current?.dispose();
      };
    }
  }, []);

  // 监听主进程发来的 CPU 信息
  useEffect(() => {
    if (!ipcRenderer) return;

    // 监听 CPU 使用率
    const cpuUsageHandler = (_: any, cpuUsages: { usage: number }[]) => {
      setData((prevData) => {
        const now = Date.now();
        const newData = prevData.map((cpuData, index) => {
          const usage = cpuUsages[index]?.usage ?? 0;
          const newCpuData = [...cpuData, [now, usage]];
          if (newCpuData.length > 60) newCpuData.shift();
          return newCpuData as any;
        });
        console.log("收到cpu-usage", newData);
        return newData;
      });
    };
    ipcRenderer.on("cpu-usage", cpuUsageHandler);

    // 清理事件监听器
    return () => {
      ipcRenderer.removeListener("cpu-usage", cpuUsageHandler);
    };
  }, []);

  // 更新 ECharts 配置
  useEffect(() => {
    if (chartInstance.current) {
      const option = {
        title: {
          text: "CPU 使用率",
          top: "10px",
        },
        tooltip: {
          trigger: "axis",
          width: 200,
          formatter: function (params: any) {
            // 将时间戳转换为可读的日期时间格式
            const formatDate = (timestamp: number) => {
              const date = new Date(timestamp);
              return date.toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
              }).replace(/\//g, '-');
            };

            let result = `<div style="font-size: 14px; font-weight: bold;">时间: ${formatDate(params[0].value[0])}</div>`;
            let count = 0;
            params.forEach((param: any) => {
              if (count % 4 === 0) {
                result += `<div></div>`;
              }
              result += `<span style="padding: 2px;">${param.seriesName}: ${param.value[1]}%</span>`;
              count++;
            });
            return result;
          },
        },
        legend: {
          data: Array.from({ length: cpuCount }, (_, i) => `CPU ${i}`),
          right: "10px",
          width: "60%",
          formatter: function (name: string) {
            const maxPerLine = 4;
            const index = Array.from({ length: cpuCount }, (_, i) => `CPU ${i}`).indexOf(name);
            if (index % maxPerLine === 0 && index !== 0) {
              return "\n" + name;
            }
            return name;
          },
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

      console.log("render cpu-usage", data);
      chartInstance.current.setOption(option);
    }
  }, [cpuCount, data]);

  return (
    <>
      <h1>CPU 使用率</h1>
      <div ref={chartRef} style={{ width: "90%", height: "70vh" }}></div>
    </>
  );
};

export default CpuUsage;
