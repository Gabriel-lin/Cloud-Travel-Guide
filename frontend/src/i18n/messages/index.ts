import type { AppLocale } from "@/lib/locale";

import en from "./en/index";
import zhCN from "./cn/index";

export { en, zhCN };

export const MESSAGES: Record<AppLocale, typeof zhCN | typeof en> = {
  "zh-CN": zhCN,
  en,
};

export type Messages = typeof zhCN;

export const i18nResources = {
  "zh-CN": { translation: zhCN },
  en: { translation: en },
} as const;
