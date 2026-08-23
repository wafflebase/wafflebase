/**
 * Which engine is mounted, so a point on a canvas can become an address.
 *
 * A Canvas surface cannot be interrogated from the outside. `elementsFromPoint`
 * does not even find the canvases — measured on the sheet, both compute to
 * `pointer-events: none` with events handled by their wrapper `div`, so a
 * hit-test at the grid centre returned four divs and zero canvases. The pixels
 * can be read (same-origin), but "which cell" lives inside the engine, and only
 * the engine's own instance can answer it.
 *
 * So the mounted view registers itself here and the locators read it. The shape
 * deliberately mirrors `app/harness/hunt/bridge.ts`'s handles — same idea, same
 * names — so the two registries can merge later rather than diverging into two
 * conventions for the same fact.
 *
 * ONE SURFACE AT A TIME. An editor route mounts exactly one engine, and a
 * registry that could hold several would need a rule for choosing between them
 * that no caller could state. A second registration replaces the first and the
 * unregister handle is identity-checked, so a late cleanup from an unmounting
 * view cannot clear the surface that replaced it.
 *
 * Design: `docs/design/debug-report.md`.
 */

import type { Ref, Spreadsheet } from "@wafflebase/sheets";

/** The sheet engine, as a locator needs it. */
export type SheetSurface = {
  kind: "sheet";
  /** Client point → cell, the engine's own inverse of `getCellRect`. */
  cellRefFromPoint: (clientX: number, clientY: number) => Ref;
  /** Cell → rectangle, relative to the grid canvas. */
  cellRect: (ref: Ref) => { left: number; top: number; width: number; height: number };
  /** The tab a report should name, when the view knows it. */
  sheetName?: () => string | undefined;
  host: HTMLElement;
};

/** The docs engine. */
export type DocSurface = {
  kind: "doc";
  /** Client point → block and offset, or `undefined` off the text. */
  positionAtClientPoint: (
    clientX: number,
    clientY: number,
  ) => { blockId: string; offset: number } | undefined;
  host: HTMLElement;
};

export type DebugSurface = SheetSurface | DocSurface;

/** Just enough of `Spreadsheet` for `sheetSurface` — the rest is not this module's business. */
export type SpreadsheetLike = Pick<Spreadsheet, "cellRefFromPoint" | "getCellRect">;

let current: DebugSurface | undefined;

/**
 * Register the mounted surface. The returned handle unregisters it, and does
 * nothing if something else has since registered.
 */
export function registerDebugSurface(surface: DebugSurface): () => void {
  current = surface;
  return () => {
    if (current === surface) current = undefined;
  };
}

export function currentDebugSurface(): DebugSurface | undefined {
  return current;
}

/** Adapt a live `Spreadsheet` to the registry's shape. */
export function sheetSurface(
  spreadsheet: SpreadsheetLike,
  host: HTMLElement,
  sheetName?: () => string | undefined,
): SheetSurface {
  return {
    kind: "sheet",
    cellRefFromPoint: (x, y) => spreadsheet.cellRefFromPoint(x, y),
    cellRect: (ref) => spreadsheet.getCellRect(ref),
    ...(sheetName ? { sheetName } : {}),
    host,
  };
}
