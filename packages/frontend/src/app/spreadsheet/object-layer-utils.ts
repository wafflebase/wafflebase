import { parseRef, toSref, type Ref, type Sref, Spreadsheet } from "@wafflebase/sheets";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type DraftLayout = {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

export type HandlePosition =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w";

// ---------------------------------------------------------------------------
// Handle constants
// ---------------------------------------------------------------------------

export const HANDLES: readonly HandlePosition[] = [
  "nw", "n", "ne", "e", "se", "s", "sw", "w",
];

export const HANDLE_SIZE = 8;
export const SELECTION_COLOR = "#1a73e8";
const MIN_OBJECT_SIZE = 20;

export const HANDLE_CURSORS: Record<HandlePosition, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
};

// ---------------------------------------------------------------------------
// 8-directional resize computation
// ---------------------------------------------------------------------------

export function computeResizeDraft(opts: {
  handle: HandlePosition;
  deltaX: number;
  deltaY: number;
  startOffsetX: number;
  startOffsetY: number;
  startWidth: number;
  startHeight: number;
  aspectRatio: number;
  lockAspectRatio: boolean;
}): DraftLayout {
  const {
    handle, deltaX, deltaY,
    startOffsetX, startOffsetY, startWidth, startHeight,
    aspectRatio, lockAspectRatio,
  } = opts;

  const hasEast = handle === "ne" || handle === "e" || handle === "se";
  const hasWest = handle === "nw" || handle === "w" || handle === "sw";
  const hasNorth = handle === "nw" || handle === "n" || handle === "ne";
  const hasSouth = handle === "sw" || handle === "s" || handle === "se";

  let newWidth = startWidth;
  let newHeight = startHeight;
  let newOffsetX = startOffsetX;
  let newOffsetY = startOffsetY;

  if (hasEast) newWidth = startWidth + deltaX;
  if (hasWest) {
    newWidth = startWidth - deltaX;
    newOffsetX = startOffsetX + deltaX;
  }
  if (hasSouth) newHeight = startHeight + deltaY;
  if (hasNorth) {
    newHeight = startHeight - deltaY;
    newOffsetY = startOffsetY + deltaY;
  }

  const isCorner = (hasEast || hasWest) && (hasNorth || hasSouth);
  if (isCorner && lockAspectRatio && aspectRatio > 0) {
    const wScale = newWidth / startWidth;
    const hScale = newHeight / startHeight;
    const scale = Math.abs(wScale - 1) >= Math.abs(hScale - 1) ? wScale : hScale;
    const aspectWidth = startWidth * scale;
    const aspectHeight = startHeight * scale;
    if (hasWest) newOffsetX = startOffsetX + (startWidth - aspectWidth);
    if (hasNorth) newOffsetY = startOffsetY + (startHeight - aspectHeight);
    newWidth = aspectWidth;
    newHeight = aspectHeight;
  }

  // Clamp minimum size. For locked corner resizes, clamp via scale
  // so the aspect ratio is preserved.
  if (isCorner && lockAspectRatio && aspectRatio > 0) {
    const minScale = Math.max(
      MIN_OBJECT_SIZE / startWidth,
      MIN_OBJECT_SIZE / startHeight,
    );
    if (newWidth / startWidth < minScale) {
      newWidth = startWidth * minScale;
      newHeight = startHeight * minScale;
      if (hasWest) newOffsetX = startOffsetX + (startWidth - newWidth);
      if (hasNorth) newOffsetY = startOffsetY + (startHeight - newHeight);
    }
  } else {
    if (newWidth < MIN_OBJECT_SIZE) {
      if (hasWest) newOffsetX -= MIN_OBJECT_SIZE - newWidth;
      newWidth = MIN_OBJECT_SIZE;
    }
    if (newHeight < MIN_OBJECT_SIZE) {
      if (hasNorth) newOffsetY -= MIN_OBJECT_SIZE - newHeight;
      newHeight = MIN_OBJECT_SIZE;
    }
  }

  return { offsetX: newOffsetX, offsetY: newOffsetY, width: newWidth, height: newHeight };
}

// ---------------------------------------------------------------------------
// Anchor re-calculation after move
// ---------------------------------------------------------------------------

export function reanchorAfterMove(opts: {
  spreadsheet: Spreadsheet;
  pointerX: number;
  pointerY: number;
  currentAnchor: Sref;
  draft: DraftLayout;
}): { anchor: Sref; offsetX: number; offsetY: number; width: number; height: number } | null {
  const { spreadsheet, pointerX, pointerY, currentAnchor, draft } = opts;

  let newRef: Ref;
  try {
    newRef = spreadsheet.cellRefFromPoint(pointerX, pointerY);
  } catch {
    return null;
  }

  let newAnchorRect;
  try {
    newAnchorRect = spreadsheet.getCellRectInScrollableViewport(newRef);
  } catch {
    return null;
  }

  let oldAnchorRect;
  try {
    oldAnchorRect = spreadsheet.getCellRectInScrollableViewport(
      parseRef(currentAnchor),
    );
  } catch {
    return null;
  }

  const z = spreadsheet.getZoom() ?? 1;
  return {
    anchor: toSref(newRef) as Sref,
    offsetX: draft.offsetX + (oldAnchorRect.left - newAnchorRect.left) / z,
    offsetY: draft.offsetY + (oldAnchorRect.top - newAnchorRect.top) / z,
    width: draft.width,
    height: draft.height,
  };
}
