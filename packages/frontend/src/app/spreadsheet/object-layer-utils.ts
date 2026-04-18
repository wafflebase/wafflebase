import { parseRef, toSref, type Ref, type Sref, Spreadsheet } from "@wafflebase/sheets";

export type DraftLayout = {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

/**
 * After a drag-move, re-anchor the object to the cell under the pointer
 * so that row/column insert/delete correctly shifts the object.
 *
 * Returns the patch to apply, or null if re-anchoring failed (caller
 * should fall back to offset-only update).
 */
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
