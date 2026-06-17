"use client";

import { useEffect } from "react";

import { initAuthStore } from "@/store";

/** 根布局挂载时初始化认证 store */
export function AuthBootstrap() {
  useEffect(() => {
    initAuthStore();
  }, []);

  return null;
}
