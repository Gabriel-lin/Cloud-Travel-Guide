import type { PickedEntity } from "./types";

export type PointerTool = "cursor" | "hand";
export type PointerView = "first-person" | "third-person";

/** 画布点击的唯一决策。场景执行，相机 rig 只提供 lock / 拖视。 */
export type PointerClickAction =
  | { kind: "ignore" }
  | { kind: "lock"; clearPick: boolean }
  | { kind: "pick"; entity: PickedEntity | null };

/**
 * 光标:命中则检查,未命中则第一人称锁定(并清选中)、第三人称只清选中。
 * 抓手:第一人称锁定,不改选中;第三人称交给拖视。
 * 已锁定或本次按下已拖视:忽略,避免抬起误拾取。
 */
export function resolvePointerClick(input: {
  pointerTool: PointerTool;
  viewMode: PointerView;
  locked: boolean;
  dragged: boolean;
  hit: PickedEntity | null;
}): PointerClickAction {
  if (input.locked || input.dragged) return { kind: "ignore" };
  if (input.pointerTool === "hand") {
    if (input.viewMode === "first-person") return { kind: "lock", clearPick: false };
    return { kind: "ignore" };
  }
  if (input.hit) return { kind: "pick", entity: input.hit };
  if (input.viewMode === "first-person") return { kind: "lock", clearPick: true };
  return { kind: "pick", entity: null };
}

/** Esc 退出检查卡片。指针锁定由浏览器在同一按键上解除。 */
export function clearsInspectOnEscape(e: { key: string; code: string }): boolean {
  return e.key === "Escape" || e.code === "Escape";
}
