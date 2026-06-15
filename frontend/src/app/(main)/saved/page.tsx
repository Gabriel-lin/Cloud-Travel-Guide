import { Bookmark } from "lucide-react";

import { ModulePage } from "@/components/layout/ModulePage";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { APP_NAV_ITEMS } from "@/lib/app-nav";

export default function SavedPage() {
  const nav = APP_NAV_ITEMS.saved;

  return (
    <ModulePage title={nav.pageTitle} description={nav.pageDescription}>
      <Empty className="border border-surface-700/80 bg-surface-900/40">
        <EmptyHeader>
          <EmptyMedia>
            <Bookmark className="size-10 text-ink-400" strokeWidth={1.25} />
          </EmptyMedia>
          <EmptyTitle className="text-ink-200">暂无收藏</EmptyTitle>
          <EmptyDescription className="text-ink-400">
            在探索或路线页面收藏地点与线路后，将显示在这里。
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </ModulePage>
  );
}
