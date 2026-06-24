import type { ReactNode } from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { APP_NAME } from "@/config/app";
import { cn } from "@/lib/utils";

export type ModulePageProps = {
  title: string;
  description?: string;
  children?: ReactNode;
  contentClassName?: string;
  showBreadcrumb?: boolean;
  /** 整页背景图（含页头与内容区） */
  backgroundImage?: string;
  headerClassName?: string;
};

export function ModulePage({
  title,
  description,
  children,
  contentClassName,
  showBreadcrumb = true,
  backgroundImage,
  headerClassName,
}: ModulePageProps) {
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      {backgroundImage ? (
        <>
          <div
            className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${backgroundImage})` }}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-0 bg-surface-950/40 dark:bg-surface-950/50"
            aria-hidden
          />
        </>
      ) : null}

      <div
        className={cn(
          "relative z-10 shrink-0 border-b border-surface-700/80 bg-surface-900/40 backdrop-blur-md",
          backgroundImage &&
            "border-surface-700/50 bg-surface-900/25 backdrop-blur-sm",
          headerClassName,
        )}
      >
        {showBreadcrumb ? (
          <div className="flex min-h-12 items-center px-6">
            <Breadcrumb className="flex w-full items-center">
              <BreadcrumbList className="items-center">
                <BreadcrumbItem>
                  <span className="text-ink-400">{APP_NAME}</span>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage className="text-ink-200">{title}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        ) : null}
        <div
          className={cn("px-6 pb-4", showBreadcrumb ? "pt-1" : "pt-5")}
        >
          <h1 className="text-lg font-semibold tracking-tight text-ink-100">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-sm text-ink-400">{description}</p>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          "relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto p-6",
          contentClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
