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
  /**
   * Live pointer position in WORLD (slide-root) coords, when the peer
   * publishes one. Slides does not publish it today — only the board
   * (an unbounded plane, where a bare selection ring is not enough to
   * tell where a collaborator is working) — so `computePeerCursors`
   * returns an empty array on a slides mount and this is a no-op there.
   *
   * Deliberately NOT part of {@link PeerOverlays}: a cursor moves at
   * pointer rate, and the selection chrome must not be rebuilt at that
   * rate (see {@link peersEqualIgnoringCursor}).
   */
  cursor?: { x: number; y: number };
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

/** A peer's live pointer, anchored at a world-coord point. */
export interface PeerCursor {
  x: number;
  y: number;
  color: string;
  label: string;
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

    // Project a cell-range selection first so the ring loop can drop the
    // table's plain outline ONLY when highlights actually replace it. A
    // merge-hole drag range (or a deleted table) yields no rects — keep
    // the ring then so the peer's presence never goes invisible.
    const peerCellRects: Frame[] = [];
    let cellTableId: string | undefined;
    if (peer.selectedTableCells && cellRangeRectsOf) {
      const sel = peer.selectedTableCells;
      const rects = cellRangeRectsOf(sel.elementId, sel);
      if (rects && rects.length > 0) {
        for (const frame of rects) peerCellRects.push(frame);
        cellTableId = sel.elementId;
      }
    }

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

    for (const frame of peerCellRects) cellRects.push({ frame, color: peer.color });
    if (!anchor && peerCellRects.length > 0) {
      anchor = { x: peerCellRects[0].x, y: peerCellRects[0].y };
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

/**
 * Project the peers active on the current slide into cursor draw specs.
 *
 * Separate from {@link computePeerOverlays} on purpose. A cursor changes
 * at pointer rate, while the selection chrome around it changes at edit
 * rate; keeping them apart lets the editor repaint a cheap cursor-only
 * layer per tick instead of rebuilding the whole overlay DOM (which
 * detaches — and therefore blurs — the in-place text-box editor living
 * in that same overlay). Unlike rings, a cursor needs no element lookup:
 * it is already a world-coord point.
 */
export function computePeerCursors(
  peers: readonly PeerView[],
  currentSlideId: string | undefined,
): PeerCursor[] {
  const cursors: PeerCursor[] = [];
  if (!currentSlideId) return cursors;
  for (const peer of peers) {
    if (peer.activeSlideId !== currentSlideId) continue;
    if (!peer.cursor) continue;
    cursors.push({
      x: peer.cursor.x,
      y: peer.cursor.y,
      color: peer.color,
      label: peer.label,
    });
  }
  return cursors;
}

function sameIds(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

function sameActiveFrames(
  a: PeerView['activeFrames'],
  b: PeerView['activeFrames'],
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((f, i) => {
    const o = b[i];
    return (
      f.elementId === o.elementId &&
      f.x === o.x &&
      f.y === o.y &&
      f.w === o.w &&
      f.h === o.h &&
      f.rotation === o.rotation
    );
  });
}

function sameGuide(
  a: PeerView['draggingGuide'],
  b: PeerView['draggingGuide'],
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.axis === b.axis && a.position === b.position;
}

function sameCells(
  a: PeerView['selectedTableCells'],
  b: PeerView['selectedTableCells'],
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.elementId === b.elementId &&
    a.r0 === b.r0 &&
    a.c0 === b.c0 &&
    a.r1 === b.r1 &&
    a.c1 === b.c1
  );
}

/**
 * True when two peer lists carry the same overlay-relevant state, i.e.
 * they differ in nothing but (possibly) their `cursor` positions.
 *
 * The editor uses this to decide whether a `setPeers` call has to rebuild
 * the selection-chrome overlay at all. Hosts re-map presence into fresh
 * `PeerView` objects on every tick, so identity comparison is useless and
 * this compares by value. A false negative (e.g. the host reorders peers)
 * only costs one extra repaint — never a stale one.
 */
export function peersEqualIgnoringCursor(
  a: readonly PeerView[],
  b: readonly PeerView[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((p, i) => {
    const o = b[i];
    return (
      p.clientID === o.clientID &&
      p.color === o.color &&
      p.label === o.label &&
      p.activeSlideId === o.activeSlideId &&
      sameIds(p.selectedElementIds, o.selectedElementIds) &&
      sameActiveFrames(p.activeFrames, o.activeFrames) &&
      sameGuide(p.draggingGuide, o.draggingGuide) &&
      sameCells(p.selectedTableCells, o.selectedTableCells)
    );
  });
}
