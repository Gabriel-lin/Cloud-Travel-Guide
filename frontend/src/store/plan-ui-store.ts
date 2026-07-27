"use client";

import { create } from "zustand";

type PlanUiState = {
  agentId: string | null;
  planId: string | null;
  setAgentId: (id: string) => void;
  setPlanId: (id: string | null) => void;
};

export const usePlanUiStore = create<PlanUiState>((set) => ({
  agentId: null,
  planId: null,
  setAgentId: (agentId) => set({ agentId }),
  setPlanId: (planId) => set({ planId }),
}));
