"use client";

import { create } from "zustand";

type PlanUiState = {
  agentId: string | null;
  setAgentId: (id: string) => void;
};

export const usePlanUiStore = create<PlanUiState>((set) => ({
  agentId: null,
  setAgentId: (agentId) => set({ agentId }),
}));
