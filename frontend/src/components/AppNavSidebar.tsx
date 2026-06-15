"use client";

import { Compass } from "lucide-react";
import Link from "next/link";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarCollapseTrigger,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { useLocalizedNavItems } from "@/hooks/use-localized-nav";
import {
  type AppNavId,
  type AppNavItem,
} from "@/lib/app-nav";
import { cn } from "@/lib/utils";

const ICON_RAIL_SECTION =
  "p-2 group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:p-1";

const ICON_RAIL_MENU =
  "group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:gap-1";

const ICON_RAIL_BUTTON =
  "group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0";

const RAIL_TOOLTIP = {
  side: "right" as const,
  sideOffset: 10,
  className: "font-medium tracking-wide",
};

export type { AppNavId };

export type AppNavSidebarProps = {
  activeId?: AppNavId;
  className?: string;
};

function NavMenuButton({
  item,
  active,
  collapsed,
}: {
  item: AppNavItem;
  active: boolean;
  collapsed: boolean;
}) {
  const Icon = item.icon;

  return (
    <SidebarMenuItem className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:justify-center">
      <SidebarMenuButton
        render={<Link href={item.href} />}
        isActive={active}
        size={collapsed ? "default" : "lg"}
        tooltip={
          collapsed ? { children: item.label, ...RAIL_TOOLTIP } : undefined
        }
        className={cn(
          ICON_RAIL_BUTTON,
          "text-ink-300 transition-colors duration-150",
          "hover:bg-surface-800/80 hover:text-ink-100",
          active &&
            "bg-brand-600/15 text-brand-400 hover:bg-brand-600/20 hover:text-brand-400 data-active:bg-brand-600/15 data-active:text-brand-400",
        )}
      >
        <Icon className="size-5 shrink-0" strokeWidth={1.75} />
        {!collapsed ? (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate font-medium">{item.label}</span>
            <span className="truncate text-[11px] font-normal text-ink-400">
              {item.description}
            </span>
          </div>
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppNavSidebar({
  activeId = "explore",
  className,
}: AppNavSidebarProps) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { items, primaryIds, secondaryIds, brand, groupLabel } =
    useLocalizedNavItems();
  const explore = items.explore;

  return (
    <Sidebar
      collapsible="icon"
      className={cn(
        "border-surface-700/80 bg-surface-900/75 backdrop-blur-md",
        "group-data-[collapsible=icon]:[&_[data-sidebar=sidebar]]:overflow-visible",
        "group-data-[collapsible=icon]:[&_[data-slot=sidebar-content]]:overflow-visible",
        className,
      )}
    >
      <SidebarHeader className={ICON_RAIL_SECTION}>
        <SidebarMenu className={ICON_RAIL_MENU}>
          <SidebarMenuItem className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:justify-center">
            <SidebarMenuButton
              render={<Link href={explore.href} />}
              size={collapsed ? "default" : "lg"}
              tooltip={
                collapsed
                  ? { children: brand.tooltip, ...RAIL_TOOLTIP }
                  : undefined
              }
              className={cn(
                ICON_RAIL_BUTTON,
                "text-brand-400 hover:bg-surface-800/80 hover:text-brand-400",
              )}
            >
              <Compass className="size-5 shrink-0" strokeWidth={1.75} />
              {!collapsed ? (
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold tracking-tight">
                    {brand.title}
                  </span>
                  <span className="truncate text-[11px] font-normal text-ink-400">
                    {brand.subtitle}
                  </span>
                </div>
              ) : null}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarSeparator className="mx-2 bg-surface-700/80 group-data-[collapsible=icon]:mx-1" />

      <SidebarCollapseTrigger />

      <SidebarContent className="group-data-[collapsible=icon]:justify-center">
        <SidebarGroup
          className={cn(
            ICON_RAIL_SECTION,
            "group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0",
          )}
        >
          {!collapsed ? (
            <SidebarGroupLabel className="text-ink-400">
              {groupLabel}
            </SidebarGroupLabel>
          ) : null}
          <SidebarGroupContent className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:justify-center">
            <SidebarMenu className={ICON_RAIL_MENU}>
              {primaryIds.map((id) => (
                <NavMenuButton
                  key={id}
                  item={items[id]}
                  active={activeId === id}
                  collapsed={collapsed}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className={ICON_RAIL_SECTION}>
        <SidebarGroup className="group-data-[collapsible=icon]:p-0">
          <SidebarGroupContent>
            <SidebarMenu className={ICON_RAIL_MENU}>
              {secondaryIds.map((id) => (
                <NavMenuButton
                  key={id}
                  item={items[id]}
                  active={activeId === id}
                  collapsed={collapsed}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarFooter>

      <SidebarRail className="after:bg-surface-700/60 hover:after:bg-brand-500/40" />
    </Sidebar>
  );
}
