import { ModulePage } from "@/components/layout/ModulePage";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { APP_NAV_ITEMS } from "@/lib/app-nav";

export default function ProfilePage() {
  const nav = APP_NAV_ITEMS.profile;

  return (
    <ModulePage title={nav.pageTitle} description={nav.pageDescription}>
      <Card className="w-full border-surface-700/80 bg-surface-900/70 backdrop-blur">
        <CardHeader className="flex flex-row items-center gap-4">
          <Avatar className="size-14 ring-2 ring-brand-500/20">
            <AvatarFallback className="bg-surface-800 text-brand-400">
              CT
            </AvatarFallback>
          </Avatar>
          <div>
            <CardTitle className="text-ink-100">旅行者</CardTitle>
            <p className="text-sm text-ink-400">尚未登录</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-ink-300">旅行偏好</Label>
            <p className="text-sm text-ink-400">
              自然风光、人文历史、徒步探险
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-ink-300">常用语言</Label>
            <p className="text-sm text-ink-400">简体中文</p>
          </div>
        </CardContent>
      </Card>
    </ModulePage>
  );
}
