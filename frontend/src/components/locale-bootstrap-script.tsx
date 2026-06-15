"use client";

import { BROWSER_SETTINGS_KEY, DEFAULT_SETTINGS } from "@/lib/settings";

/** 水合前根据 settings 设置 html lang（Electron: preload；浏览器: localStorage） */
export function LocaleBootstrapScript() {
  // 仅在服务端渲染脚本：脚本会随 SSR HTML 在水合前执行。
  // 客户端返回 null，避免 React 19 “script tag while rendering” 警告。
  if (typeof window !== "undefined") return null;
  return (
    <script
      suppressHydrationWarning
      dangerouslySetInnerHTML={{
        __html: `(function(){function apply(locale){var root=document.documentElement;root.lang=locale==="en"?"en":"zh-CN";}try{var locale=${JSON.stringify(DEFAULT_SETTINGS.locale)};var api=window.electronAPI;if(api&&api.locale&&api.locale.initialState){locale=api.locale.initialState.locale;}else{var raw=localStorage.getItem(${JSON.stringify(BROWSER_SETTINGS_KEY)});if(raw){var parsed=JSON.parse(raw);if(parsed&&parsed.locale==="en")locale="en";else if(parsed&&parsed.locale==="zh-CN")locale="zh-CN";}}apply(locale);}catch(e){apply("zh-CN");}})();`,
      }}
    />
  );
}
