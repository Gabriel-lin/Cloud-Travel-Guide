import { contextBridge } from "electron";

export type ElectronAPI = {
  platform: NodeJS.Platform;
  isElectron: true;
  versions: {
    node: string;
    chrome: string;
    electron: string;
  };
};

const electronAPI: ElectronAPI = {
  platform: process.platform,
  isElectron: true,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
