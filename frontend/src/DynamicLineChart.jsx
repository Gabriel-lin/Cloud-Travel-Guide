import React, { useState, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';

const DynamicLineChart = () => {
  const [data, setData] = useState([]);

  // 动态更新数据
  useEffect(() => {
    const interval = setInterval(() => {
      setData((prevData) => {
        const newData = [...prevData];
        const currentTime = new Date().getTime(); // 当前时间戳
        const value = Math.sin(currentTime / 1000); // 根据时间生成正弦值
        newData.push({
          time: currentTime,
          value: value,
        });
        if (newData.length > 50) {
          newData.shift(); // 保持最多50个数据点
        }
        return newData;
      });
    }, 1000); // 每100毫秒更新一次数据

    return () => clearInterval(interval);
  }, []);

  // ECharts 配置
  const option = {
    xAxis: {
      type: 'time', // 使用时间轴
    },
    yAxis: {
      type: 'value',
    },
    series: [
      {
        data: data.map((point) => [point.time, point.value]), // 数据格式为 [时间, 值]
        type: 'line',
        smooth: true, // 使曲线平滑
      },
    ],
  };

  return (
    <div>
      <ReactECharts option={option} style={{ height: '400px', width: '100%' }} />
    </div>
  );
};

export default DynamicLineChart;
