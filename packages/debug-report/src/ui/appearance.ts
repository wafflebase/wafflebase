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
