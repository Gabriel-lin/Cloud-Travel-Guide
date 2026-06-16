import { useEffect } from "react";

import { initSettingsStore } from "@/store";

/**
 * 挂载后初始化统一设置 store（幂等）。
 * 故意放在 effect 中：首次客户端渲染保持与 SSR 一致的初始 state，挂载后再填充真实值，
 * 避免水合不匹配。
 */
export function useInitSettings(): void {
  useEffect(() => {
    initSettingsStore();
  }, []);
}
