import type { ConnectorElement, Endpoint } from '../../model/connector';
import type { Element, Frame } from '../../model/element';
import { combinedBoundingBox } from '../../model/frame';
import type { Guide } from '../../model/presentation';
import {
  getConnectionSites,
  siteWorldPos,
} from '../canvas/connection-sites';
import { resolveEndpoint } from '../canvas/connector-frame';
import type { SnapGuide } from './snap';
import { ADJUSTMENT_HANDLES } from '../canvas/shapes/index';
import {
  adjustmentLocalToWorld,
  defaultAdjustmentsFor,
} from './interactions/adjustment';
import {
  SHAPE_HOVER_RADIUS,
  SITE_SNAP_RADIUS,
} from './interactions/insert-connector';

const HANDLE_SIZE = 8;             // px
const ROTATE_HANDLE_OFFSET = 24;   // px above top centre
const SITE_DOT_SIZE = 8;           // px (default)
const SITE_DOT_HIGHLIGHT_SIZE = 12; // px (within snap radius)

export interface OverlayOptions {
  /** Host pixels per logical slide pixel. */
  scale: number;
  /** Logical slide width — used to span full-slide guide lines. */
  slideWidth: number;
  /** Logical slide height — used to span full-slide guide lines. */
  slideHeight: number;
  /** Snap guides to render under the selection handles. Empty/omitted = none. */
  guides?: readonly SnapGuide[];
  /**
   * Presentation-wide alignment guides (the ruler's persistent guides).
   * Rendered as 1-px magenta lines spanning the slide canvas, beneath
   * selection handles but above element paints. Phase 3 keeps them
   * visually identical to snap guides; Phase 5 will differentiate
   * (snap = dashed, permanent = solid) once both can coexist on screen.
   */
  permanentGuides?: readonly Guide[];
  /**
   * Live preview of a guide currently being created or repositioned.
   * Painted with reduced opacity so the user can distinguish the
   * in-flight drag from the committed guides underneath. Cleared by
   * the editor on commit / cancel.
   */
  pendingGuide?: { id?: string; axis: 'x' | 'y'; position: number } | null;
  /**
   * All elements on the active slide. Optional and only consulted when a
   * selected connector has an `attached` endpoint — `resolveEndpoint`
   * needs the host element's frame to compute the endpoint's world
   * position. Free endpoints carry their own coords and don't need this
   * map, so callers that don't render connectors can omit it.
   */
  allElements?: readonly Element[];
  /**
   * When present, render the connection-points overlay (Task 13): blue
   * dots at the connection sites of the single nearest non-connector
   * element under `cursor`. `cursor` is in slide-logical coords; `zoom`
   * is the host-pixels-per-slide-pixel scale, used to keep the dots
   * pixel-constant in size and to convert the screen-pixel
   * `SHAPE_HOVER_RADIUS` / `SITE_SNAP_RADIUS` constants into slide-
   * logical distances for the proximity check. Caller sets this during
   * connector-insert drag and connector-endpoint drag; the overlay
   * silently omits the dots in any other mode.
   */
  connectorAffordance?: {
    cursor: { x: number; y: number };
    zoom: number;
  };
}

/**
 * Render selection handles + the selection frame into `overlay`. The
 * overlay is cleared and rebuilt on every call (cheap with at most
 * ~10 child nodes).
 *
 * For a single selected element with rotation === 0 we draw handles
 * on the element's axis-aligned frame. For a single rotated element we
 * draw handles on the rotated frame's actual corners / edge midpoints
 * + a rotated outline; the resize path uses `resizeFrameWorld` which
 * keeps the anchor handle fixed in world space. For multi-selection
 * we fall back to the combined axis-aligned bbox (multi-element
 * rotated resize is a v2 polish item).
 */
export function renderOverlay(
  overlay: HTMLDivElement,
  selectedElements: readonly Element[],
  options: OverlayOptions,
): void {
  overlay.innerHTML = '';

  // Build a set of permanent-guide ids that are currently the active
  // snap target. The snap engine reports `guideId` on its winning
  // SnapGuide entries; we use that to thicken / deepen the matching
  // permanent guide rather than overlay a separate dashed indicator
  // on top.
  const snappedGuideIds = new Set<string>();
  if (options.guides) {
    for (const g of options.guides) {
      if (g.kind === 'guide' && g.guideId) snappedGuideIds.add(g.guideId);
    }
  }

  // Permanent guides paint first so selection handles, snap guides, and
  // connector affordances all overlay on top of them. They render
  // regardless of selection state — the ruler's guides are deck-wide
  // scaffolding, not selection feedback.
  if (options.permanentGuides && options.permanentGuides.length > 0) {
    for (const g of options.permanentGuides) {
      // While dragging an existing guide we paint the pending preview
      // in its place — suppress the committed copy so the user does
      // not see a double line at the original position.
      if (options.pendingGuide?.id === g.id) continue;
      const el = makePermanentGuide(g, options);
      if (snappedGuideIds.has(g.id)) {
        // Thicken + deepen the line so the snap target is obvious.
        // Keeps the visual uncluttered — no extra dashed indicator on
        // top of the existing solid line.
        //
        // Widening from 1 px to 2 px shifts the line's right (or
        // bottom) edge outward by 1 px — visually offsetting the
        // emphasis by 0.5 px from the snapped coord. Counter-shift
        // `left` / `top` by -0.5 so the centre of the 2-px line stays
        // anchored on the snap coordinate.
        el.style.background = '#be123c';
        const pos = g.position * options.scale;
        if (g.axis === 'x') {
          el.style.width = '2px';
          el.style.left = `${pos - 0.5}px`;
        } else {
          el.style.height = '2px';
          el.style.top = `${pos - 0.5}px`;
        }
      }
      overlay.appendChild(el);
    }
  }

  // In-flight drag preview: same line treatment, half-opacity so the
  // user can tell the drag has not committed yet.
  if (options.pendingGuide) {
    const previewGuide: Guide = {
      id: options.pendingGuide.id ?? '__pending__',
      axis: options.pendingGuide.axis,
      position: options.pendingGuide.position,
    };
    const preview = makePermanentGuide(previewGuide, options);
    preview.style.opacity = '0.55';
    overlay.appendChild(preview);
  }

  // Connector affordance (Task 13): blue dots over the nearest shape's
  // connection sites. Rendered first so the selection handles paint on
  // top, but since the affordance only fires while a connector drag is
  // live (no selection handles visible during insert; only endpoint
  // handles during endpoint drag) there's never meaningful overlap.
  // `pointer-events: none` on each dot keeps them out of the drag.
  renderConnectionPointsOverlay(overlay, options);

  if (selectedElements.length === 0) return;

  // Connectors get a custom selection treatment: exactly two endpoint
  // handles (start + end) at the resolved endpoint world positions, no
  // 8-corner resize handles, no rotate handle. A connector's frame is a
  // computed bbox of its endpoints — resizing/rotating it directly is
  // meaningless; the user edits the connector by dragging endpoints.
  // Multi-selection mixing connectors with other elements falls back to
  // the combined axis-aligned bbox (connectors contribute their frame
  // to the bbox like any other element); endpoint handles only render
  // when a single connector is selected.
  if (
    selectedElements.length === 1 &&
    selectedElements[0].type === 'connector'
  ) {
    renderConnectorEndpointHandles(
      overlay,
      selectedElements[0] as ConnectorElement,
      options,
    );
    return;
  }

  if (selectedElements.length === 1 && selectedElements[0].frame.rotation !== 0) {
    renderRotatedHandles(overlay, selectedElements[0].frame, options);
    renderAdjustmentHandles(overlay, selectedElements[0], options);
  } else {
    renderAxisAlignedHandles(overlay, selectedElements, options);
  }

  // Snap guide lines (drag-time visual feedback). Rendered last so they
  // sit above the selection frame; pointer-events: none keeps them
  // non-interactive. Apply to both rotated and axis-aligned paths so a
  // single rotated element being dragged also gets visible guides.
  if (options.guides && options.guides.length > 0) {
    for (const g of options.guides) {
      // Snaps to a presentation guide are visualised by emphasising
      // the permanent guide above (thicker + darker), so don't lay an
      // additional snap-guide line on top.
      if (g.kind === 'guide') continue;
      overlay.appendChild(makeGuide(g, options));
    }
  }
}

/**
 * Render the two endpoint handles for a selected connector. Skips the
 * resize/rotate frame entirely; a connector's frame is a derived bbox
 * and direct manipulation of it has no meaning.
 *
 * Handle visual mirrors `connection-points-overlay` for affordance
 * symmetry: `attached` endpoints are filled (the connector "sticks"
 * to a shape), `free` endpoints are hollow (no host). `data-handle`
 * carries the `'start'` / `'end'` kind so `handleHitTest` and the
 * editor's drag dispatch can route the drag to `dragEndpoint`.
 */
function renderConnectorEndpointHandles(
  overlay: HTMLDivElement,
  connector: ConnectorElement,
  options: OverlayOptions,
): void {
  const { scale, allElements } = options;
  const map = new Map<string, Element>(
    (allElements ?? []).map((e) => [e.id, e]),
  );
  const a = resolveEndpoint(connector.start, map);
  const b = resolveEndpoint(connector.end, map);
  overlay.appendChild(
    makeEndpointHandle('start', connector.start, a.x * scale, a.y * scale),
  );
  overlay.appendChild(
    makeEndpointHandle('end', connector.end, b.x * scale, b.y * scale),
  );
}

function makeEndpointHandle(
  kind: 'start' | 'end',
  endpoint: Endpoint,
  cx: number,
  cy: number,
): HTMLDivElement {
  const el = document.createElement('div');
  el.dataset.handle = kind;
  const attached = endpoint.kind === 'attached';
  el.className = `wfb-slides-handle wfb-slides-endpoint wfb-slides-endpoint-${kind} ${
    attached ? 'wfb-slides-endpoint-attached' : 'wfb-slides-endpoint-free'
  }`;
  el.style.position = 'absolute';
  el.style.left = `${cx - HANDLE_SIZE / 2}px`;
  el.style.top = `${cy - HANDLE_SIZE / 2}px`;
  el.style.width = `${HANDLE_SIZE}px`;
  el.style.height = `${HANDLE_SIZE}px`;
  // Filled circle when attached, hollow circle when free — matches the
  // visual language of the connection-points overlay so the user can
  // tell at a glance whether the endpoint is "sticking" to a shape.
  el.style.background = attached ? '#3a7' : '#fff';
  el.style.border = '1px solid #3a7';
  el.style.borderRadius = '50%';
  // `crosshair` matches the connector-insert tool: in both cases the
  // user is targeting a point in the slide that will become an
  // endpoint, so the same precise-aim cursor reinforces the affordance.
  el.style.cursor = 'crosshair';
  return el;
}

function renderAxisAlignedHandles(
  overlay: HTMLDivElement,
  selectedElements: readonly Element[],
  options: OverlayOptions,
): void {
  const bbox = combinedBoundingBox(selectedElements.map((e) => e.frame));
  if (!bbox) return;

  const { scale } = options;
  const left = bbox.x * scale;
  const top = bbox.y * scale;
  const width = bbox.w * scale;
  const height = bbox.h * scale;

  // Selection frame outline (no data-handle — purely decorative).
  const frame = document.createElement('div');
  frame.className = 'wfb-slides-selection-frame';
  frame.style.position = 'absolute';
  frame.style.left = `${left}px`;
  frame.style.top = `${top}px`;
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  frame.style.pointerEvents = 'none';
  frame.style.boxSizing = 'border-box';
  frame.style.border = '1px solid #3a7';
  overlay.appendChild(frame);

  const positions: Array<[string, number, number]> = [
    ['nw', left,                top],
    ['n',  left + width / 2,    top],
    ['ne', left + width,        top],
    ['e',  left + width,        top + height / 2],
    ['se', left + width,        top + height],
    ['s',  left + width / 2,    top + height],
    ['sw', left,                top + height],
    ['w',  left,                top + height / 2],
    ['rotate', left + width / 2, top - ROTATE_HANDLE_OFFSET],
  ];
  for (const [kind, cx, cy] of positions) {
    overlay.appendChild(makeHandle(kind, cx, cy));
  }

  if (selectedElements.length === 1) {
    renderAdjustmentHandles(overlay, selectedElements[0], options);
  }
}

function renderRotatedHandles(
  overlay: HTMLDivElement,
  frame: Frame,
  options: OverlayOptions,
): void {
  const { scale } = options;
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const cos = Math.cos(frame.rotation);
  const sin = Math.sin(frame.rotation);

  // Map a local-coords point to world coords (logical slide space).
  const localToWorld = (lx: number, ly: number) => {
    const dx = lx - frame.w / 2;
    const dy = ly - frame.h / 2;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  };

  // Rotated outline — draw an axis-aligned div and CSS-rotate around
  // its centre so the rendered rectangle aligns with the rotated frame.
  const outline = document.createElement('div');
  outline.className = 'wfb-slides-selection-frame';
  outline.style.position = 'absolute';
  outline.style.left = `${frame.x * scale}px`;
  outline.style.top = `${frame.y * scale}px`;
  outline.style.width = `${frame.w * scale}px`;
  outline.style.height = `${frame.h * scale}px`;
  outline.style.transform = `rotate(${frame.rotation}rad)`;
  outline.style.transformOrigin = 'center';
  outline.style.pointerEvents = 'none';
  outline.style.boxSizing = 'border-box';
  outline.style.border = '1px solid #3a7';
  overlay.appendChild(outline);

  // Eight resize handles at the rotated corners / edge midpoints.
  const localPositions: Array<[string, number, number]> = [
    ['nw', 0,           0],
    ['n',  frame.w / 2, 0],
    ['ne', frame.w,     0],
    ['e',  frame.w,     frame.h / 2],
    ['se', frame.w,     frame.h],
    ['s',  frame.w / 2, frame.h],
    ['sw', 0,           frame.h],
    ['w',  0,           frame.h / 2],
  ];
  for (const [kind, lx, ly] of localPositions) {
    const w = localToWorld(lx, ly);
    overlay.appendChild(makeHandle(kind, w.x * scale, w.y * scale));
  }

  // Rotate handle: ROTATE_HANDLE_OFFSET (host px) above the rotated
  // top-centre, in the frame's local "up" direction.
  // Local "up" = R(rot) * (0, -1) = (sin(rot), -cos(rot)).
  const topCenter = localToWorld(frame.w / 2, 0);
  const rotateScreenX = topCenter.x * scale + sin * ROTATE_HANDLE_OFFSET;
  const rotateScreenY = topCenter.y * scale - cos * ROTATE_HANDLE_OFFSET;
  overlay.appendChild(makeHandle('rotate', rotateScreenX, rotateScreenY));
}

function makeHandle(kind: string, cx: number, cy: number): HTMLDivElement {
  const el = document.createElement('div');
  el.dataset.handle = kind;
  el.className = `wfb-slides-handle wfb-slides-handle-${kind}`;
  el.style.position = 'absolute';
  el.style.left = `${cx - HANDLE_SIZE / 2}px`;
  el.style.top = `${cy - HANDLE_SIZE / 2}px`;
  el.style.width = `${HANDLE_SIZE}px`;
  el.style.height = `${HANDLE_SIZE}px`;
  el.style.background = kind === 'rotate' ? '#fff' : '#3a7';
  el.style.border = kind === 'rotate' ? '1px solid #3a7' : '1px solid #fff';
  el.style.borderRadius = kind === 'rotate' ? '50%' : '0';
  el.style.cursor = handleCursor(kind);
  return el;
}

function makeGuide(guide: SnapGuide, options: OverlayOptions): HTMLDivElement {
  const { scale, slideWidth, slideHeight } = options;
  const el = document.createElement('div');
  el.className = 'wfb-slides-snap-guide';
  el.style.position = 'absolute';
  el.style.background = '#e11d48';
  el.style.pointerEvents = 'none';
  if (guide.axis === 'x') {
    el.style.left = `${guide.position * scale}px`;
    el.style.top = '0px';
    el.style.width = '1px';
    el.style.height = `${slideHeight * scale}px`;
  } else {
    el.style.left = '0px';
    el.style.top = `${guide.position * scale}px`;
    el.style.width = `${slideWidth * scale}px`;
    el.style.height = '1px';
  }
  return el;
}

/**
 * Render a presentation-wide alignment guide as a 1-px magenta line.
 * The line is extended past the slide bounds by `GUIDE_EXTEND_PX` on
 * each end so it visually connects into the H / V rulers — the
 * canvas-area's `overflow: hidden` clips the excess at its outer
 * frame edge so the line doesn't leak into the notes panel below.
 *
 * `data-guide` carries the guide id so future interaction passes
 * (hover / hit-test) can find it.
 */
function makePermanentGuide(
  guide: Guide,
  options: OverlayOptions,
): HTMLDivElement {
  const { scale, slideWidth, slideHeight } = options;
  const el = document.createElement('div');
  el.className = 'wfb-slides-guide';
  el.dataset.guide = guide.id;
  el.style.position = 'absolute';
  el.style.background = '#e11d48';
  el.style.pointerEvents = 'none';
  if (guide.axis === 'x') {
    el.style.left = `${guide.position * scale}px`;
    el.style.top = `-${GUIDE_EXTEND_PX}px`;
    el.style.width = '1px';
    el.style.height = `${GUIDE_EXTEND_PX * 2 + slideHeight * scale}px`;
  } else {
    el.style.left = `-${GUIDE_EXTEND_PX}px`;
    el.style.top = `${guide.position * scale}px`;
    el.style.width = `${GUIDE_EXTEND_PX * 2 + slideWidth * scale}px`;
    el.style.height = '1px';
  }
  return el;
}

/**
 * Distance (in CSS pixels) the permanent guide line extends past
 * the slide on every side. Large enough to always reach the
 * canvas-area frame on any reasonable viewport; the `overflow:
 * hidden` clip on canvasArea trims the excess.
 */
const GUIDE_EXTEND_PX = 10_000;

function handleCursor(kind: string): string {
  switch (kind) {
    case 'nw': case 'se': return 'nwse-resize';
    case 'ne': case 'sw': return 'nesw-resize';
    case 'n':  case 's':  return 'ns-resize';
    case 'e':  case 'w':  return 'ew-resize';
    case 'rotate':         return 'crosshair';
    default:               return 'default';
  }
}

const ADJUST_HANDLE_SIZE = 8; // px (post-scale, like resize handles)

function renderAdjustmentHandles(
  overlay: HTMLDivElement,
  el: Element,
  options: OverlayOptions,
): void {
  if (el.type !== 'shape') return;
  const handles = ADJUSTMENT_HANDLES.get(el.data.kind);
  if (!handles || handles.length === 0) return;

  const { scale } = options;
  const { frame } = el;

  const adjustments =
    el.data.adjustments ?? defaultAdjustmentsFor(el.data.kind);
  handles.forEach((handle, i) => {
    const local = handle.position({ w: frame.w, h: frame.h }, adjustments);
    const world = adjustmentLocalToWorld(frame, local);
    overlay.appendChild(
      makeAdjustmentHandle(`adjust-${i}`, world.x * scale, world.y * scale),
    );
  });
}

function makeAdjustmentHandle(kind: string, cx: number, cy: number): HTMLDivElement {
  const el = document.createElement('div');
  el.dataset.handle = kind;
  el.className = `wfb-slides-handle wfb-slides-adjust ${kind}`;
  el.style.position = 'absolute';
  el.style.left = `${cx - ADJUST_HANDLE_SIZE / 2}px`;
  el.style.top = `${cy - ADJUST_HANDLE_SIZE / 2}px`;
  el.style.width = `${ADJUST_HANDLE_SIZE}px`;
  el.style.height = `${ADJUST_HANDLE_SIZE}px`;
  el.style.background = '#FFD500';
  el.style.border = '1px solid #000';
  el.style.transform = 'rotate(45deg)'; // diamond
  el.style.cursor = 'pointer';
  return el;
}

/**
 * Pick the non-connector element whose nearest connection site sits
 * closest to the cursor, provided that minimum distance is within
 * `SHAPE_HOVER_RADIUS / zoom` (slide-logical). Returns null when no
 * element qualifies — i.e. the cursor is too far from any site.
 *
 * Center-of-frame distance would gate the affordance based on bbox
 * centre, which is wrong for large shapes: the cursor could sit
 * exactly ON a connection site at the edge (the very position where
 * snap is about to commit) yet still be outside the hover radius
 * relative to the centre. Site-to-cursor distance agrees with the
 * snap rule and the dot-highlight rule below.
 */
function findNearestConnectorTarget(
  cursor: { x: number; y: number },
  elements: readonly Element[],
  zoom: number,
): Element | null {
  if (!Number.isFinite(zoom) || zoom <= 0) return null;
  const hoverLogical = SHAPE_HOVER_RADIUS / zoom;
  let best: Element | null = null;
  let bestD2 = hoverLogical * hoverLogical;
  for (const el of elements) {
    if (el.type === 'connector') continue;
    const sites = getConnectionSites(el);
    for (const site of sites) {
      const w = siteWorldPos(el, site);
      const dx = w.x - cursor.x;
      const dy = w.y - cursor.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = el;
      }
    }
  }
  return best;
}

/**
 * Render the connection-points affordance — blue dots over the
 * connection sites of the single nearest non-connector element under
 * the cursor. No-op unless the caller passed `connectorAffordance`.
 *
 * Nearest-element filter: among all non-connector elements with at
 * least one connection site within `SHAPE_HOVER_RADIUS / zoom`
 * (slide-logical) of the cursor, pick the one with the smallest
 * site→cursor distance. Site distance (not centre distance) means
 * the affordance triggers exactly where snap will commit — even on
 * the edge of a large shape.
 *
 * Highlight rule: a dot is highlighted (larger) when the cursor is
 * within `SITE_SNAP_RADIUS / zoom` of the site's world position —
 * matches the snap rule in `findSnapTarget` so the affordance always
 * agrees with what the live drag will commit.
 *
 * `SHAPE_HOVER_RADIUS` and `SITE_SNAP_RADIUS` are screen-pixel
 * distances; dividing by zoom converts them to slide-logical for the
 * distance check against world coordinates. The rendered dots are
 * pixel-constant size (host pixels), so we multiply the site's world
 * position by `scale` (host px / slide px) to place them.
 */
function renderConnectionPointsOverlay(
  overlay: HTMLDivElement,
  options: OverlayOptions,
): void {
  const aff = options.connectorAffordance;
  if (!aff) return;
  const elements = options.allElements ?? [];
  if (elements.length === 0) return;

  const { cursor, zoom } = aff;
  const nearest = findNearestConnectorTarget(cursor, elements, zoom);
  if (!nearest) return;

  const snapRadiusLogical = SITE_SNAP_RADIUS / zoom;
  const sites = getConnectionSites(nearest);
  for (let i = 0; i < sites.length; i++) {
    const w = siteWorldPos(nearest, sites[i]);
    const cursorD = Math.hypot(w.x - cursor.x, w.y - cursor.y);
    const highlighted = cursorD < snapRadiusLogical;
    overlay.appendChild(
      makeConnectionSiteDot(
        i,
        w.x * options.scale,
        w.y * options.scale,
        highlighted,
      ),
    );
  }
}

function makeConnectionSiteDot(
  index: number,
  cx: number,
  cy: number,
  highlighted: boolean,
): HTMLDivElement {
  const el = document.createElement('div');
  el.dataset.connectionSite = String(index);
  el.className = `wfb-slides-connection-site${
    highlighted ? ' wfb-slides-connection-site-highlighted' : ''
  }`;
  const size = highlighted ? SITE_DOT_HIGHLIGHT_SIZE : SITE_DOT_SIZE;
  el.style.position = 'absolute';
  el.style.left = `${cx - size / 2}px`;
  el.style.top = `${cy - size / 2}px`;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.background = '#3a7';
  el.style.border = '1px solid #fff';
  el.style.borderRadius = '50%';
  el.style.boxSizing = 'border-box';
  // Affordance only — must not intercept the live connector drag.
  el.style.pointerEvents = 'none';
  return el;
}
