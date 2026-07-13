"use client";

import {
  ArrowLeft,
  Compass,
  Hand,
  Moon,
  MousePointer2,
  Orbit,
  PersonStanding,
  Square,
  Sun,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAppLocale } from "@/hooks/use-app-locale";
import { cn } from "@/lib/utils";

import type { RouteExperienceConfig, RouteToolbarState } from "./types";

export type RouteToolbarProps = {
  config: RouteExperienceConfig;
  state: RouteToolbarState;
  onChange: (patch: Partial<RouteToolbarState>) => void;
};

function ToolbarGroup({ children }: { children: ReactNode }) {
  return (
    <div
      role="radiogroup"
      className="flex items-center overflow-hidden rounded-lg bg-surface-950/35 ring-1 ring-surface-700/55"
    >
      {children}
    </div>
  );
}

function ToolbarOption({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        role="radio"
        aria-checked={active}
        onClick={onClick}
        className={cn(
          "inline-flex size-7 items-center justify-center border-r border-surface-700/45 text-ink-300 outline-none transition-colors last:border-r-0",
          "hover:bg-surface-800/70 hover:text-ink-100 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-brand-500/60",
          active && "bg-brand-600/90 text-ink-50 shadow-inner",
          "[&_svg]:size-3.5",
        )}
      >
        {children}
        <span className="sr-only">{label}</span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function RouteToolbar({ config, state, onChange }: RouteToolbarProps) {
  const { t } = useAppLocale();
  const router = useRouter();

  const tb = "routes.experience.toolbar";

  return (
    <TooltipProvider delay={300}>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-wrap items-center justify-between gap-3.5 p-3">
        <div className="pointer-events-auto flex min-h-11 items-center gap-3 rounded-full bg-surface-900/75 px-3.5 py-1.5 shadow-lg ring-1 ring-brand-500/10 backdrop-blur-md">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => router.push("/routes")}
            className="h-7 rounded-full px-2 text-xs text-ink-200 hover:bg-surface-800/70"
          >
            <ArrowLeft />
            {t("routes.experience.back")}
          </Button>
          <div
            className="h-5 w-px bg-surface-700/60"
            aria-hidden
          />
          <div className="flex min-w-0 items-center gap-2.5 pr-1">
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: config.accent }}
              aria-hidden
            />
            <div className="flex min-w-0 items-baseline gap-2">
              <p className="truncate text-xs font-semibold text-ink-100">
                {t(`${config.i18nKey}.title`)}
              </p>
              <span className="text-[10px] text-ink-500" aria-hidden>
                /
              </span>
              <p className="truncate text-[10px] text-ink-400">
                {t(`${config.i18nKey}.region`)}
              </p>
            </div>
          </div>
        </div>

        <div className="pointer-events-auto flex min-h-11 min-w-108 items-center justify-between gap-2 rounded-full bg-surface-900/75 p-1.5 shadow-lg ring-1 ring-brand-500/10 backdrop-blur-md">
          <ToolbarGroup>
            <ToolbarOption
              active={state.viewMode === "first-person"}
              label={t(`${tb}.firstPerson`)}
              onClick={() => onChange({ viewMode: "first-person" })}
            >
              <PersonStanding />
            </ToolbarOption>
            <ToolbarOption
              active={state.viewMode === "third-person"}
              label={t(`${tb}.thirdPerson`)}
              onClick={() => onChange({ viewMode: "third-person" })}
            >
              <Orbit />
            </ToolbarOption>
          </ToolbarGroup>

          <ToolbarGroup>
            <ToolbarOption
              active={state.pointerTool === "cursor"}
              label={t(`${tb}.cursor`)}
              onClick={() => onChange({ pointerTool: "cursor" })}
            >
              <MousePointer2 />
            </ToolbarOption>
            <ToolbarOption
              active={state.pointerTool === "hand"}
              label={t(`${tb}.hand`)}
              onClick={() => onChange({ pointerTool: "hand" })}
            >
              <Hand />
            </ToolbarOption>
          </ToolbarGroup>

          <ToolbarGroup>
            <ToolbarOption
              active={state.lighting === "day"}
              label={t(`${tb}.day`)}
              onClick={() => onChange({ lighting: "day" })}
            >
              <Sun />
            </ToolbarOption>
            <ToolbarOption
              active={state.lighting === "night"}
              label={t(`${tb}.night`)}
              onClick={() => onChange({ lighting: "night" })}
            >
              <Moon />
            </ToolbarOption>
          </ToolbarGroup>

          <Tooltip>
            <TooltipTrigger
              type="button"
              aria-pressed={state.autoTour}
              onClick={() => onChange({ autoTour: !state.autoTour })}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium outline-none transition-colors",
                "focus-visible:ring-2 focus-visible:ring-brand-500/60",
                state.autoTour
                  ? "bg-brand-600 text-ink-50 shadow-sm"
                  : "bg-surface-800/60 text-ink-200 ring-1 ring-surface-700/60 hover:text-ink-100",
                "[&_svg]:size-3.5",
              )}
            >
              {state.autoTour ? <Square /> : <Compass />}
              <span className="hidden sm:inline">
                {state.autoTour
                  ? t(`${tb}.autoTourActive`)
                  : t(`${tb}.autoTour`)}
              </span>
            </TooltipTrigger>
            <TooltipContent>{t(`${tb}.autoTour`)}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
