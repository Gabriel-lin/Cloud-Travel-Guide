"use client";

import { useEffect } from "react";

import { initAuthStore } from "@/store";

/** 挂载后恢复登录态（幂等） */
export function useInitAuth(): void {
  useEffect(() => {
    initAuthStore();
  }, []);
}
