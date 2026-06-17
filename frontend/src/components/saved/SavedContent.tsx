"use client";

import { Bookmark } from "lucide-react";

import { ModulePage } from "@/components/layout/ModulePage";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useAppLocale } from "@/hooks/use-app-locale";

const SAVED_BG = "/images/saved-scenery.jpg";

export function SavedContent() {
  const { t } = useAppLocale();

  return (
    <ModulePage
      title={t("nav.saved.pageTitle")}
      description={t("nav.saved.pageDescription")}
      showBreadcrumb={false}
      backgroundImage={SAVED_BG}
      contentClassName="overflow-hidden"
    >
      <Empty className="border border-surface-700/80 bg-surface-900/75 shadow-lg ring-1 ring-brand-500/10 backdrop-blur-md">
        <EmptyHeader>
          <EmptyMedia>
            <Bookmark className="size-10 text-ink-400" strokeWidth={1.25} />
          </EmptyMedia>
          <EmptyTitle className="text-ink-200">{t("saved.emptyTitle")}</EmptyTitle>
          <EmptyDescription className="text-ink-400">
            {t("saved.emptyDescription")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </ModulePage>
  );
}
