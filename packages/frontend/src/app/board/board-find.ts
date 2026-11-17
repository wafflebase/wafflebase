import type { Element, Frame, TextBody } from "@wafflebase/slides";
import type { Viewport } from "@wafflebase/board";
import { fitViewportToScene } from "./fit-to-content";
import { sceneBounds } from "./minimap-geometry";
import { rowBands } from "./board-tidy";
import type { FitInsets } from "./fit-insets";

/** World px kept around a match when the view jumps to it. */
export const FIND_PAD = 80;

/** Never magnify a match past this when jumping to it. */
export const FIND_MAX_ZOOM = 2;

function bodyText(body: TextBody | undefined): string {
  if (!body) return "";
  return body.blocks
    .map((block) => block.inlines.map((inline) => inline.text).join(""))
    .join("\n");
}

/**
 * The searchable text of an element: a sticky's or shape's text body, a
 * text box's blocks, a group's members joined. Images and connectors carry
 * none.
 */
export function elementText(el: Element): string {
  if (el.type === "text") return bodyText(el.data);
  if (el.type === "shape") return bodyText(el.data.text);
  if (el.type === "group") return el.data.children.map(elementText).join("\n");
  return "";
}

/**
 * Ids of the top-level elements whose text contains `query`, ignoring case,
 * in reading order (top to bottom by row, left to right within a row — the
 * same rows Tidy up sees), so Enter walks the board the way the eye does.
 * An empty or blank query matches nothing.
 */
export function findMatches(elements: readonly Element[], query: string): string[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return [];
  const hits = elements.filter((e) =>
    elementText(e).toLocaleLowerCase().includes(needle),
  );
  return rowBands(hits.map((e) => ({ id: e.id, frame: e.frame })))
    .flat()
    .map((i) => i.id);
}

/**
 * The viewport that brings a match into view: the match framed with
 * {@link FIND_PAD} around it, clear of the overlays, at no more than the
 * current zoom (or 100%, whichever is larger) — a user zoomed in to read
 * stays zoomed in, and a user surveying the whole board is brought close
 * enough to read the match. Capped at {@link FIND_MAX_ZOOM}.
 */
export function matchViewport(
  frame: Frame,
  host: { w: number; h: number },
  current: Viewport,
  insets?: FitInsets,
): Viewport | undefined {
  const maxZoom = Math.min(FIND_MAX_ZOOM, Math.max(1, current.zoom));
  return fitViewportToScene(sceneBounds([frame], FIND_PAD), host, maxZoom, insets);
}

/** A world frame's rect on screen under `vp`, in host CSS px. */
export function frameOnScreen(
  frame: Frame,
  vp: Viewport,
): { x: number; y: number; w: number; h: number } {
  return {
    x: frame.x * vp.zoom + vp.panX,
    y: frame.y * vp.zoom + vp.panY,
    w: frame.w * vp.zoom,
    h: frame.h * vp.zoom,
  };
}
