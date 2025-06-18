const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require("os");
const isDev = require('electron-is-dev');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    title: "Cloud Travel Guide",
  });

  // 根据开发环境加载不同的 URL
  mainWindow.loadURL(
    isDev
      ? 'http://localhost:3000'
      : `file://${path.join(__dirname, '../build/index.html')}`
  );

  // 开发模式下打开开发者工具
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 处理 CPU 核心数量请求
ipcMain.on("request-cpu-count", (event) => {
  const cpuCount = os.cpus().length;
  event.reply("cpu-count", cpuCount);
});

// 获取每个 CPU 核心的使用率
function getCpuUsage(prevCpus) {
  const cpus = os.cpus();
  const cpuUsages = cpus.map((cpu, index) => {
    const prevCpu = prevCpus ? prevCpus[index] : null;
    const total = Object.values(cpu.times).reduce((acc, val) => acc + val, 0);
    const idle = cpu.times.idle;

    if (prevCpu) {
      const totalDiff = total - prevCpu.total;
      const idleDiff = idle - prevCpu.idle;
      const usage = 100 - Math.round((100 * idleDiff) / totalDiff);
      return {
        core: index,
        usage: usage,
        total: total,
        idle: idle,
      };
    } else {
      return {
        core: index,
        usage: 0,
        total: total,
        idle: idle,
      };
    }
  });

  return cpuUsages;
}

let prevCpus = null;

// 每隔 1 秒更新 CPU 使用率
setInterval(() => {
  if (mainWindow) {
    const cpuUsages = getCpuUsage(prevCpus);
    prevCpus = cpuUsages.map((cpu) => ({
      core: cpu.core,
      total: cpu.total,
      idle: cpu.idle,
    }));
    mainWindow.webContents.send("cpu-usage", cpuUsages);
    mainWindow.webContents.send("cpu-count", cpuUsages.length);
    console.log("cpus", cpuUsages);
  }
}, 1000);
