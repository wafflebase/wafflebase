import type { ConnectorElement, Endpoint } from '../../model/connector';
import type { AutofitMode, Element, Frame } from '../../model/element';
import { combinedBoundingBox } from '../../model/frame';
import type { Guide } from '../../model/presentation';
import {
  getConnectionSites,
  siteWorldPos,
} from '../canvas/connection-sites';
import { resolveEndpoint } from '../canvas/connector-frame';
import { buildElementWorldLookup } from '../../model/group';
import type { SnapGuide } from './snap';
import type { SmartGuide, Span } from './smart-guides';
import { ADJUSTMENT_HANDLES } from '../canvas/shapes/index';
import {
  adjustmentLocalToWorld,
  defaultAdjustmentsFor,
} from './interactions/adjustment';
import {
  SHAPE_HOVER_RADIUS,
  SITE_SNAP_RADIUS,
} from './interactions/insert-connector';
import { RESIZE_HANDLE_CURSORS, type ResizeHandle } from './hit-test';

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
  guides?: readonly (SnapGuide | SmartGuide)[];
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
   * World frames of the direct children of a singly-selected group.
   * Rendered as faint dashed, handle-less outlines so the user can see
   * the group's members (PowerPoint-style). Empty / omitted = none.
   */
  memberOutlines?: readonly Frame[];
  /**
   * World frame of the innermost group the user has drilled into.
   * Rendered as a faint dashed, handle-less context box so the user
   * sees the enclosing group (Google Slides-style). Omitted when not
   * drilled in.
   */
  contextBox?: Frame;
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
  /**
   * Click handler for the autofit mode toggle. When provided AND a
   * single text element is selected, the overlay paints a small toggle
   * button at the element's bottom-left corner (Google-Slides parity).
   * Clicking flips between `'grow'` (auto-grow box) and `'shrink'` (fixed
   * box, fonts scale). Omit to suppress the toggle entirely.
   */
  onAutofitToggle?: (elementId: string, nextMode: AutofitMode) => void;
  /**
   * When present, paint a faint blue outline around the hovered element
   * (idle hover feedback). The frame is already resolved to world
   * (slide-root) coordinates by the caller (editor's `repaintOverlay`),
   * including the drill-in scope check — `null` or absent suppresses the
   * outline. `id` is used for the `data-slides-hover-highlight` test
   * harness attribute.
   */
  hoverHighlightFrame?: { id: string; frame: Frame } | null;
  /**
   * World-space rectangles to paint as cell-range selection highlights.
   * Each rect is one selected (non-covered) cell anchor's bounding box.
   * Resolved by the editor from `cellSelection` + `computeTableLayout`
   * before this call; the overlay just paints semi-transparent blue
   * boxes on top. Empty / omitted = no cell-range highlight.
   */
  cellRangeRects?: readonly Frame[];
  /**
   * Live preview of an in-progress table column / row resize. Renders
   * as a single 1-px magenta line across the table at the proposed
   * border position. World coords; the editor resolves the table's
   * frame + pending position into the line segment.
   */
  tableResizePreview?: {
    kind: 'col' | 'row';
    /** Line start in world coords. */
    x0: number;
    y0: number;
    /** Line end in world coords. */
    x1: number;
    y1: number;
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

  // Context box (drill-in) + member outlines (group selected). Painted
  // before the hover outline / handles below so those stay on top. The
  // two are mutually exclusive per element (see groupOverlayFrames), so
  // a single faint-dashed style reads correctly in both roles. Both
  // options are only populated when a group selection is active, so the
  // blocks are no-ops in the no-selection case and safe to paint before
  // the early return.
  if (options.contextBox) {
    appendOutline(
      overlay,
      options.contextBox,
      options.scale,
      'wfb-slides-context-box',
    );
  }
  if (options.memberOutlines) {
    for (const frame of options.memberOutlines) {
      appendOutline(overlay, frame, options.scale, 'wfb-slides-member-outline');
    }
  }

  // Hover highlight: faint blue outline on the unselected element under
  // the cursor (idle hover feedback). Painted above member outlines and
  // below connection-site dots + selection handles. Suppression during
  // drag/edit/insert/handle hover is owned by `clearHoverHighlight()`
  // upstream, so by the time the overlay re-renders the frame is null
  // whenever it would compete with an active affordance.
  if (options.hoverHighlightFrame) {
    overlay.appendChild(
      makeHoverHighlight(
        options.hoverHighlightFrame.id,
        options.hoverHighlightFrame.frame,
        options.scale,
      ),
    );
  }

  // Cell-range selection highlights (Google-Slides-style blue tint over
  // selected table cells). One rect per non-covered anchor cell in the
  // range, already resolved to world coords by the editor. Painted
  // under selection handles so the table's outer handles still take
  // pointer-priority. Anchor rotation maps to the rect's CSS rotate.
  if (options.cellRangeRects && options.cellRangeRects.length > 0) {
    for (const r of options.cellRangeRects) {
      overlay.appendChild(makeCellRangeRect(r, options.scale));
    }
  }

  // Live table column / row resize preview (a 1-px magenta line at
  // the proposed border position). Painted above cell-range so it's
  // visible during the gesture; cleared automatically when the editor
  // unsets `pendingTableResize` on pointerup.
  if (options.tableResizePreview) {
    overlay.appendChild(
      makeTableResizePreview(options.tableResizePreview, options.scale),
    );
  }

  // (Table outer-frame ghost is painted AFTER the selection handles
  // below so the dashed outline + translucent fill aren't masked by
  // the solid-#3a7 selection frame that paints at the same position
  // when the editor swaps in the ghost frame for handle alignment.)

  // Connector affordance (Task 13): blue dots over the nearest shape's
  // connection sites. Painted above the hover outline so the dots win
  // visually during a connector draw. The affordance only fires while
  // a connector drag is live (and `clearHoverHighlight()` runs at
  // `onPointerDown`), so in practice the two never paint simultaneously
  // anyway. `pointer-events: none` on each dot keeps them out of the
  // drag.
  renderConnectionPointsOverlay(overlay, options);

  if (selectedElements.length === 0) {
    return;
  }

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

  // Autofit toggle (Google-Slides bottom-left affordance). Single text
  // element, not currently editing (the editing element is filtered out
  // of `selectedElements` upstream), host opted in via `onAutofitToggle`.
  if (
    selectedElements.length === 1 &&
    selectedElements[0].type === 'text' &&
    options.onAutofitToggle
  ) {
    renderAutofitToggle(overlay, selectedElements[0], options);
  }

  // Snap guide lines (drag-time visual feedback). Rendered last so they
  // sit above the selection frame; pointer-events: none keeps them
  // non-interactive. Apply to both rotated and axis-aligned paths so a
  // single rotated element being dragged also gets visible guides.
  if (options.guides && options.guides.length > 0) {
    for (const g of options.guides) {
      if (g.kind === 'equal-spacing' || g.kind === 'equal-distance') {
        for (const node of makeSmartGuideArrows(g, options)) overlay.appendChild(node);
      } else if (g.kind === 'equal-size') {
        for (const node of makeSmartGuideOutlines(g, options)) overlay.appendChild(node);
      } else {
        // Snaps to a presentation guide are visualised by emphasising
        // the permanent guide above (thicker + darker), so don't lay an
        // additional snap-guide line on top.
        if (g.kind === 'guide') continue;
        overlay.appendChild(makeGuide(g, options));
      }
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
  const map = buildElementWorldLookup(allElements ?? []);
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

/**
 * Build a 1 px semi-transparent blue outline div around a hovered
 * element. The div is axis-aligned and CSS-rotated to track the
 * element's stored rotation (same technique as `appendOutline` and
 * `renderRotatedHandles`). Rotation convention: `Frame.rotation` is
 * in radians, as used everywhere else in the overlay.
 *
 * `data-slides-hover-highlight` carries the element id for the
 * browser-test harness (Task A6).
 */
function makeHoverHighlight(id: string, frame: Frame, scale: number): HTMLDivElement {
  const div = document.createElement('div');
  div.style.position = 'absolute';
  div.style.left = `${frame.x * scale}px`;
  div.style.top = `${frame.y * scale}px`;
  div.style.width = `${frame.w * scale}px`;
  div.style.height = `${frame.h * scale}px`;
  div.style.border = '1px solid rgba(26, 115, 232, 0.5)';
  div.style.boxSizing = 'border-box';
  div.style.pointerEvents = 'none';
  if (frame.rotation !== 0) {
    div.style.transformOrigin = 'center';
    div.style.transform = `rotate(${frame.rotation}rad)`;
  }
  div.dataset.slidesHoverHighlight = id;
  return div;
}

/**
 * Live table column / row resize guide. A 1-px magenta line at the
 * proposed border position; same accent the snap guides use so the
 * UX language stays consistent. Pointer-events disabled — the
 * gesture is driven by document-level listeners.
 */
function makeTableResizePreview(
  segment: { kind: 'col' | 'row'; x0: number; y0: number; x1: number; y1: number },
  scale: number,
): HTMLDivElement {
  const div = document.createElement('div');
  div.style.position = 'absolute';
  div.style.background = '#be123c';
  div.style.pointerEvents = 'none';
  div.dataset.slidesTableResize = segment.kind;
  if (segment.kind === 'col') {
    // Vertical line — width 1, height spans the table's vertical
    // extent. Center the 1-px stroke on the proposed boundary so the
    // user sees the guide aligned to where the column edge will land.
    div.style.left = `${segment.x0 * scale - 0.5}px`;
    div.style.top = `${segment.y0 * scale}px`;
    div.style.width = '1px';
    div.style.height = `${(segment.y1 - segment.y0) * scale}px`;
  } else {
    div.style.left = `${segment.x0 * scale}px`;
    div.style.top = `${segment.y0 * scale - 0.5}px`;
    div.style.width = `${(segment.x1 - segment.x0) * scale}px`;
    div.style.height = '1px';
  }
  return div;
}

/**
 * Cell-range selection highlight: a semi-transparent blue fill over the
 * cell's world rect. Lives below the selection handles so the table's
 * outer handles still receive pointer events for resize. Stacks
 * additively in a range — a 2x2 cell range paints four overlapping
 * rects which deepen at intersections; we deliberately keep the alpha
 * low so the overlap doesn't read as a single dark blob.
 */
function makeCellRangeRect(frame: Frame, scale: number): HTMLDivElement {
  const div = document.createElement('div');
  div.style.position = 'absolute';
  div.style.left = `${frame.x * scale}px`;
  div.style.top = `${frame.y * scale}px`;
  div.style.width = `${frame.w * scale}px`;
  div.style.height = `${frame.h * scale}px`;
  div.style.background = 'rgba(26, 115, 232, 0.18)';
  div.style.boxSizing = 'border-box';
  div.style.pointerEvents = 'none';
  if (frame.rotation !== 0) {
    div.style.transformOrigin = 'center';
    div.style.transform = `rotate(${frame.rotation}rad)`;
  }
  div.dataset.slidesCellRange = 'true';
  return div;
}

// Faint dash of the selection accent #3a7 (= #33aa77 = rgb 51,170,119).
const OUTLINE_BORDER = '1px dashed rgba(51, 170, 119, 0.5)';

/**
 * Render a handle-less, non-interactive dashed rectangle at a world
 * frame. Shared by member outlines (group selected) and the drill-in
 * context box. Uses CSS rotate so rotation 0 and rotated frames share
 * one path.
 */
function appendOutline(
  overlay: HTMLDivElement,
  frame: Frame,
  scale: number,
  className: string,
): void {
  const el = document.createElement('div');
  el.className = className;
  el.style.position = 'absolute';
  el.style.left = `${frame.x * scale}px`;
  el.style.top = `${frame.y * scale}px`;
  el.style.width = `${frame.w * scale}px`;
  el.style.height = `${frame.h * scale}px`;
  // Match renderRotatedHandles' `!== 0` guard (Frame.rotation is always
  // a number); a non-zero rotation CSS-rotates the box about its centre.
  if (frame.rotation !== 0) {
    el.style.transform = `rotate(${frame.rotation}rad)`;
    el.style.transformOrigin = 'center';
  }
  el.style.boxSizing = 'border-box';
  el.style.border = OUTLINE_BORDER;
  el.style.pointerEvents = 'none';
  overlay.appendChild(el);
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

const SMART_GUIDE_COLOR = '#e11d48';

/**
 * Render an equal-spacing or equal-distance guide as a pair of
 * 1 px double-headed arrows. Each `Span` describes one arrow shaft
 * along the matched axis at `perpendicular`. Arrowheads are 4 px CSS
 * border triangles. Drawn in HTML/CSS to match the existing
 * `makeGuide` / `makePermanentGuide` style.
 */
function makeSmartGuideArrows(
  guide: { axis: 'x' | 'y'; spans: readonly Span[] },
  options: OverlayOptions,
): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const span of guide.spans) {
    if (guide.axis === 'x') {
      const shaft = document.createElement('div');
      shaft.className = 'wfb-slides-smart-arrow';
      shaft.style.position = 'absolute';
      shaft.style.background = SMART_GUIDE_COLOR;
      shaft.style.pointerEvents = 'none';
      const left  = Math.min(span.from, span.to) * options.scale;
      const right = Math.max(span.from, span.to) * options.scale;
      shaft.style.left = `${left}px`;
      shaft.style.top = `${span.perpendicular * options.scale - 0.5}px`;
      shaft.style.width = `${right - left}px`;
      shaft.style.height = `1px`;
      out.push(shaft);
      out.push(arrowhead('left',  left,  span.perpendicular * options.scale));
      out.push(arrowhead('right', right, span.perpendicular * options.scale));
      out.push(makeSmartGuideLabel(span, 'x', options));
    } else {
      const shaft = document.createElement('div');
      shaft.className = 'wfb-slides-smart-arrow';
      shaft.style.position = 'absolute';
      shaft.style.background = SMART_GUIDE_COLOR;
      shaft.style.pointerEvents = 'none';
      const top    = Math.min(span.from, span.to) * options.scale;
      const bottom = Math.max(span.from, span.to) * options.scale;
      shaft.style.left = `${span.perpendicular * options.scale - 0.5}px`;
      shaft.style.top = `${top}px`;
      shaft.style.width = `1px`;
      shaft.style.height = `${bottom - top}px`;
      out.push(shaft);
      out.push(arrowhead('up',   span.perpendicular * options.scale, top));
      out.push(arrowhead('down', span.perpendicular * options.scale, bottom));
      out.push(makeSmartGuideLabel(span, 'y', options));
    }
  }
  return out;
}

/**
 * Numeric distance label rendered at the midpoint of a smart-guide
 * arrow shaft. Shows the rounded pixel distance with no unit
 * (matches PowerPoint). Styled with the slides editor's rotation-angle
 * tooltip — dark translucent pill with white text — for a unified visual
 * language across overlay annotations.
 */
function makeSmartGuideLabel(
  span: Span,
  axis: 'x' | 'y',
  options: OverlayOptions,
): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'wfb-slides-smart-label';
  el.style.position = 'absolute';
  el.style.padding = '2px 6px';
  el.style.fontSize = '11px';
  el.style.lineHeight = '14px';
  el.style.fontFamily = 'system-ui, sans-serif';
  el.style.color = '#fff';
  el.style.background = 'rgba(0, 0, 0, 0.75)';
  el.style.borderRadius = '3px';
  el.style.pointerEvents = 'none';
  el.style.whiteSpace = 'nowrap';
  el.style.transform = 'translate(-50%, -50%)';
  const distance = Math.round(Math.abs(span.to - span.from));
  el.textContent = String(distance);
  const mid = ((span.from + span.to) / 2) * options.scale;
  const perpPx = span.perpendicular * options.scale;
  if (axis === 'x') {
    // Arrow is horizontal; label sits centered ABOVE the shaft.
    el.style.left = `${mid}px`;
    el.style.top = `${perpPx - 10}px`;
  } else {
    // Arrow is vertical; label sits centered to the RIGHT of the shaft.
    el.style.left = `${perpPx + 10}px`;
    el.style.top = `${mid}px`;
  }
  return el;
}

/** 4 px CSS-border triangle pointing toward the named direction. */
function arrowhead(
  dir: 'left' | 'right' | 'up' | 'down',
  cx: number,
  cy: number,
): HTMLDivElement {
  const h = document.createElement('div');
  h.style.position = 'absolute';
  h.style.pointerEvents = 'none';
  h.style.width = '0';
  h.style.height = '0';
  switch (dir) {
    case 'left':
      h.style.left = `${cx}px`;
      h.style.top = `${cy - 4}px`;
      h.style.borderTop = '4px solid transparent';
      h.style.borderBottom = '4px solid transparent';
      h.style.borderRight = `4px solid ${SMART_GUIDE_COLOR}`;
      break;
    case 'right':
      h.style.left = `${cx - 4}px`;
      h.style.top = `${cy - 4}px`;
      h.style.borderTop = '4px solid transparent';
      h.style.borderBottom = '4px solid transparent';
      h.style.borderLeft = `4px solid ${SMART_GUIDE_COLOR}`;
      break;
    case 'up':
      h.style.left = `${cx - 4}px`;
      h.style.top = `${cy}px`;
      h.style.borderLeft = '4px solid transparent';
      h.style.borderRight = '4px solid transparent';
      h.style.borderBottom = `4px solid ${SMART_GUIDE_COLOR}`;
      break;
    case 'down':
      h.style.left = `${cx - 4}px`;
      h.style.top = `${cy - 4}px`;
      h.style.borderLeft = '4px solid transparent';
      h.style.borderRight = '4px solid transparent';
      h.style.borderTop = `4px solid ${SMART_GUIDE_COLOR}`;
      break;
  }
  return h;
}

/**
 * Render an equal-size guide as a 1 px dashed outline around every
 * matched peer frame. No fill, no label — the outline groups the
 * peers visually so the user sees what "same width/height as" means.
 */
function makeSmartGuideOutlines(
  guide: { matchedFrames: readonly Frame[] },
  options: OverlayOptions,
): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const f of guide.matchedFrames) {
    const el = document.createElement('div');
    el.className = 'wfb-slides-smart-size';
    el.style.position = 'absolute';
    el.style.left = `${f.x * options.scale}px`;
    el.style.top = `${f.y * options.scale}px`;
    el.style.width = `${f.w * options.scale}px`;
    el.style.height = `${f.h * options.scale}px`;
    el.style.border = `1px dashed ${SMART_GUIDE_COLOR}`;
    el.style.boxSizing = 'border-box';
    el.style.pointerEvents = 'none';
    out.push(el);
  }
  return out;
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
  // Resize cursors route through the single source of truth in
  // `hit-test.ts` so the P2.7 edge-zone affordance and the 8-px handle
  // DOM elements can never drift apart on a designer-driven cursor
  // convention change. `rotate` and the fallback live here.
  if (kind in RESIZE_HANDLE_CURSORS) {
    return RESIZE_HANDLE_CURSORS[kind as ResizeHandle];
  }
  if (kind === 'rotate') return 'crosshair';
  return 'default';
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

/**
 * Autofit mode toggle button, painted at the bottom-left corner of a
 * single selected text element. Click advances through all three
 * AutofitMode values in the same order the Format panel lists them:
 *
 *   `none` → `shrink` → `grow` → `none` → ...
 *
 * This is one step beyond the Google-Slides 2-state in-context icon —
 * the third state (autofit off) was previously reachable only via the
 * Format panel / API. Surfacing it inline lets users disable autofit
 * without leaving the canvas.
 *
 * Absent `autofit` is treated as `'grow'` (the pre-autofit default, see
 * `slides-text-autofit.md`), so the first click on a never-set box
 * advances to `'none'`.
 */
const AUTOFIT_TOGGLE_SIZE = 24; // host px
const AUTOFIT_TOGGLE_OFFSET = 6; // host px below the frame
const AUTOFIT_ICON_SIZE = 16; // svg viewport drawn inside the button

/**
 * SVG for the "grow" mode (resize shape to fit text). Visual: a thin
 * rectangle with a vertical two-headed arrow inside, suggesting the box
 * height can change.
 */
const ICON_GROW =
  `<svg viewBox="0 0 16 16" width="${AUTOFIT_ICON_SIZE}" height="${AUTOFIT_ICON_SIZE}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  `<rect x="3" y="3" width="10" height="10" rx="1"/>` +
  `<line x1="8" y1="5.5" x2="8" y2="10.5"/>` +
  `<polyline points="6.5,7 8,5.5 9.5,7"/>` +
  `<polyline points="6.5,9 8,10.5 9.5,9"/>` +
  `</svg>`;

/**
 * SVG for the "shrink" mode (shrink text to fit shape). Visual: a big
 * "A" and a smaller "a", reading as "letters scale down".
 */
const ICON_SHRINK =
  `<svg viewBox="0 0 16 16" width="${AUTOFIT_ICON_SIZE}" height="${AUTOFIT_ICON_SIZE}" fill="currentColor" aria-hidden="true">` +
  `<text x="0" y="13" font-family="-apple-system,system-ui,sans-serif" font-size="11" font-weight="700">A</text>` +
  `<text x="8" y="13" font-family="-apple-system,system-ui,sans-serif" font-size="7" font-weight="700">a</text>` +
  `</svg>`;

/**
 * SVG for the "none" mode (do not autofit). Visual: a fixed rectangle
 * with an X inside, reading as "autofit off — box stays put, text may
 * overflow".
 */
const ICON_NONE =
  `<svg viewBox="0 0 16 16" width="${AUTOFIT_ICON_SIZE}" height="${AUTOFIT_ICON_SIZE}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  `<rect x="3" y="3" width="10" height="10" rx="1"/>` +
  `<line x1="5.5" y1="5.5" x2="10.5" y2="10.5"/>` +
  `<line x1="10.5" y1="5.5" x2="5.5" y2="10.5"/>` +
  `</svg>`;

function renderAutofitToggle(
  overlay: HTMLDivElement,
  element: Element,
  options: OverlayOptions,
): void {
  if (element.type !== 'text' || !options.onAutofitToggle) return;
  const current: AutofitMode = element.data.autofit ?? 'grow';
  // 3-state cycle matching the Format panel order: none → shrink → grow → none.
  const next: AutofitMode =
    current === 'none'
      ? 'shrink'
      : current === 'shrink'
        ? 'grow'
        : 'none';

  const { scale } = options;
  const x = element.frame.x * scale;
  const y = (element.frame.y + element.frame.h) * scale + AUTOFIT_TOGGLE_OFFSET;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'wfb-slides-autofit-toggle';
  // Distinct inline SVGs per mode + a `title` attribute that spells out
  // the current mode and what clicking will do.
  btn.innerHTML =
    current === 'shrink'
      ? ICON_SHRINK
      : current === 'grow'
        ? ICON_GROW
        : ICON_NONE;
  btn.title =
    current === 'none'
      ? 'Do not autofit (click to switch to shrink text on overflow)'
      : current === 'shrink'
        ? 'Shrink text on overflow (click to switch to resize shape to fit text)'
        : 'Resize shape to fit text (click to switch to do not autofit)';
  btn.setAttribute(
    'aria-label',
    current === 'none'
      ? 'Autofit mode: do not autofit. Click to switch to shrink text.'
      : current === 'shrink'
        ? 'Autofit mode: shrink text. Click to switch to resize shape.'
        : 'Autofit mode: resize shape. Click to switch to do not autofit.',
  );
  btn.style.position = 'absolute';
  btn.style.left = `${x}px`;
  btn.style.top = `${y}px`;
  btn.style.width = `${AUTOFIT_TOGGLE_SIZE}px`;
  btn.style.height = `${AUTOFIT_TOGGLE_SIZE}px`;
  btn.style.display = 'inline-flex';
  btn.style.alignItems = 'center';
  btn.style.justifyContent = 'center';
  btn.style.padding = '0';
  btn.style.margin = '0';
  btn.style.border = '1px solid rgba(60, 64, 67, 0.2)';
  btn.style.borderRadius = '4px';
  btn.style.background = '#fff';
  btn.style.color = 'rgb(60, 64, 67)'; // Google-grey-700-ish
  btn.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.15)';
  btn.style.cursor = 'pointer';
  btn.style.boxSizing = 'border-box';
  btn.style.pointerEvents = 'auto';
  btn.style.userSelect = 'none';
  btn.style.transition = 'background 80ms ease, border-color 80ms ease';
  btn.addEventListener('mouseenter', () => {
    btn.style.background = '#f1f3f4';
    btn.style.borderColor = 'rgba(60, 64, 67, 0.35)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.background = '#fff';
    btn.style.borderColor = 'rgba(60, 64, 67, 0.2)';
  });
  // The editor attaches a `pointerdown` listener on the overlay itself
  // (editor.ts) that runs hit-test → select-or-clear. Without stopping
  // propagation HERE the button click would be treated as a click on
  // empty space (the button sits below the frame), deselecting the very
  // element we're trying to toggle. We stop at `pointerdown` because
  // that fires before `mousedown`/`click` and is what the editor listens
  // for. `mousedown.preventDefault()` is kept to also block the focus
  // steal that would otherwise pull focus off the canvas.
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    options.onAutofitToggle?.(element.id, next);
  });
  overlay.appendChild(btn);
}
