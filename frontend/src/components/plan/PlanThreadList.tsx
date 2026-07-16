"use client";

import {
  ThreadListItemPrimitive,
  ThreadListItemRuntimeProvider,
  useAssistantRuntime,
  useAui,
  useAuiState,
  useThreadListItem,
  useThreadListItemRuntime,
} from "@assistant-ui/react";
import {
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useAppLocale } from "@/hooks/use-app-locale";
import { cn } from "@/lib/utils";

function isPinned(custom: Record<string, unknown> | undefined): boolean {
  return Boolean(custom?.pinned);
}

function PlanThreadListItem() {
  const { t } = useAppLocale();
  const runtime = useThreadListItemRuntime();
  const aui = useAui();
  const title = useThreadListItem((s) => s.title);
  const custom = useThreadListItem((s) => s.custom);
  const pinned = isPinned(custom);

  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title ?? "");

  const openRename = () => {
    setDraftTitle(title ?? "");
    setRenameOpen(true);
  };

  const handlePin = async () => {
    const nextPinned = !pinned;
    await runtime.updateCustom({
      ...(custom ?? {}),
      pinned: nextPinned,
      pinnedAt: nextPinned ? Date.now() : undefined,
    });
    await aui.threads().reload();
  };

  const handleRename = async () => {
    const next = draftTitle.trim();
    if (!next) return;
    await runtime.rename(next);
    setRenameOpen(false);
  };

  const handleDelete = async () => {
    await runtime.delete();
    setDeleteOpen(false);
  };

  return (
    <>
      <ThreadListItemPrimitive.Root className="group mb-0.5 flex items-center gap-0.5 rounded-lg data-active:bg-brand-600/15">
        <ThreadListItemPrimitive.Trigger className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink-300 transition-colors hover:bg-surface-800/70 hover:text-ink-100 data-active:text-brand-400">
          {pinned ? (
            <Pin
              className="size-3 shrink-0 text-brand-400"
              strokeWidth={1.75}
              aria-hidden
            />
          ) : null}
          <span className="truncate">
            <ThreadListItemPrimitive.Title
              fallback={t("plan.untitledThread")}
            />
          </span>
        </ThreadListItemPrimitive.Trigger>

        <DropdownMenu>
          <DropdownMenuTrigger
            className="mr-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-500 opacity-70 outline-none transition-opacity hover:bg-surface-800/80 hover:text-ink-200 hover:opacity-100 focus-visible:opacity-100 data-popup-open:bg-surface-800/80 data-popup-open:text-ink-200 data-popup-open:opacity-100"
            aria-label={t("plan.threadActions")}
          >
            <MoreHorizontal className="size-4" strokeWidth={1.75} />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            side="bottom"
            className="min-w-36 border-surface-700/80 bg-surface-900/95 text-ink-100 backdrop-blur-md"
          >
            <DropdownMenuItem
              className="cursor-pointer gap-2"
              onClick={() => void handlePin()}
            >
              {pinned ? (
                <PinOff className="size-4" strokeWidth={1.75} />
              ) : (
                <Pin className="size-4" strokeWidth={1.75} />
              )}
              {pinned ? t("plan.unpinThread") : t("plan.pinThread")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer gap-2"
              onClick={openRename}
            >
              <Pencil className="size-4" strokeWidth={1.75} />
              {t("plan.renameThread")}
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-surface-700/60" />
            <DropdownMenuItem
              variant="destructive"
              className="cursor-pointer gap-2"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="size-4" strokeWidth={1.75} />
              {t("plan.deleteThread")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ThreadListItemPrimitive.Root>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="border-surface-700/80 bg-surface-900 text-ink-100 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("plan.renameThreadTitle")}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleRename();
              }
            }}
            placeholder={t("plan.renameThreadPlaceholder")}
            className="border-surface-600 bg-surface-950/60"
          />
          <DialogFooter className="border-surface-700/60 bg-surface-950/40 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRenameOpen(false)}
            >
              {t("plan.cancel")}
            </Button>
            <Button
              type="button"
              disabled={!draftTitle.trim()}
              onClick={() => void handleRename()}
            >
              {t("plan.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="border-surface-700/80 bg-surface-900 text-ink-100">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("plan.deleteThreadTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="text-ink-400">
              {t("plan.deleteThreadDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="border-surface-700/60 bg-surface-950/40">
            <AlertDialogCancel>{t("plan.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void handleDelete()}
            >
              {t("plan.deleteThread")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function PlanThreadListItemById({ id }: { id: string }) {
  const assistantRuntime = useAssistantRuntime();
  const itemRuntime = useMemo(
    () => assistantRuntime.threads.getItemById(id),
    [assistantRuntime, id],
  );

  return (
    <ThreadListItemRuntimeProvider runtime={itemRuntime}>
      <PlanThreadListItem />
    </ThreadListItemRuntimeProvider>
  );
}

function PlanThreadListBody() {
  const { t } = useAppLocale();
  // Subscribe to stable store slices — never return a fresh object from the selector
  // (that breaks useSyncExternalStore getServerSnapshot and loops forever).
  const threadIds = useAuiState((s) => s.threads.threadIds);
  const threadItems = useAuiState((s) => s.threads.threadItems);

  const groups = useMemo(() => {
    const raw = threadItems as
      | readonly { id: string; custom?: Record<string, unknown> }[]
      | Record<string, { id: string; custom?: Record<string, unknown> }>;
    const list = Array.isArray(raw) ? raw : Object.values(raw ?? {});
    const byId = new Map(list.map((item) => [item.id, item]));
    const ordered = threadIds
      .map((id) => byId.get(id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    return {
      pinned: ordered.filter((item) => isPinned(item.custom)),
      earlier: ordered.filter((item) => !isPinned(item.custom)),
    };
  }, [threadIds, threadItems]);

  if (groups.pinned.length === 0 && groups.earlier.length === 0) {
    return (
      <p className="px-2 py-3 text-center text-xs text-ink-500">
        {t("plan.historyEmpty")}
      </p>
    );
  }

  return (
    <>
      {groups.pinned.length > 0 ? (
        <div className="mb-2">
          <p className="px-2 py-2 text-[11px] font-medium text-ink-500 uppercase">
            {t("plan.historyPinned")}
          </p>
          {groups.pinned.map((item) => (
            <PlanThreadListItemById key={item.id} id={item.id} />
          ))}
        </div>
      ) : null}

      {groups.earlier.length > 0 ? (
        <div>
          <p className="px-2 py-2 text-[11px] font-medium text-ink-500 uppercase">
            {t("plan.historyEarlier")}
          </p>
          {groups.earlier.map((item) => (
            <PlanThreadListItemById key={item.id} id={item.id} />
          ))}
        </div>
      ) : null}
    </>
  );
}

function NewThreadButton() {
  const { t } = useAppLocale();
  const aui = useAui();

  return (
    <button
      type="button"
      className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-surface-700/80 bg-surface-800/50 px-3 py-2 text-sm font-medium text-ink-200 transition-colors hover:border-brand-500/40 hover:bg-brand-600/10 hover:text-brand-400"
      onClick={() => aui.threads().switchToNewThread()}
    >
      <Plus className="size-4" strokeWidth={1.75} />
      {t("plan.newThread")}
    </button>
  );
}

export function PlanThreadList({ className }: { className?: string }) {
  const { t } = useAppLocale();

  return (
    <aside
      className={cn(
        "flex h-full w-[240px] shrink-0 flex-col border-r border-surface-700/60 bg-surface-900/55 backdrop-blur-md",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-surface-700/60 px-3 py-3">
        <p className="text-xs font-medium tracking-wide text-ink-400 uppercase">
          {t("plan.historyTitle")}
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
        <NewThreadButton />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <PlanThreadListBody />
        </div>
      </div>
    </aside>
  );
}
