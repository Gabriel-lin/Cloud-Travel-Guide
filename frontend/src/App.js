import React from "react";
import DynamicLineChart from "./DynamicLineChart";

function App() {
  return (
    <div className="App">
      <h1>动态折线图</h1>
      <DynamicLineChart />

      <div className="container mx-auto p-4">
        <h1 className="text-3xl font-bold text-blue-600">
          Hello, Tailwind CSS!
        </h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gray-100 p-4 rounded-lg">
            <DynamicLineChart />
          </div>
          <div className="bg-gray-100 p-4 rounded-lg">Column 2</div>
        </div>
      </div>
    </div>
  );
}

export default App;
