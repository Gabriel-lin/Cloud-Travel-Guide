"use client";

import { useAui } from "@assistant-ui/store";
import { useEffect } from "react";

import { schedulePlanThreadCloudMerge } from "@/lib/plan/schedule-thread-cloud-merge";
import { useAuthStore } from "@/store/auth-store";

/**
 * On each authenticated plan session: upload any local-only threads, then refresh
 * the remote thread list from the server (browser ↔ desktop share cloud, not localStorage).
 */
export function PlanCloudThreadSync() {
  const aui = useAui();
  const userId = useAuthStore((s) => s.user?.id);
  const isAuthenticated = useAuthStore(
    (s) => s.ready && s.status === "authenticated",
  );

  useEffect(() => {
    if (!isAuthenticated || !userId) return;

    void (async () => {
      await schedulePlanThreadCloudMerge(userId);
      await aui.threads().reload();
    })();
  }, [isAuthenticated, userId, aui]);

  return null;
}
