/**
 * Wafflebase's answer to "which cell, which block" — the one part of locating a
 * point that cannot be generic.
 *
 * `@wafflebase/debug-report` does the hit-test, the promotion and the region
 * fallback; it takes this as `locateOnCanvas` because only the mounted engine
 * can turn a point into `Sheet1!C7` or `block-…@34`, and the package must not
 * know which engines exist. Adding a third surface is a case here, not a change
 * there.
 */

import type { Point, Target } from "@wafflebase/debug-report";
import { currentDebugSurface, type DebugSurface } from "./surface-registry";
import { locateSheetPoint } from "./locators/sheet";
import { locateDocPoint } from "./locators/doc";

/** Ask the engine that is mounted, if any, for a semantic address. */
export function locateOnSurface(
  point: Point,
  surface: DebugSurface | undefined = currentDebugSurface(),
): Target | undefined {
  if (!surface) return undefined;
  return surface.kind === "sheet"
    ? locateSheetPoint(point, surface)
    : locateDocPoint(point, surface);
}
