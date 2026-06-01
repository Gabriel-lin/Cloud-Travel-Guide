"use client";

import { useEffect, useState } from "react";
import ReactECharts from "echarts-for-react";

interface DataPoint {
  time: number;
  value: number;
}

const DynamicLineChart = () => {
  const [data, setData] = useState<DataPoint[]>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      setData((prevData) => {
        const newData = [...prevData];
        const currentTime = Date.now();
        const value = Math.sin(currentTime / 1000);
        newData.push({ time: currentTime, value });
        if (newData.length > 50) newData.shift();
        return newData;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const option = {
    xAxis: { type: "time" },
    yAxis: { type: "value" },
    series: [
      {
        data: data.map((point) => [point.time, point.value]),
        type: "line",
        smooth: true,
      },
    ],
  };

  return (
    <div className="rounded-lg bg-blue-300 p-4">
      <h2 className="mb-2 text-lg font-medium text-slate-900">动态折线图</h2>
      <ReactECharts option={option} style={{ height: "400px", width: "100%" }} />
    </div>
  );
};

export default DynamicLineChart;
