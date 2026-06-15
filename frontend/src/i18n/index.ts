import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { i18nResources } from "@/i18n/messages";
import { DEFAULT_APP_LOCALE } from "@/lib/locale";

void i18n.use(initReactI18next).init({
  resources: i18nResources,
  lng: DEFAULT_APP_LOCALE,
  fallbackLng: DEFAULT_APP_LOCALE,
  interpolation: {
    escapeValue: false,
    prefix: "{",
    suffix: "}",
  },
  react: {
    useSuspense: false,
  },
});

export default i18n;
