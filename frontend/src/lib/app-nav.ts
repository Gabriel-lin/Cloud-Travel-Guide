import type { LucideIcon } from "lucide-react";
import {
  Bookmark,
  Globe2,
  MapPinned,
  Route,
  Settings,
  UserRound,
} from "lucide-react";

export type AppNavId =
  | "explore"
  | "routes"
  | "plan"
  | "saved"
  | "profile"
  | "settings";

export type AppNavItem = {
  id: AppNavId;
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  pageTitle: string;
  pageDescription?: string;
};

export const APP_NAV_ITEMS: Record<AppNavId, AppNavItem> = {
  explore: {
    id: "explore",
    href: "/",
    label: "探索",
    description: "3D 地球与实景浏览",
    icon: Globe2,
    pageTitle: "3D 地球 · 动态地形",
    pageDescription: "旋转、缩放并浏览全球动态地形与影像。",
  },
  routes: {
    id: "routes",
    href: "/routes",
    label: "推荐路线",
    description: "著名美景与人文经典线路",
    icon: Route,
    pageTitle: "推荐路线",
    pageDescription: "精选著名自然景观与人文经典旅行线路。",
  },
  plan: {
    id: "plan",
    href: "/plan",
    label: "行程规划",
    description: "自定义旅游路线与日程",
    icon: MapPinned,
    pageTitle: "行程规划",
    pageDescription: "创建与管理你的专属旅行日程与路线。",
  },
  saved: {
    id: "saved",
    href: "/saved",
    label: "收藏夹",
    description: "已保存的地点与路线",
    icon: Bookmark,
    pageTitle: "收藏夹",
    pageDescription: "快速访问已保存的地点、路线与行程。",
  },
  profile: {
    id: "profile",
    href: "/profile",
    label: "个人资料",
    description: "偏好与账户信息",
    icon: UserRound,
    pageTitle: "个人资料",
    pageDescription: "管理账户信息与旅行偏好。",
  },
  settings: {
    id: "settings",
    href: "/settings",
    label: "应用设置",
    description: "主题、语言与主体配置",
    icon: Settings,
    pageTitle: "应用设置",
    pageDescription: "主题、语言、地图与显示相关配置。",
  },
};

export const PRIMARY_NAV_IDS: AppNavId[] = [
  "explore",
  "routes",
  "plan",
  "saved",
];

export const SECONDARY_NAV_IDS: AppNavId[] = ["profile", "settings"];

/** Resolve active nav from pathname (supports trailing slash). */
export function getActiveNavId(pathname: string): AppNavId {
  const normalized = pathname.replace(/\/$/, "") || "/";
  const match = Object.values(APP_NAV_ITEMS).find((item) => {
    const href = item.href.replace(/\/$/, "") || "/";
    return href === normalized;
  });
  return match?.id ?? "explore";
}
