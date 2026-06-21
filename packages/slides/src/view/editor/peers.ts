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

export interface PeerOverlays {
  rings: PeerRing[];
  labels: PeerLabel[];
  guides: PeerGuideLine[];
}

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
 *  - otherwise each resolvable `selectedElementIds` frame becomes a ring;
 *  - a single name-tag label anchors to the first ring's top-left;
 *  - a `draggingGuide` becomes a guide line.
 */
export function computePeerOverlays(
  peers: readonly PeerView[],
  currentSlideId: string | undefined,
  worldFrameOf: (elementId: string) => Frame | undefined,
): PeerOverlays {
  const rings: PeerRing[] = [];
  const labels: PeerLabel[] = [];
  const guides: PeerGuideLine[] = [];

  if (!currentSlideId) return { rings, labels, guides };

  for (const peer of peers) {
    if (peer.activeSlideId !== currentSlideId) continue;

    let anchor: { x: number; y: number } | undefined;

    if (peer.activeFrames && peer.activeFrames.length > 0) {
      for (const f of peer.activeFrames) {
        const frame: Frame = { x: f.x, y: f.y, w: f.w, h: f.h, rotation: f.rotation };
        rings.push({ frame, color: peer.color });
        if (!anchor) anchor = { x: frame.x, y: frame.y };
      }
    } else if (peer.selectedElementIds && peer.selectedElementIds.length > 0) {
      for (const id of peer.selectedElementIds) {
        const frame = worldFrameOf(id);
        if (!frame) continue;
        rings.push({ frame, color: peer.color });
        if (!anchor) anchor = { x: frame.x, y: frame.y };
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

  return { rings, labels, guides };
}
