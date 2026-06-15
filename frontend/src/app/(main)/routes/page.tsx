import { ModulePage } from "@/components/layout/ModulePage";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { APP_NAV_ITEMS } from "@/lib/app-nav";

const FEATURED_ROUTES = [
  {
    title: "丝绸之路",
    region: "中亚 · 中国",
    summary: "千年商道与人文遗迹，沙漠、古城与多元文化交汇。",
  },
  {
    title: "川藏南线",
    region: "中国西南",
    summary: "高原雪山、藏地人文与极致地貌的经典自驾路线。",
  },
  {
    title: "环地中海",
    region: "欧洲 · 北非",
    summary: "碧海古城、文艺复兴遗产与地中海沿岸慢旅行。",
  },
];

export default function RoutesPage() {
  const nav = APP_NAV_ITEMS.routes;

  return (
    <ModulePage title={nav.pageTitle} description={nav.pageDescription}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURED_ROUTES.map((route) => (
          <Card
            key={route.title}
            className="border-surface-700/80 bg-surface-900/70 backdrop-blur"
          >
            <CardHeader>
              <CardDescription className="text-brand-400">
                {route.region}
              </CardDescription>
              <CardTitle className="text-ink-100">{route.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-ink-400">{route.summary}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </ModulePage>
  );
}
