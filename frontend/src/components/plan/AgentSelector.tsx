"use client";

import { useEffect, useState } from "react";
import { Bot, ChevronDown, Sparkles } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppLocale } from "@/hooks/use-app-locale";
import { planService, type PlanAgent } from "@/service/plan";
import { usePlanUiStore } from "@/store/plan-ui-store";
import { cn } from "@/lib/utils";

export function AgentSelector({ className }: { className?: string }) {
  const { t } = useAppLocale();
  const agentId = usePlanUiStore((s) => s.agentId);
  const setAgentId = usePlanUiStore((s) => s.setAgentId);
  const [agents, setAgents] = useState<PlanAgent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void planService
      .listAgents()
      .then((data) => {
        if (cancelled) return;
        setAgents(data.agents);
        if (!usePlanUiStore.getState().agentId) {
          setAgentId(data.defaultAgentId);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setAgents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setAgentId]);

  const selected =
    agents.find((a) => a.id === agentId) ??
    agents.find((a) => a.enabled) ??
    null;

  const builtin = agents.filter((a) => a.kind === "builtin");
  const external = agents.filter((a) => a.kind === "external");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={loading}
        className={cn(
          "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-surface-600/70 bg-surface-900/50 px-2.5 text-xs text-ink-200 outline-none transition-colors hover:bg-surface-800/80 disabled:opacity-50",
          className,
        )}
      >
        <Sparkles className="size-3.5 text-brand-400" strokeWidth={1.75} />
        <span className="max-w-[9rem] truncate">
          {selected?.name ?? t("plan.agentPlaceholder")}
        </span>
        <ChevronDown className="size-3.5 opacity-70" />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        className="w-64 border-surface-700/80 bg-surface-900/95 backdrop-blur-md"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-ink-400">
            {t("plan.agentBuiltin")}
          </DropdownMenuLabel>
          {builtin.map((agent) => (
            <DropdownMenuItem
              key={agent.id}
              disabled={!agent.enabled}
              className="cursor-pointer gap-2"
              onClick={() => setAgentId(agent.id)}
            >
              <Bot className="size-4 text-brand-400" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink-100">{agent.name}</p>
                <p className="truncate text-[11px] text-ink-500">
                  {agent.description}
                </p>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>

        <DropdownMenuSeparator className="bg-surface-700/80" />

        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-ink-400">
            {t("plan.agentExternal")}
          </DropdownMenuLabel>
          {external.map((agent) => (
            <DropdownMenuItem key={agent.id} disabled className="gap-2 opacity-60">
              <Bot className="size-4" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{agent.name}</p>
                <p className="truncate text-[11px] text-ink-500">
                  {t("plan.agentComingSoon")}
                </p>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
