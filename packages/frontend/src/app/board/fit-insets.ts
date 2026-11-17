/**
 * Screen-space margins a fit must keep content out of, because chrome
 * floats over the board there (the minimap in the bottom-right corner, a
 * tool dock, a find box). In host CSS px from each edge.
 */
export interface FitInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: FitInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** A rect in host CSS px, origin at the host's top-left. */
export interface HostRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Marks a floating overlay a fit must not frame content under. Set on the
 * overlay's root element; `measureOverlayInsets` reads every element that
 * carries it.
 */
export const BOARD_OVERLAY_ATTR = "data-board-overlay";

/**
 * The insets that keep a fit clear of every obstacle.
 *
 * An overlay sits against one or two host edges (the minimap touches the
 * right AND the bottom), and keeping content out of its way needs only ONE
 * of them inset: everything right of its left edge, or everything below its
 * top edge. So each obstacle insets the edge it costs the least area to give
 * up — for a 226×190 minimap in a 1280×720 host that is the right edge (18%
 * of the width) rather than the bottom (26% of the height). Obstacles that
 * touch no edge (a box floating mid-screen) are ignored: there is no inset
 * that clears them without discarding half the host.
 *
 * Obstacles are combined per edge by the largest inset, so two overlays on
 * the same edge cost no more than the bigger of them.
 *
 * Pure: host size and rects in, insets out.
 */
export function insetsAvoiding(
  host: { w: number; h: number },
  obstacles: readonly HostRect[],
  /** How close to an edge counts as "against" it, in px. */
  edgeSlack = 24,
): FitInsets {
  const out: FitInsets = { ...NO_INSETS };
  if (!(host.w > 0) || !(host.h > 0)) return out;
  for (const r of obstacles) {
    if (!(r.w > 0) || !(r.h > 0)) continue;
    // Clip to the host: an overlay hanging off-screen only costs what is
    // visible of it.
    const x0 = Math.max(0, r.x);
    const y0 = Math.max(0, r.y);
    const x1 = Math.min(host.w, r.x + r.w);
    const y1 = Math.min(host.h, r.y + r.h);
    if (x1 <= x0 || y1 <= y0) continue;

    // Each edge the obstacle is against, with the inset that clears it and
    // the share of that axis the inset gives up.
    const candidates: { side: keyof FitInsets; inset: number; cost: number }[] = [];
    if (x0 <= edgeSlack) candidates.push({ side: "left", inset: x1, cost: x1 / host.w });
    if (x1 >= host.w - edgeSlack) {
      candidates.push({ side: "right", inset: host.w - x0, cost: (host.w - x0) / host.w });
    }
    if (y0 <= edgeSlack) candidates.push({ side: "top", inset: y1, cost: y1 / host.h });
    if (y1 >= host.h - edgeSlack) {
      candidates.push({ side: "bottom", inset: host.h - y0, cost: (host.h - y0) / host.h });
    }
    if (candidates.length === 0) continue;
    let best = candidates[0];
    for (const c of candidates) if (c.cost < best.cost) best = c;
    out[best.side] = Math.max(out[best.side], best.inset);
  }
  // Never inset away the whole host: a fit into nothing is no fit at all.
  // Past half an axis, give that axis back.
  if (out.left + out.right > host.w / 2) {
    out.left = 0;
    out.right = 0;
  }
  if (out.top + out.bottom > host.h / 2) {
    out.top = 0;
    out.bottom = 0;
  }
  return out;
}

/**
 * The visible `[data-board-overlay]` elements under `scope`, as rects
 * relative to `host` (the board canvas container).
 */
export function overlayRects(scope: ParentNode, host: Element): HostRect[] {
  const origin = host.getBoundingClientRect();
  const rects: HostRect[] = [];
  for (const el of scope.querySelectorAll(`[${BOARD_OVERLAY_ATTR}]`)) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    rects.push({
      x: r.left - origin.left,
      y: r.top - origin.top,
      w: r.width,
      h: r.height,
    });
  }
  return rects;
}

/**
 * The fit insets for the board mounted in `container`, from every marked
 * overlay inside it or beside it in its wrapper (a dock is typically a
 * sibling of the canvas host, not a child).
 */
export function measureOverlayInsets(
  container: HTMLElement,
  host: { w: number; h: number },
): FitInsets {
  const scope = container.parentElement ?? container;
  return insetsAvoiding(host, overlayRects(scope, container));
}
