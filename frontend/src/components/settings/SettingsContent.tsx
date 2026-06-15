"use client";

import { LocaleSetting } from "@/components/settings/LocaleSetting";
import { ThemeSetting } from "@/components/settings/ThemeSetting";
import { ModulePage } from "@/components/layout/ModulePage";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useAppLocale } from "@/hooks/use-app-locale";

const SETTINGS_BG = "/images/settings-scenery.jpg";

export function SettingsContent() {
  const { t } = useAppLocale();

  return (
    <ModulePage
      title={t("settings.pageTitle")}
      description={t("settings.pageDescription")}
      showBreadcrumb={false}
      backgroundImage={SETTINGS_BG}
      contentClassName="overflow-hidden"
    >
      <div className="w-full space-y-6 rounded-lg border border-surface-700/80 bg-surface-900/75 p-5 shadow-lg ring-1 ring-brand-500/10 backdrop-blur-md">
        <ThemeSetting />
        <Separator className="bg-surface-700/80" />
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="terrain-streaming" className="text-ink-200">
              {t("settings.terrain.label")}
            </Label>
            <p className="text-xs text-ink-400">
              {t("settings.terrain.description")}
            </p>
          </div>
          <Switch id="terrain-streaming" defaultChecked />
        </div>
        <Separator className="bg-surface-700/80" />
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="reduce-motion" className="text-ink-200">
              {t("settings.reduceMotion.label")}
            </Label>
            <p className="text-xs text-ink-400">
              {t("settings.reduceMotion.description")}
            </p>
          </div>
          <Switch id="reduce-motion" />
        </div>
        <Separator className="bg-surface-700/80" />
        <LocaleSetting />
      </div>
    </ModulePage>
  );
}
