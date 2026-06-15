"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { AppNavSidebar } from "@/components/AppNavSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { getActiveNavId } from "@/lib/app-nav";

export type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const activeId = getActiveNavId(pathname);

  return (
    <SidebarProvider defaultOpen={false} className="h-screen overflow-hidden">
      <AppNavSidebar activeId={activeId} />
      <SidebarInset className="relative min-w-0 overflow-hidden bg-surface-950">
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
