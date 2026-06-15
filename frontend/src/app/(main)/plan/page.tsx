import { ModulePage } from "@/components/layout/ModulePage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_NAV_ITEMS } from "@/lib/app-nav";

export default function PlanPage() {
  const nav = APP_NAV_ITEMS.plan;

  return (
    <ModulePage title={nav.pageTitle} description={nav.pageDescription}>
      <Card className="w-full border-surface-700/80 bg-surface-900/70 backdrop-blur">
        <CardHeader>
          <CardTitle className="text-base text-ink-200">开始规划</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-ink-400">
          <p>行程规划模块将支持：</p>
          <ul className="list-inside list-disc space-y-1">
            <li>按天数与目的地生成路线草案</li>
            <li>在地球上标注途经点与停留时间</li>
            <li>导出与分享行程单</li>
          </ul>
        </CardContent>
      </Card>
    </ModulePage>
  );
}
