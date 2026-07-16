"use client";

import {
  ComposerPrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { ArrowUp, Paperclip } from "lucide-react";

import { AgentSelector } from "@/components/plan/AgentSelector";
import { useAppLocale } from "@/hooks/use-app-locale";
import { cn } from "@/lib/utils";

export function PlanComposer({ className }: { className?: string }) {
  const { t } = useAppLocale();

  return (
    <ComposerPrimitive.Root
      className={cn(
        "mx-auto w-full max-w-3xl rounded-[1.75rem] border border-surface-600/70 bg-surface-900/80 shadow-xl shadow-black/20 ring-1 ring-brand-500/10 backdrop-blur-xl",
        className,
      )}
    >
      <div className="flex items-end gap-2 px-3 pt-3 pb-2">
        <ComposerPrimitive.AddAttachment asChild>
          <button
            type="button"
            className="mb-1 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-surface-800 hover:text-ink-200"
            aria-label={t("plan.attach")}
          >
            <Paperclip className="size-4" strokeWidth={1.75} />
          </button>
        </ComposerPrimitive.AddAttachment>

        <ComposerPrimitive.Input
          rows={1}
          placeholder={t("plan.composerPlaceholder")}
          className="max-h-40 min-h-10 flex-1 resize-none bg-transparent py-2 text-sm text-ink-100 outline-none placeholder:text-ink-500"
        />
      </div>

      <div className="flex items-center justify-between gap-2 px-3 pb-3">
        <AgentSelector />

        <div className="flex items-center gap-2">
          <ComposerPrimitive.Send asChild>
            <button
              type="button"
              className="inline-flex size-9 cursor-pointer items-center justify-center rounded-full bg-ink-100 text-surface-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t("plan.send")}
            >
              <ArrowUp className="size-4" strokeWidth={2.25} />
            </button>
          </ComposerPrimitive.Send>
        </div>
      </div>
    </ComposerPrimitive.Root>
  );
}

export function PlanSuggestions() {
  const { t } = useAppLocale();
  const suggestions = [
    t("plan.suggestionDays"),
    t("plan.suggestionBudget"),
    t("plan.suggestionFamily"),
    t("plan.suggestionFood"),
  ] as const;

  return (
    <div className="mx-auto mt-3 flex w-full max-w-3xl flex-wrap justify-center gap-2">
      {suggestions.map((label) => (
        <ThreadPrimitive.Suggestion
          key={label}
          prompt={label}
          send
          asChild
        >
          <button
            type="button"
            className="cursor-pointer rounded-full border border-surface-700/80 bg-surface-900/60 px-3 py-1.5 text-xs text-ink-300 backdrop-blur-sm transition-colors hover:border-brand-500/40 hover:text-brand-400"
          >
            {label}
          </button>
        </ThreadPrimitive.Suggestion>
      ))}
    </div>
  );
}
