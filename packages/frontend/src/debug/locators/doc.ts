/**
 * A point on the docs canvas → the block and offset under it.
 *
 * Same reason as the sheet locator: the pixels are readable but the meaning is
 * not, and a report that says "this paragraph is wrong" with only a rectangle
 * gives an agent nothing to grep for. The engine already computes this for every
 * click; `positionAtClientPoint` is that computation exposed without moving the
 * caret.
 *
 * Docs and sheets come first deliberately, even though the hunt bridge's point
 * readers exist only for slides and board: `hunt-ui` verification supports docs
 * and sheets, so starting here is what lets a report be mechanically checked
 * end to end (`docs/design/debug-report.md`, *Engine locators*).
 */

import type { Point, Rect, Target } from "@wafflebase/debug-report";
import type { DocSurface } from "../surface-registry";

/**
 * How much of the page around the point a docs capture covers.
 *
 * The engine gives a block and an offset, not a glyph rectangle, so the visual
 * evidence is a band around the caret — wide enough to show the line in
 * context, short enough not to be a photograph of the page.
 */
export const DOC_CAPTURE_BAND = { w: 420, h: 96 };

function bandAround(point: Point, host: HTMLElement): Rect {
  const box = host.getBoundingClientRect();
  const w = Math.min(DOC_CAPTURE_BAND.w, box.width);
  const h = Math.min(DOC_CAPTURE_BAND.h, box.height);
  return {
    x: Math.max(box.left, Math.min(point.x - w / 2, box.right - w)),
    y: Math.max(box.top, Math.min(point.y - h / 2, box.bottom - h)),
    w,
    h,
  };
}

/**
 * Locate `point` in the document.
 *
 * `undefined` when the point is off the text — above the first block, in a page
 * margin, or outside the host. The engine deliberately does not clamp there, and
 * neither does this: a clamped answer would name a paragraph the reporter never
 * aimed at, and a report naming the wrong paragraph reads exactly like one
 * naming the right paragraph.
 */
export function locateDocPoint(
  point: Point,
  surface: DocSurface,
): Target | undefined {
  const box = surface.host.getBoundingClientRect();
  if (
    point.x < box.left ||
    point.x > box.right ||
    point.y < box.top ||
    point.y > box.bottom
  ) {
    return undefined;
  }

  let position: { blockId: string; offset: number } | undefined;
  try {
    position = surface.positionAtClientPoint(point.x, point.y);
  } catch {
    return undefined;
  }
  if (!position) return undefined;

  return {
    kind: "canvas",
    surface: "doc",
    rect: bandAround(point, surface.host),
    address: `${position.blockId}@${position.offset}`,
  };
}
