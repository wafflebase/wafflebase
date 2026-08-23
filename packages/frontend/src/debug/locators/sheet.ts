/**
 * A point on the sheet canvas → `Sheet1!C7`.
 *
 * This is the answer to SP0's fourth finding. Without it a pick on a canvas has
 * nothing to promote to, falls back to the container, and produces a 1280×721
 * photograph of the whole sheet — measured at 81 KB and useless for a note that
 * says "the merged cell's border looks broken", because *which cell* is exactly
 * what is missing.
 *
 * The engine is asked rather than reimplemented: `Spreadsheet.cellRefFromPoint`
 * is the public inverse of `getCellRect` and already accounts for zoom, scroll
 * and freeze panes. Getting any of those wrong here would fail SILENTLY — a
 * report naming the wrong cell reads exactly like a report naming the right one.
 *
 * Design: `docs/design/debug-report.md`.
 */

import { toSref, type Ref } from "@wafflebase/sheets";
import type { Point, Target } from "@wafflebase/debug-report";
import type { SheetSurface } from "../surface-registry";

/**
 * The grid canvases inside a host, largest first.
 *
 * Found by DOM query, not by hit-testing: the sheet's canvases are
 * `pointer-events: none` (measured finding 1), so hit-testing is structurally
 * blind to them.
 */
function gridCanvasBox(host: HTMLElement): DOMRect | undefined {
  const boxes = Array.from(host.querySelectorAll("canvas"), (c) =>
    c.getBoundingClientRect(),
  ).filter((r) => r.width > 0 && r.height > 0);
  if (boxes.length === 0) return undefined;
  // The grid canvas is the biggest one; the overlay shares its box and any
  // chrome canvas is smaller.
  return boxes.sort((a, b) => b.width * b.height - a.width * a.height)[0];
}

const inside = (box: DOMRect, point: Point): boolean =>
  point.x >= box.left &&
  point.x <= box.right &&
  point.y >= box.top &&
  point.y <= box.bottom;

/** A cell reference is only meaningful with finite, non-negative indices. */
function isUsableRef(ref: Ref | undefined): ref is Ref {
  return (
    !!ref &&
    Number.isFinite(ref.r) &&
    Number.isFinite(ref.c) &&
    ref.r >= 1 &&
    ref.c >= 1
  );
}

/**
 * Locate `point` on the sheet.
 *
 * Returns `undefined` — not a guess — when the point is off the grid or the
 * engine cannot name a cell. The caller then falls back to a small region
 * around the cursor, which says less but says nothing false.
 */
export function locateSheetPoint(
  point: Point,
  surface: SheetSurface,
): Target | undefined {
  const canvas = gridCanvasBox(surface.host);
  if (!canvas || !inside(canvas, point)) return undefined;

  let ref: Ref | undefined;
  try {
    ref = surface.cellRefFromPoint(point.x, point.y);
  } catch {
    // The engine refuses on a point it cannot map. That is an answer, not a
    // crash to propagate into the overlay.
    return undefined;
  }
  if (!isUsableRef(ref)) return undefined;

  const cell = surface.cellRect(ref);
  if (
    !Number.isFinite(cell.width) ||
    !Number.isFinite(cell.height) ||
    cell.width <= 0 ||
    cell.height <= 0
  ) {
    return undefined;
  }

  const sheetName = surface.sheetName?.();
  const sref = toSref(ref);
  return {
    kind: "canvas",
    surface: "sheet",
    // `getCellRect` is canvas-relative, and the engine paints a band of its own
    // chrome above the canvas — 43px, measured. Adding the CONTAINER's origin
    // instead puts every rectangle that many pixels high, which silently lands
    // a report one or two rows off; `sheet.cellCenter` in the hunt bridge
    // carries the same warning for the same reason.
    rect: {
      x: canvas.left + cell.left,
      y: canvas.top + cell.top,
      w: cell.width,
      h: cell.height,
    },
    address: sheetName ? `${sheetName}!${sref}` : sref,
  };
}
