type IpcListener = (...args: unknown[]) => void;

type IpcRenderer = {
  on: (channel: string, listener: IpcListener) => void;
  removeListener: (channel: string, listener: IpcListener) => void;
};

export function getIpcRenderer(): IpcRenderer | undefined {
  if (typeof window === "undefined") return undefined;

  const win = window as Window & {
    require?: (module: string) => { ipcRenderer: IpcRenderer };
  };

  try {
    return win.require?.("electron")?.ipcRenderer;
  } catch {
    return undefined;
  }
}
