/**
 * What the overlay and the panel share so they cannot drift apart.
 *
 * The two surfaces are one instrument: a reporter sees the reticle and the panel
 * in the same glance, and describing the same target two different ways in them
 * would read as two different tools.
 */

import type { DebugItem, Target } from "../index";

export const ACCENT = "#ff3b6b";

/** Above every app layer. The overlay paints below the panel. */
export const OVERLAY_Z = 2147483646;
export const PANEL_Z = 2147483647;

/**
 * Height the note form is kept inside.
 *
 * A reserve, not a measurement: the form grows with a capture-problem message or
 * an eviction notice, and reserving too little is what let it run off the bottom
 * edge with its buttons unreachable.
 */
export const FORM_MAX_H = 220;

/**
 * The note form's and the preview panel's preferred widths — CEILINGS, not sizes.
 *
 * Both were fixed pixel widths, and a narrow viewport clipped them: measured in a
 * 375-wide frame, the 420 form lost ~53px off the right edge and the 520 panel
 * ran 161px off the LEFT, taking its buttons with it. A reporting tool that
 * cannot be used at the width the defect appears at cannot report that defect.
 *
 * Applied through CSS `min()` rather than by reading `innerWidth`, so the box
 * follows a resize (or a viewport-mode flip in the design editor) without the
 * component needing to re-render.
 */
export const FORM_W = 420;
export const PANEL_W = 520;

/** Gutter kept clear on each side when a box is narrower than its ceiling. */
export const EDGE_GUTTER = 8;

/**
 * How tall the note field may grow before it scrolls.
 *
 * Bounded by `FORM_MAX_H`, which is the reserve the form's vertical clamp keeps
 * free: a field allowed to grow past it would push its own Send button off the
 * bottom of the screen, which is the failure that clamp exists for.
 */
export const NOTE_MAX_H = 96;

export const responsiveWidth = (ceiling: number, gutter = EDGE_GUTTER): string =>
  `min(${ceiling}px, calc(100vw - ${gutter * 2}px))`;

/** One line naming what a report is about. */
export function describeTarget(target: Target): string {
  if (target.kind === "dom") {
    return `${target.tag}${target.testId ? ` · ${target.testId}` : ""} · ${target.selector}`;
  }
  if (target.kind === "canvas") {
    return `${target.surface}${target.address ? ` · ${target.address}` : " · no address"}`;
  }
  if (target.kind === "viewport") {
    // "region" is the word the reporter sees, deliberately — `viewport` is the
    // internal kind name for a dragged rectangle. What changes here is that the
    // branch is EXPLICIT: as a fallback, a kind added later would have quietly
    // described itself as a region.
    return `region${target.elements ? ` · ${target.elements.length} element(s)` : ""}`;
  }
  return `unknown target (${(target as { kind: string }).kind})`;
}

/** The same line, with whatever evidence came with it. */
export function describeItem(item: Pick<DebugItem, "target" | "capture">): string {
  const pixels = item.capture
    ? `${item.capture.w}×${item.capture.h} · ${Math.max(
        1,
        Math.round(item.capture.bytes / 1024),
      )} KB · ${item.capture.layers} layer(s)`
    : "no image";
  return `${describeTarget(item.target)} · ${pixels}`;
}
