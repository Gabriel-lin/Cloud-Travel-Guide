"use client";

import { BROWSER_SETTINGS_KEY, DEFAULT_SETTINGS } from "@/lib/settings";

/** 水合前根据 settings 设置 html class（Electron: preload；浏览器: localStorage） */
export function ThemeBootstrapScript() {
  // 仅在服务端渲染脚本：脚本会随 SSR HTML 在水合前执行。
  // 客户端返回 null，避免 React 19 “script tag while rendering” 警告。
  if (typeof window !== "undefined") return null;
  return (
    <script
      suppressHydrationWarning
      dangerouslySetInnerHTML={{
        __html: `(function(){function resolve(pref,system){if(pref==="system")return system;return pref==="dark"?"dark":"light";}function apply(resolved){var root=document.documentElement;if(resolved==="dark"){root.classList.add("dark");root.style.colorScheme="dark";}else{root.classList.remove("dark");root.style.colorScheme="light";}}try{var state=null;var api=window.electronAPI;if(api&&api.theme&&api.theme.initialState){state=api.theme.initialState;}else{var raw=localStorage.getItem(${JSON.stringify(BROWSER_SETTINGS_KEY)});var pref=${JSON.stringify(DEFAULT_SETTINGS.theme)};if(raw){var parsed=JSON.parse(raw);if(parsed&&typeof parsed.theme==="string")pref=parsed.theme;}var system=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";state={preference:pref,resolved:resolve(pref,system),system:system};}apply(state?state.resolved:"dark");}catch(e){apply("dark");}})();`,
      }}
    />
  );
}
