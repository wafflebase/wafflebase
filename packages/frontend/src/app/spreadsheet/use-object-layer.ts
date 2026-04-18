import { useEffect, useRef, useState } from "react";
import type { Sref, Spreadsheet } from "@wafflebase/sheets";
import {
  type DraftLayout,
  type HandlePosition,
  computeResizeDraft,
  reanchorAfterMove,
} from "./object-layer-utils";

// ---------------------------------------------------------------------------
// Shared DragState type
// ---------------------------------------------------------------------------

export type DragState = {
  objectId: string;
  mode: "move" | "resize";
  handle?: HandlePosition;
  startX: number;
  startY: number;
  startOffsetX: number;
  startOffsetY: number;
  startWidth: number;
  startHeight: number;
  aspectRatio: number;
};

// ---------------------------------------------------------------------------
// useObjectKeyboardShortcuts
// ---------------------------------------------------------------------------

export function useObjectKeyboardShortcuts(opts: {
  selectedId: string | null;
  readOnly: boolean;
  items: Array<{ id: string; offsetX: number; offsetY: number }>;
  onDelete: (id: string) => void;
  onDeselect: () => void;
  onUpdate: (id: string, patch: Partial<{ offsetX: number; offsetY: number }>) => void;
}) {
  const { selectedId, readOnly, items, onDelete, onDeselect, onUpdate } = opts;

  useEffect(() => {
    if (!selectedId || readOnly) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof Element) {
        const grid = document.querySelector("[data-sheet-container]");
        if (!grid?.contains(target)) {
          const tag = target.tagName;
          if (
            tag === "INPUT" ||
            tag === "TEXTAREA" ||
            (target as HTMLElement).isContentEditable
          ) {
            return;
          }
        }
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        event.stopPropagation();
        onDelete(selectedId);
        onDeselect();
      } else if (
        event.key === "ArrowUp" ||
        event.key === "ArrowDown" ||
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight"
      ) {
        event.preventDefault();
        event.stopPropagation();
        const dx =
          event.key === "ArrowLeft" ? -10 : event.key === "ArrowRight" ? 10 : 0;
        const dy =
          event.key === "ArrowUp" ? -10 : event.key === "ArrowDown" ? 10 : 0;
        const item = items.find((i) => i.id === selectedId);
        onUpdate(selectedId, {
          offsetX: (item?.offsetX ?? 0) + dx,
          offsetY: (item?.offsetY ?? 0) + dy,
        });
      } else if (event.key === "Escape") {
        event.stopPropagation();
        onDeselect();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [selectedId, readOnly, items, onDelete, onDeselect, onUpdate]);
}

// ---------------------------------------------------------------------------
// useObjectDragResize
// ---------------------------------------------------------------------------

export function useObjectDragResize(opts: {
  readOnly: boolean;
  spreadsheet: Spreadsheet | undefined;
  lockAspectRatio: boolean;
  items: Array<{ id: string; anchor: Sref }>;
  onUpdate: (id: string, patch: Partial<DraftLayout & { anchor: Sref }>) => void;
}): {
  dragState: DragState | null;
  setDragState: (state: DragState | null) => void;
  drafts: Record<string, DraftLayout>;
} {
  const { readOnly, spreadsheet, lockAspectRatio, onUpdate } = opts;
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftLayout>>({});

  const itemsRef = useRef(opts.items);
  itemsRef.current = opts.items;

  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!dragState || readOnly) return;

    let latestX = dragState.startX;
    let latestY = dragState.startY;

    const toDraft = (clientX: number, clientY: number): DraftLayout => {
      const z = spreadsheet?.getZoom() ?? 1;
      const deltaX = (clientX - dragState.startX) / z;
      const deltaY = (clientY - dragState.startY) / z;

      if (dragState.mode === "move") {
        return {
          offsetX: dragState.startOffsetX + deltaX,
          offsetY: dragState.startOffsetY + deltaY,
          width: dragState.startWidth,
          height: dragState.startHeight,
        };
      }

      return computeResizeDraft({
        handle: dragState.handle!,
        deltaX,
        deltaY,
        startOffsetX: dragState.startOffsetX,
        startOffsetY: dragState.startOffsetY,
        startWidth: dragState.startWidth,
        startHeight: dragState.startHeight,
        aspectRatio: dragState.aspectRatio,
        lockAspectRatio,
      });
    };

    const onPointerMove = (event: PointerEvent) => {
      latestX = event.clientX;
      latestY = event.clientY;
      setDrafts((prev) => ({
        ...prev,
        [dragState.objectId]: toDraft(latestX, latestY),
      }));
    };

    const onPointerUp = (event: PointerEvent) => {
      // Use the pointerup coordinates so the last delta is not dropped.
      latestX = event.clientX;
      latestY = event.clientY;

      const nextDraft = toDraft(latestX, latestY);
      const objectId = dragState.objectId;

      if (dragState.mode === "move" && spreadsheet) {
        const item = itemsRef.current.find((i) => i.id === objectId);
        if (item) {
          const patch = reanchorAfterMove({
            spreadsheet,
            pointerX: latestX,
            pointerY: latestY,
            currentAnchor: item.anchor,
            draft: nextDraft,
          });
          if (patch) {
            onUpdateRef.current(objectId, patch);
            setDrafts((prev) => {
              const remaining = { ...prev };
              delete remaining[objectId];
              return remaining;
            });
            setDragState(null);
            return;
          }
        }
      }

      onUpdateRef.current(objectId, nextDraft);
      setDrafts((prev) => {
        const remaining = { ...prev };
        delete remaining[objectId];
        return remaining;
      });
      setDragState(null);
    };

    const onPointerCancel = () => {
      setDrafts((prev) => {
        const remaining = { ...prev };
        delete remaining[dragState.objectId];
        return remaining;
      });
      setDragState(null);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [dragState, lockAspectRatio, readOnly, spreadsheet]);

  return { dragState, setDragState, drafts };
}
