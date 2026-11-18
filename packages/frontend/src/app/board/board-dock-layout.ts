/**
 * Where the board's tool dock sits, from the host width, the dock's
 * current natural (unclipped) width, and its natural width when expanded
 * (which a folded dock no longer shows, so the caller remembers it). Pure, so the placement rules are testable
 * without a layout engine.
 *
 * The dock shares the bottom edge with the minimap, which sits in the
 * bottom-right corner (`board-minimap.ts`: 12px from the edges, a 200px
 * panel plus its border). Centred is the FigJam/Miro place for a dock, so
 * it is centred whenever that leaves the minimap's corner clear. When it
 * would not, the dock moves to the bottom-left and stops short of the
 * minimap, scrolling sideways if it still does not fit.
 */

/**
 * Below this host width the dock folds its rarer tools under "More". It
 * also folds on a wider host whose expanded dock would not fit.
 */
export const DOCK_COMPACT_BELOW = 640;

/** Inset of the dock from the host's bottom/left edge, in px. */
export const DOCK_EDGE = 12;

/**
 * Room the expanded minimap takes from the right edge: its 12px margin,
 * its 202px panel, and an 10px gap so the two never touch.
 */
export const MINIMAP_CLEARANCE = 224;

/**
 * Room the collapsed minimap takes: only its "Map" toggle stays, about
 * 50px wide (44px+ on a coarse pointer). The minimap starts collapsed
 * below 768px (`defaultMinimapVisible`), so this is what a phone shows.
 */
export const COLLAPSED_MINIMAP_CLEARANCE = 72;

export interface DockLayout {
  /** Fold Hand, Line, Eraser, Section, Image and the rituals into "More". */
  compact: boolean;
  /** Centred on the host, or pinned to its bottom-left. */
  align: "center" | "start";
  /** CSS `max-width` for the dock. */
  maxWidth: string;
}

export function dockLayout(
  hostW: number,
  dockW: number,
  expandedW: number = dockW,
): DockLayout {
  // Not laid out yet (first render, jsdom): the wide default.
  if (!(hostW > 0)) {
    return { compact: false, align: "center", maxWidth: `calc(100% - ${2 * MINIMAP_CLEARANCE}px)` };
  }
  // A narrow host is a phone, whose minimap starts collapsed; any wider
  // host (a desktop window, even one a side panel has narrowed) keeps it open.
  const narrow = hostW < DOCK_COMPACT_BELOW;
  const clearance = narrow ? COLLAPSED_MINIMAP_CLEARANCE : MINIMAP_CLEARANCE;
  // Fold too when the full dock would not fit beside the minimap, e.g. the
  // comments panel narrowed the canvas: otherwise the trailing tools
  // (Stamp, Comment) end up clipped past the dock's edge.
  const compact = narrow || expandedW > hostW - DOCK_EDGE - clearance;
  if (!narrow && (hostW - dockW) / 2 >= clearance) {
    return { compact, align: "center", maxWidth: `calc(100% - ${2 * clearance}px)` };
  }
  return {
    compact,
    align: "start",
    maxWidth: `calc(100% - ${DOCK_EDGE + clearance}px)`,
  };
}
