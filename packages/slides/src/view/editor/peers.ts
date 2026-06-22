import type { Frame } from '../../model/element';

/**
 * In-canvas peer presence, projected into a presentation-agnostic shape
 * the editor overlay can paint. The frontend host maps Yorkie
 * `SlidesPresence` into this; the editor never reads Yorkie types.
 *
 * Frames in `activeFrames` are WORLD (slide-root) coordinates — the
 * broadcaster resolves group transforms before publishing so the
 * overlay only has to apply the host scale.
 */
export interface PeerView {
  clientID: string;
  /** Stable per-peer colour (e.g. from `getPeerCursorColor`). */
  color: string;
  /** Display name shown on the peer's name tag. */
  label: string;
  /** Slide the peer is currently viewing/editing. */
  activeSlideId?: string;
  /** Element ids the peer has selected on `activeSlideId`. */
  selectedElementIds?: readonly string[];
  /**
   * Live drag/resize/rotate frames (world coords). When present they take
   * precedence over the static `selectedElementIds` ring so the peer's
   * in-flight gesture tracks smoothly instead of snapping per commit.
   */
  activeFrames?: ReadonlyArray<{
    elementId: string;
    x: number;
    y: number;
    w: number;
    h: number;
    rotation: number;
  }>;
  /** Live preview of a guide the peer is creating or dragging. */
  draggingGuide?: { axis: 'x' | 'y'; position: number };
  /**
   * Cell range the peer has selected inside a table. The static analogue
   * of `selectedElementIds` for tables — when present, the table's plain
   * selection ring is suppressed and the cells are highlighted instead
   * (matching the local cell-range overlay). `elementId` is the table.
   */
  selectedTableCells?: {
    elementId: string;
    r0: number;
    c0: number;
    r1: number;
    c1: number;
  };
}

/** A peer selection / live-frame outline, in world coords. */
export interface PeerRing {
  frame: Frame;
  color: string;
}

/** A peer name tag, anchored at a world-coord point (the ring top-left). */
export interface PeerLabel {
  x: number;
  y: number;
  text: string;
  color: string;
}

/** A peer's in-flight guide line. */
export interface PeerGuideLine {
  axis: 'x' | 'y';
  position: number;
  color: string;
}

/** A single highlighted table cell in a peer's cell-range selection. */
export interface PeerCellRect {
  frame: Frame;
  color: string;
}

export interface PeerOverlays {
  rings: PeerRing[];
  labels: PeerLabel[];
  guides: PeerGuideLine[];
  cellRects: PeerCellRect[];
}

/**
 * Resolve a peer's table cell-range to world-space rects. Injected by the
 * editor (which owns `computeTableLayout` + `projectCellRangeRects`) so
 * `computePeerOverlays` stays geometry-free and unit-testable. Returns
 * `undefined` when the table id no longer resolves on the current slide.
 */
export type CellRangeRectsOf = (
  elementId: string,
  range: { r0: number; c0: number; r1: number; c1: number },
) => Frame[] | undefined;

/**
 * Project the peers active on the current slide into overlay draw specs.
 *
 * Pure: `worldFrameOf` injects the editor's element→world-frame lookup
 * so this stays free of slide/group geometry and is unit-testable. All
 * outputs are in world (slide-root) coordinates; the overlay applies the
 * host scale.
 *
 * For each peer on `currentSlideId`:
 *  - if it has live `activeFrames`, every frame becomes a ring (the
 *    static selection ring is suppressed to avoid a doubled outline);
 *  - otherwise each resolvable `selectedElementIds` frame becomes a ring,
 *    EXCEPT the table a peer is cell-selecting (its cells are highlighted
 *    instead, so the ring would double the outline);
 *  - `selectedTableCells` becomes per-cell highlight rects (via the
 *    injected `cellRangeRectsOf`);
 *  - a single name-tag label anchors to the first ring's top-left, or the
 *    first cell rect when only a cell range is selected;
 *  - a `draggingGuide` becomes a guide line.
 */
export function computePeerOverlays(
  peers: readonly PeerView[],
  currentSlideId: string | undefined,
  worldFrameOf: (elementId: string) => Frame | undefined,
  cellRangeRectsOf?: CellRangeRectsOf,
): PeerOverlays {
  const rings: PeerRing[] = [];
  const labels: PeerLabel[] = [];
  const guides: PeerGuideLine[] = [];
  const cellRects: PeerCellRect[] = [];

  if (!currentSlideId) return { rings, labels, guides, cellRects };

  for (const peer of peers) {
    if (peer.activeSlideId !== currentSlideId) continue;

    let anchor: { x: number; y: number } | undefined;
    // The table whose ring is replaced by cell highlights below.
    const cellTableId = peer.selectedTableCells?.elementId;

    if (peer.activeFrames && peer.activeFrames.length > 0) {
      for (const f of peer.activeFrames) {
        const frame: Frame = { x: f.x, y: f.y, w: f.w, h: f.h, rotation: f.rotation };
        rings.push({ frame, color: peer.color });
        if (!anchor) anchor = { x: frame.x, y: frame.y };
      }
    } else if (peer.selectedElementIds && peer.selectedElementIds.length > 0) {
      for (const id of peer.selectedElementIds) {
        // The cell-selected table shows highlights, not a ring.
        if (id === cellTableId) continue;
        const frame = worldFrameOf(id);
        if (!frame) continue;
        rings.push({ frame, color: peer.color });
        if (!anchor) anchor = { x: frame.x, y: frame.y };
      }
    }

    if (peer.selectedTableCells && cellRangeRectsOf) {
      const { elementId, r0, c0, r1, c1 } = peer.selectedTableCells;
      const rects = cellRangeRectsOf(elementId, { r0, c0, r1, c1 });
      if (rects) {
        for (const frame of rects) cellRects.push({ frame, color: peer.color });
        if (!anchor && rects.length > 0) {
          anchor = { x: rects[0].x, y: rects[0].y };
        }
      }
    }

    if (peer.draggingGuide) {
      guides.push({
        axis: peer.draggingGuide.axis,
        position: peer.draggingGuide.position,
        color: peer.color,
      });
    }

    if (anchor) {
      labels.push({ x: anchor.x, y: anchor.y, text: peer.label, color: peer.color });
    }
  }

  return { rings, labels, guides, cellRects };
}
