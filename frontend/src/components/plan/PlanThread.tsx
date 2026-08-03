"use client";

import {
  ActionBarPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { ArrowDown, Copy, Pencil, RefreshCw } from "lucide-react";

import { MessageParts } from "@/components/plan/message-parts";
import { PlanComposer, PlanSuggestions } from "@/components/plan/PlanComposer";
import { useAppLocale } from "@/hooks/use-app-locale";
import { cn } from "@/lib/utils";

function UserMessage() {
  const { t } = useAppLocale();

  return (
    <MessagePrimitive.Root className="group/usermsg flex w-full items-start justify-end gap-1 py-3">
      <ActionBarPrimitive.Root
        hideWhenRunning
        autohide="always"
        className="flex shrink-0 gap-1 self-center opacity-0 transition-opacity group-hover/usermsg:opacity-100"
      >
        <ActionBarPrimitive.Edit asChild>
          <button
            type="button"
            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-ink-500 hover:bg-surface-800 hover:text-ink-200"
            aria-label={t("plan.edit")}
          >
            <Pencil className="size-3.5" />
          </button>
        </ActionBarPrimitive.Edit>
      </ActionBarPrimitive.Root>
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-600/20 px-4 py-2.5 text-sm text-ink-100 ring-1 ring-brand-500/20">
        <MessageParts />
      </div>
    </MessagePrimitive.Root>
  );
}

function UserEditComposer() {
  const { t } = useAppLocale();

  return (
    <MessagePrimitive.Root className="flex w-full justify-end py-3">
      <ComposerPrimitive.Root
        className="flex w-full max-w-[85%] flex-col rounded-2xl rounded-br-md bg-brand-600/20 px-4 py-2.5 text-sm text-ink-100 ring-1 ring-brand-500/20"
      >
        <ComposerPrimitive.Input
          className="max-h-40 min-h-8 w-full resize-none bg-transparent text-sm text-ink-100 outline-none placeholder:text-ink-500"
        />
        <div className="mt-2 flex items-center justify-end gap-2">
          <ComposerPrimitive.Cancel asChild>
            <button
              type="button"
              className="cursor-pointer rounded-full px-3 py-1 text-xs text-ink-400 transition-colors hover:bg-surface-800 hover:text-ink-200"
            >
              {t("plan.cancel")}
            </button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <button
              type="button"
              className="cursor-pointer rounded-full bg-ink-100 px-3 py-1 text-xs font-medium text-surface-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("plan.saveEdit")}
            </button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  const { t } = useAppLocale();

  return (
    <MessagePrimitive.Root className="flex w-full flex-col items-start gap-2 py-3">
      <div className="max-w-[90%] rounded-2xl rounded-bl-md border border-surface-700/60 bg-surface-900/70 px-4 py-3 shadow-sm backdrop-blur-sm">
        <MessageParts />
        <MessagePrimitive.Error>
          <p className="mt-2 text-xs text-red-400">{t("plan.chatError")}</p>
        </MessagePrimitive.Error>
      </div>
      <ActionBarPrimitive.Root
        hideWhenRunning
        autohide="not-last"
        className="flex gap-1"
      >
        <ActionBarPrimitive.Copy asChild>
          <button
            type="button"
            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-ink-500 hover:bg-surface-800 hover:text-ink-200"
          >
            <Copy className="size-3.5" />
          </button>
        </ActionBarPrimitive.Copy>
        <ActionBarPrimitive.Reload asChild>
          <button
            type="button"
            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-ink-500 hover:bg-surface-800 hover:text-ink-200"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </ActionBarPrimitive.Reload>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

export function PlanThread({ className }: { className?: string }) {
  const { t } = useAppLocale();

  return (
    <ThreadPrimitive.Root
      className={cn("relative flex h-full min-h-0 flex-1 flex-col", className)}
    >
      <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-2 pb-4">
        <ThreadPrimitive.Empty>
          <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-ink-100">
              {t("plan.emptyGreeting")}
            </h2>
            <p className="mt-2 max-w-md text-sm text-ink-400">
              {t("plan.emptyHint")}
            </p>
          </div>
        </ThreadPrimitive.Empty>

        <ThreadPrimitive.Messages
          components={{
            UserMessage,
            UserEditComposer,
            AssistantMessage,
          }}
        />

        <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mt-auto bg-gradient-to-t from-surface-950/80 via-surface-950/40 to-transparent pt-6 pb-2">
          <ThreadPrimitive.ScrollToBottom asChild>
            <button
              type="button"
              className="mx-auto mb-3 flex size-8 cursor-pointer items-center justify-center rounded-full border border-surface-700/80 bg-surface-900/80 text-ink-300 shadow-md backdrop-blur-md disabled:hidden"
            >
              <ArrowDown className="size-4" />
            </button>
          </ThreadPrimitive.ScrollToBottom>

          <PlanComposer />
          <ThreadPrimitive.If empty>
            <PlanSuggestions />
          </ThreadPrimitive.If>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}
