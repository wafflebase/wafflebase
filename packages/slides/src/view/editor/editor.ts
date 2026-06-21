import type {
  AutofitMode,
  Crop,
  Element,
  Frame,
  ShapeKind,
  Stroke,
  ShapeElement,
  TableCell,
  TableElement,
  TextElement,
  VerticalAnchorMode,
} from '../../model/element';
import { DEFAULT_CELL_BORDER, DEFAULT_CELL_PADDING } from '../../model/element';
import {
  cropToFull,
  windowToCrop,
  applyCropHandle,
  panFull,
  normalizeCrop,
  rotateVec,
  frameToLocalWindow,
  windowToFrame,
  type Rect,
  type CropHandle,
} from '../../model/image-crop';
import type { Block } from '@wafflebase/docs';
import { clearMeasureCache } from '@wafflebase/docs';
import { SHAPE_TEXT_PADDING } from '../canvas/shape-renderer';
import {
  computeTableLayout,
  nextCellInDirection,
  tableCellAtPoint,
  tableEdgeAt,
  type TableLayout,
} from '../canvas/table-renderer';
import type { ThemeColor } from '../../model/theme';
import type { ConnectorElement } from '../../model/connector';
import { combinedBoundingBox, containsPoint } from '../../model/frame';
import { DEFAULT_HIT_TOLERANCE, type HitTestCtx } from './element-hit';
import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  deckFontScale,
  type Slide,
} from '../../model/presentation';
import type { SlidesStore } from '../../store/store';
import type { Endpoint } from '../../model/connector';
import { resolveEndpoint } from '../canvas/connector-frame';
import { SlideRenderer, type SlideRendererOptions } from '../canvas/slide-renderer';
import {
  alignFrames,
  distributeFrames,
  type AlignDirection,
  type AlignReference,
  type DistributeAxis,
} from './align';
import { ADJUSTMENT_HANDLES, ADJUSTMENT_SPECS } from '../canvas/shapes';
import { showContextMenu, type ContextMenuItem } from './context-menu';
import {
  edgeZoneAt,
  edgeZoneCursor,
  handleHitTest,
  type HandleKind,
} from './hit-test';
import {
  buildInsertElement,
  type ShapeOrTextInsertKind,
} from './interactions/insert';
import { buildFreeformInit } from './interactions/insert-freeform';
import { makeDefaultSlidesTextBlock } from './default-text';
import { bendFromCursor } from '../canvas/connector-bend';
import { commitBend } from './interactions/bend-drag';
import { dragEndpoint } from './interactions/connector-endpoint-drag';
import {
  commitTranslate,
  isSlowDoubleClick,
  SLOW_DOUBLE_CLICK_MAX_DISTANCE_PX,
  SLOW_DOUBLE_CLICK_SEQUENCE_WINDOW_MS,
} from './interactions/drag';
import {
  buildConnectorInit,
  finalizeInsert as finalizeConnectorInsert,
  MIN_DRAG_DISTANCE as CONNECTOR_MIN_DRAG_DISTANCE,
  snappedEndpoint,
  type ConnectorInsertVariant,
} from './interactions/insert-connector';
import {
  constrainToSquare,
  snapEndpointAngle,
  lockAxis,
} from './interactions/constraints';
import { buildKeyRules } from './interactions/keyboard';
import { normalizeRect, selectInRect } from './interactions/lasso';
import { isEmptyPlaceholder } from './interactions/select';
import {
  resizeFrameWorld,
  resizeMultiFrames,
  type ElementSnapshot,
  type MultiResizeResult,
  type ResizeHandle,
} from './interactions/resize';
import { applyRotate } from './interactions/rotate';
import {
  adjustmentLocalToWorld,
  adjustmentWorldToLocal,
  defaultAdjustmentsFor,
  formatAdjustments,
  snapToDefaults,
} from './interactions/adjustment';
import {
  showAdjustmentTooltip,
  hideAdjustmentTooltip,
} from './adjustment-tooltip';
import { runKeyRules, type KeyRule } from './keymap';
import { showLayoutPicker } from './layout-picker';
import { renderOverlay } from './overlay';
import { computeAnimationOrder } from './animation-order';
import { SlidesRuler } from './ruler/ruler';
import {
  hitTestGuide,
  startGuideMove,
  startRulerDragOut,
  type GuideDragHost,
} from './ruler/interactions';
import { Selection } from './selection';
import { hitTestSlide } from './hit-test-elements';
import { snapDelta, type SnapGuide } from './snap';
import { smartGuides, matchSize, type SmartGuide } from './smart-guides';
import { collectSnapCandidates } from './snap-candidates';
import { computePeerOverlays, type PeerView, type PeerOverlays } from './peers';
import { toWorldFrame, fromWorldFrame, groupOverlayFrames } from './frame-space';
import { mountSlidesTextBox, type SlidesTextBoxEditor, getTextRegionRect } from './text-box-editor';
import { getActiveTheme } from '../canvas/render-context';
import { makeColorResolver } from '../canvas/text-renderer';
import {
  buildElementWorldLookup,
  findElementPath,
  flattenElements,
  worldTightFrame,
} from '../../model/group';
import { AnimationPlayer, buildParagraphCounts, compileTimeline } from '../../anim';

/**
 * Connector insert-mode keys exposed by `setInsertMode`. Distinct from
 * `ShapeKind` because connectors live outside the shape registry — they
 * have endpoint-attached endpoints and their own renderer / interaction
 * pipeline. The toolbar passes one of these values; the editor's
 * `startInsert` branches on the `'connector:'` prefix to route into the
 * connector drag flow.
 */
export type ConnectorInsertKind =
  | 'connector:line'
  | 'connector:arrow'
  | 'connector:elbow'
  | 'connector:curved';

export type InsertKind = ShapeKind | 'text' | ConnectorInsertKind;

/**
 * Floor for an auto-grown text box's frame height (logical px). Content
 * height normally exceeds this; the floor only guards against a
 * degenerate near-zero height.
 */
const MIN_TEXT_BOX_H = 24;

/** Internal helper — recognise connector insert-mode keys. */
function isConnectorInsertKind(
  kind: InsertKind | null,
): kind is ConnectorInsertKind {
  return (
    kind === 'connector:line' ||
    kind === 'connector:arrow' ||
    kind === 'connector:elbow' ||
    kind === 'connector:curved'
  );
}

/** Map a connector insert-mode key to its `ConnectorInsertVariant`. */
function connectorVariant(kind: ConnectorInsertKind): ConnectorInsertVariant {
  switch (kind) {
    case 'connector:arrow':
      return 'arrow';
    case 'connector:elbow':
      return 'elbow';
    case 'connector:curved':
      return 'curved';
    case 'connector:line':
    default:
      return 'line';
  }
}

/**
 * Style snapshot captured by `beginFormatPaint` from the current
 * selection. `sourceType` decides which targets the snapshot can be
 * applied to (shape / text → shape & text; connector → connector).
 * `sourceId` is kept so a paste onto the same element no-ops cleanly
 * (otherwise the user would get a no-op `store.batch` entry on their
 * undo stack).
 */
interface PaintSnapshot {
  sourceId: string;
  sourceType: 'shape' | 'connector' | 'text';
  fill?: ThemeColor;
  stroke?: Stroke;
}

export interface SlidesEditorOptions extends SlideRendererOptions {
  canvas: HTMLCanvasElement;
  overlay: HTMLDivElement;
  store: SlidesStore;
  /**
   * Override the text-box mount factory. Used by tests to inject a
   * mock that drives the commit/cancel callbacks synchronously without
   * spinning up the real docs TextEditor inside jsdom (which has no
   * functional Canvas 2D context).
   */
  mountTextBox?: typeof mountSlidesTextBox;
  /**
   * Host hook for `Cmd+Enter` / `Cmd+Shift+Enter`. The editor doesn't
   * own present mode — the surrounding shell does — so we fire this
   * callback and let the host route to its existing presentation
   * entry path. `from` is `'current'` for `Cmd+Enter` and `'first'`
   * for `Cmd+Shift+Enter`. No-op when omitted.
   */
  onStartPresentation?: (from: 'current' | 'first') => void;
  /**
   * Host hook for `Cmd+/`. Opens the shortcuts-help modal. The keyRule
   * bypasses the editable-target gate so help opens even while
   * editing text. No-op when omitted.
   */
  onShowShortcutsHelp?: () => void;
  /**
   * Host hook for `Cmd+K` inside text-box edit mode. Forwarded down
   * to the docs text-box editor; fired by docs/text-editor when the
   * user requests link insertion. No-op when omitted.
   */
  onLinkRequest?: () => void;
  /**
   * Extra hit-test slack (in CSS pixels) around resize / rotate /
   * adjustment handles. The visual handle stays at its 8px size; this
   * only expands the area where a pointer counts as "on" the handle.
   * Default 0 keeps desktop precision. The mobile shell passes ~22
   * (≈ 44px diameter) so fingertips can reliably grab handles.
   */
  touchHandleTolerance?: number;
  /**
   * Surface a non-blocking notice to the user. The slides package has
   * no UI library; frontend wires this to its toast system (e.g. sonner
   * `toast.info`). No-op when omitted.
   */
  onToast?: (message: string) => void;
  /**
   * When true, the editor renders the deck but skips every pointer
   * and keyboard binding. The canvas still paints from the store
   * (so remote peer edits flow through `markDirty()` + `render()`),
   * but clicks, drags, double-click text entry, the context menu,
   * and every document-level keymap action become inert. Used by
   * share-link viewers — see `shared-document.tsx`.
   */
  readOnly?: boolean;
  /**
   * Optional H/V ruler DOM hosts. When all three are supplied the
   * editor instantiates a `SlidesRuler` and paints it on every
   * `render()` / `setHostSize()` call. Omitting them keeps the
   * editor ruler-free (mobile mount, headless tests). Drag-out and
   * guide interactions land in a later phase; this PR is display
   * only — see docs/design/slides/slides-ruler.md.
   */
  hRulerCanvas?: HTMLCanvasElement;
  vRulerCanvas?: HTMLCanvasElement;
  rulerCorner?: HTMLElement;
  /**
   * Optional ruler-bracketed editor body (the gray area surrounding
   * the slide canvas). When supplied, a `pointerdown` whose target is
   * the host itself — i.e., the click landed on the empty area, not on
   * a child like the canvas wrap or the rulers — clears the selection
   * and pops any drilled-in group scope, matching Google Slides'
   * "click outside the slide to deselect" behavior. Omit on shells
   * that don't expose a comparable body region (e.g., the mobile
   * mount).
   */
  bodyHost?: HTMLElement;
  /**
   * Fired after the editor has invalidated the shared `cachedMeasureText`
   * cache in response to a `document.fonts` `loadingdone` event and
   * marked the main canvas dirty. The host wires this to any
   * sibling renderers it owns — most importantly the thumbnail panel,
   * whose own `SlideRenderer` instances drew with the pre-load
   * fallback widths and would otherwise stay stale. No-op when omitted
   * (headless tests, mounts without a thumbnail strip).
   */
  onFontsLoaded?: () => void;
}

export interface SlidesEditor {
  render(): void;
  /**
   * Force the next `render()` call to repaint the canvas + overlay,
   * even if the editor thinks nothing changed locally. Required after
   * an external mutation (a remote Yorkie change, a programmatic
   * store update outside the editor's interaction handlers) — without
   * it, `render()` no-ops because the renderer's dirty flag is reset
   * after each successful paint.
   */
  markDirty(): void;
  getSelection(): readonly string[];
  setSelection(ids: readonly string[]): void;
  onSelectionChange(cb: () => void): () => void;
  /**
   * Replace the set of in-canvas peers (other users editing the same
   * presentation) and repaint the overlay. The host maps Yorkie
   * `SlidesPresence` into presentation-agnostic `PeerView[]` (selection
   * rings, live drag frames, guide previews) and calls this on every
   * peer-presence change. Pass `[]` to clear all peer chrome. No-op on
   * the canvas bitmap — peers live entirely in the DOM overlay.
   */
  setPeers(peers: readonly PeerView[]): void;
  /**
   * Currently-selected cell range inside a table, or `null` when no
   * range is active. Toolbar code reads this to decide whether to show
   * the table-cell controls (fill, vAlign, border).
   *
   * The range may be a single cell (r0 === r1 && c0 === c1) or a
   * rectangular block (always normalised — callers don't need to
   * reorder r0/r1 / c0/c1). `tableId` identifies the host table.
   */
  getCellSelection(): {
    tableId: string;
    r0: number;
    c0: number;
    r1: number;
    c1: number;
  } | null;
  /**
   * Subscribe to cell-range changes. Fires whenever `cellSelection`
   * is set, replaced, or cleared. Returns an unsubscribe function.
   */
  onCellSelectionChange(cb: () => void): () => void;
  setInsertMode(kind: InsertKind | null): void;
  /** Current insert mode, or `null` if no insert mode is active. */
  getInsertMode(): InsertKind | null;
  /**
   * `true` while the current insert mode is a connector variant
   * (`'connector:line'` or `'connector:arrow'`). Subscribe via
   * `onInsertModeChange` to react to transitions — Task 13's
   * connection-points overlay uses this to decide when to render.
   */
  isConnectorMode(): boolean;
  /**
   * Subscribe to insert-mode changes. Fires whenever
   * `setInsertMode` is called, including the editor's own internal
   * reset to `null` after a placement. Returns an unsubscribe fn.
   */
  onInsertModeChange(cb: () => void): () => void;
  getCurrentSlideId(): string | undefined;
  setCurrentSlide(id: string): void;
  /**
   * The id of the text element currently in edit mode, or null if no
   * text-box editor is active. Exposed primarily for tests + future
   * UI affordances (e.g. disabling toolbar actions while editing).
   */
  getEditingElementId(): string | null;
  /**
   * `true` while a text element is in edit mode (i.e. the inline docs
   * text-box editor is mounted and has focus). Use `onTextEditingChange`
   * to react to transitions.
   */
  isTextEditing(): boolean;
  /**
   * Subscribe to text-editing state changes. The callback fires once on
   * entry (after `editingElementId` is set) and once on exit (after it
   * is cleared). Returns an unsubscribe function.
   */
  onTextEditingChange(cb: () => void): () => void;
  /**
   * The active `SlidesTextBoxEditor` while a text element is being
   * edited, or `null` when no text-box is mounted. Use together with
   * `isTextEditing()` to bind text-formatting controls to the editor.
   */
  getActiveTextEditor(): SlidesTextBoxEditor | null;
  /**
   * Programmatically enter text-edit mode on the given element. The
   * element must be a `text` type on the current slide; no-op otherwise.
   * Equivalent to a double-click on the element — the docs text-box is
   * mounted and focused. Safe to call from toolbar buttons and tests.
   */
  enterTextEditing(elementId: string): void;
  /**
   * Exit text-edit mode, committing any in-flight changes to the store.
   * No-op when not currently editing. Equivalent to clicking outside the
   * text-box or pressing Esc (with commit, not discard).
   */
  exitTextEditing(): void;
  /**
   * Enter interactive crop on an image element. The element must be a
   * top-level `image` on the current slide; no-op otherwise. Rotated
   * images are supported (crop runs in the element's local frame);
   * flipped images (`flipH`/`flipV`) are not yet and are rejected.
   * Equivalent to double-clicking the image. Drag the black handles to
   * trim, drag the image to pan; Enter / click-outside commits, Esc
   * cancels. Safe to call from toolbar buttons and tests.
   */
  enterImageCrop(elementId: string): void;
  /**
   * Exit an active crop session. `commit` writes the new frame + crop in
   * one undo step; otherwise the pre-session state is restored. No-op
   * when not cropping.
   */
  exitImageCrop(commit: boolean): void;
  /** `true` while an image crop session is active. */
  isCropping(): boolean;
  /**
   * Clear an image's crop and restore its true proportions (the
   * uncropped frame), in one undo step. No-op for non-image elements or
   * images with no crop. Works for rotated images too — rotation is
   * preserved and the visible image does not shift.
   */
  resetImageCrop(elementId: string): void;
  /**
   * Subscribe to crop-session state changes (fires on enter and exit).
   * Returns an unsubscribe function.
   */
  onCropChange(cb: () => void): () => void;
  /**
   * Subscribe to current-slide changes. Fires whenever
   * `setCurrentSlide` actually changes the rendered slide id.
   * Distinct from `onSelectionChange` because element selection
   * may already be empty when slides switch (clearing an empty
   * selection is a no-op), so subscribers that need a slide-change
   * signal cannot rely on selection notifications alone.
   */
  onCurrentSlideChange(cb: () => void): () => void;
  /**
   * Resize the host canvas dimensions used for the world↔host scale
   * computation. Use this when the surrounding viewport changes size
   * (e.g. a window resize, a panel collapsing) and the canvas + overlay
   * have already been resized to match. The editor re-derives its scale
   * from the new dimensions on the next render and keeps overlay
   * positions in sync.
   *
   * Caller responsibilities:
   *   - update `canvas.width` / `canvas.height` (bitmap pixels)
   *   - update `canvas.style.width` / `style.height` (CSS pixels)
   *   - update `overlay.style.width` / `style.height`
   * The editor only updates its internal scale and triggers a repaint.
   */
  setHostSize(hostWidth: number, hostHeight: number): void;
  /**
   * Update the slide's offset inside the canvas bitmap, in
   * slide-logical pixels. Used when the canvas is bigger than the
   * slide rect so the empty surrounding area can act as a
   * pasteboard. Both axes default to 0 (slide pinned at canvas
   * top-left).
   *
   * Caller responsibilities mirror `setHostSize`: size the canvas
   * bitmap + CSS box to cover both slide and pasteboard before
   * calling. The editor updates its renderer / pointer math and
   * triggers a repaint.
   */
  setSlideOffset(logicalX: number, logicalY: number): void;
  /**
   * Update the ruler's viewport scroll offset (CSS pixels). The slide
   * canvas itself does not scroll — its DOM is sized via `setHostSize`
   * and any overflow scrolling happens in a parent wrapper. The ruler
   * needs to know the wrapper's `scrollLeft` / `scrollTop` so the tick
   * marks track the slide's visible position when the user pans a
   * zoomed-in canvas.
   *
   * No-op when the ruler is not mounted (e.g. read-only viewer). Pass
   * (0, 0) on Fit to clear any leftover offset.
   */
  setRulerScroll(scrollX: number, scrollY: number): void;
  /**
   * Align the selected elements relative to:
   *   - the combined bounding box of the selection, when ≥ 2 are selected;
   *   - the slide canvas (1920×1080), when exactly 1 is selected.
   * Each element's new position is written directly to `frame.x/y` and
   * `frame.rotation` is preserved; rotated elements keep their rotation
   * after aligning (matches Google Slides).
   * No-op when nothing is selected.
   *
   * Wraps every moved frame in a single store.batch() so undo/redo treats
   * the operation atomically.
   */
  align(direction: AlignDirection): void;
  /**
   * Insert a new `rows × cols` table centered on the current slide.
   * Each cell starts with an empty body and `{}` style; the new
   * table's columns/rows are evenly distributed across the supplied
   * `width × height` (default ≈ 480 × 240 px, large enough to be
   * easily readable on a 1920×1080 slide). After insertion the
   * editor selects the new table at the element level so the user
   * sees the resize handles immediately; a second click drills into
   * cell selection (P3.8) and a dblclick enters cell text edit (P3.4).
   *
   * Returns the new table's element id, or `null` when no slide is
   * current.
   */
  insertTable(
    rows: number,
    cols: number,
    opts?: { width?: number; height?: number },
  ): string | null;
  /**
   * Equalize the gaps between consecutive selected elements along the
   * given axis. Endpoints stay; only inner elements move.
   * Spacing uses each frame's axis-aligned `x/y/w/h`; rotation is
   * preserved on every moved element.
   *
   * No-op when fewer than 3 elements are selected.
   */
  distribute(axis: DistributeAxis): void;
  /**
   * Move selected elements one position toward the front (higher array
   * index). Elements already at the end stay put. No-op when nothing is
   * selected or a text-box is active.
   *
   * Operates from highest current index to lowest to avoid index shifts
   * during the batch. Wrapped in `store.batch()` for atomic undo/redo.
   */
  bringForward(): void;
  /**
   * Move selected elements one position toward the back (lower array
   * index). Elements already at index 0 stay put. No-op when nothing is
   * selected or a text-box is active.
   *
   * Operates from lowest current index to highest to avoid index shifts.
   * Wrapped in `store.batch()` for atomic undo/redo.
   */
  sendBackward(): void;
  /**
   * Move all selected elements to the front of the z-order, preserving
   * their relative order among each other. No-op when nothing is selected
   * or a text-box is active.
   */
  bringToFront(): void;
  /**
   * Move all selected elements to the back of the z-order, preserving
   * their relative order among each other. No-op when nothing is selected
   * or a text-box is active.
   */
  sendToBack(): void;
  /**
   * Rotate each selected element by `radians` around its own center,
   * independently. The new `frame.rotation` is normalised into `[0, 2π)`.
   *
   * No-op when nothing is selected or a text-box is active.
   * Each updated frame is written via `store.updateElementFrame` inside
   * a single `store.batch()` for atomic undo/redo.
   */
  rotateBy(radians: number): void;
  /**
   * Wrap the currently selected elements (≥ 2) into a new group.
   * All selected elements must share the same parent (slide root or a
   * single group). After grouping, the new group is selected.
   * No-op when fewer than 2 elements are selected or a text-box is active.
   */
  group(): void;
  /**
   * Dissolve the currently selected group element back into its parent.
   * Selection must be exactly one group element. After ungrouping, the
   * former children are selected.
   * No-op when selection is not a single group element or a text-box is active.
   */
  ungroup(): void;
  /**
   * Remove all currently selected elements from the active slide and
   * clear the selection. Triggers a canvas + overlay repaint so callers
   * (e.g. the mobile toolbar's trash button) don't need to chase
   * `requestRender`. No-op when selection is empty or a text-box is
   * active. Mirrors the desktop context menu's Delete action.
   */
  deleteSelected(): void;

  /**
   * Begin a single-shot format-paint operation. Captures a style
   * snapshot from the current selection (single shape / connector /
   * text element only — multi-select is a no-op). The next pointer-
   * down on a compatible element applies the snapshot and the editor
   * auto-exits paint mode. Esc cancels. Subsequent calls re-capture
   * a fresh snapshot from the (possibly new) selection.
   */
  beginFormatPaint(): void;

  /** Exit paint mode without applying. Safe to call when not painting. */
  cancelFormatPaint(): void;

  /** `true` while a format-paint snapshot is staged. */
  isPaintingFormat(): boolean;

  /**
   * Subscribe to format-paint state changes. The callback fires once
   * on enter (after the snapshot is captured) and once on exit
   * (whether by paste, Esc, or cancel). Returns an unsubscribe fn.
   */
  onPaintFormatChange(cb: () => void): () => void;

  /**
   * Id of the unselected element currently painted with an idle hover
   * outline, or `null` when no element is hovered / the hovered element
   * is already selected / a drag/insert/edit interaction is live.
   * Exposed for tests and future overlay rendering.
   */
  getHoverHighlightId(): string | null;

  /**
   * Get the last computed hover cursor. Exposed for tests.
   */
  getLastHoverCursor(): string;

  /**
   * Preview the current slide's animations on the editor canvas.
   * Auto-plays every step back-to-back (unlike the presenter which
   * waits for clicks). The canvas returns to static render when done.
   *
   * No-op when the current slide has no animations. If a preview is
   * already running it is cancelled and a new one starts from step 0.
   */
  previewAnimations(): void;

  detach(): void;
}

interface ListenerEntry<E extends Event = Event> {
  target: EventTarget;
  type: string;
  handler: (e: E) => void;
}

class SlidesEditorImpl implements SlidesEditor {
  readonly selection = new Selection();
  insertKind: InsertKind | null = null;
  private lastHoverCursor: string = '';
  private renderer: SlideRenderer;
  private listeners: ListenerEntry[] = [];
  private disposed = false;
  private keyRules!: KeyRule[];
  private currentId: string | undefined;
  private currentSlideListeners = new Set<() => void>();
  private insertModeListeners = new Set<() => void>();
  /**
   * Logical-coord position of the hover-preview ghost while a shape
   * insert is armed and the cursor is over the slide. `null` whenever
   * the ghost should not paint (no insert mode, text mode, cursor
   * outside the canvas, mid-drag). Only shape kinds get a ghost —
   * text drag-inserts but an empty text box paints nothing, so no
   * preview is shown.
   */
  private hoverPreview: { kind: ShapeKind; x: number; y: number } | null = null;
  /**
   * Id of the element currently painted with an idle hover outline.
   * Distinct from `hoverPreview` (insert-mode shape ghost). Null when
   * no element is hovered, when the hover target is part of the active
   * selection, or when any drag/insert/edit interaction is live.
   */
  private hoverHighlightId: string | null = null;
  /**
   * True between `onPointerDown` and the matching `pointerup` /
   * `pointercancel`, regardless of which drag flavour ran (move, lasso,
   * resize, rotate, insert, connector endpoint). Read by
   * `onSelectionHoverMove` to skip re-picking a hover target while a
   * gesture is live — the canvas pointermove listener keeps firing
   * during document-level drags.
   */
  private pointerInteractionActive = false;
  /**
   * P1.5 — last element id whose pointer-down landed inside its bbox,
   * and the timestamp of that pointer-down. Slow-double-click is only
   * eligible when the CURRENT pointer-down lands on the SAME element
   * within `SLOW_DOUBLE_CLICK_SEQUENCE_WINDOW_MS` of the previous one.
   * Without this gate a single click on a programmatically pre-selected
   * element (collab presence restore, keyboard navigation, etc.) would
   * incorrectly enter edit mode on first contact — the design spec at
   * docs/design/slides/slides-hover-and-text-edit-entry.md § P1.5
   * requires a real prior click in the sequence, not just "selection
   * includes this id".
   */
  private lastClickElementId: string | null = null;
  private lastClickAt: number = 0;
  /** rAF handle so rapid mousemoves coalesce into one paint per frame. */
  private hoverRenderRaf: number | null = null;
  /** rAF handle for the in-editor animation preview. Null when idle. */
  private previewRafHandle: number | null = null;
  /** Suppress hover ghost during an active drag-to-size insert. */
  private insertDragging = false;
  /**
   * True while a connector endpoint drag (start/end handle) is in
   * flight. The canvas `pointerleave` handler must not clear
   * `connectorCursor` or repaint the overlay during this drag: the
   * cursor regularly passes over overlay DOM (the connector's own
   * handles, the live ghost, snap-site dots), each crossing fires
   * `pointerleave` on the canvas, and the resulting `repaintOverlay`
   * call would wipe the endpoint ghost on every move.
   */
  private endpointDragging = false;
  /**
   * Logical-coord cursor position to drive the Task 13 connection-
   * points overlay. Set whenever the connector tool is armed and the
   * cursor is over the slide (whether or not a drag is in flight),
   * cleared when the connector tool disarms or the cursor leaves the
   * canvas without a drag. During an active connector drag (insert or
   * endpoint), the drag handlers update this directly so the dots
   * follow the cursor even while the drag has captured pointer events
   * on `document`.
   */
  private connectorCursor: { x: number; y: number } | null = null;
  /**
   * Element id of the text-box currently in edit mode, or null. While
   * non-null:
   *   - drag/resize/rotate/lasso interactions are short-circuited
   *   - selection handles are filtered out for this element so the
   *     overlay paints only the text-box editor (no interfering
   *     resize handles on top of the editor)
   *   - clicks outside the text-box's container commit + exit edit mode
   */
  private editingElementId: string | null = null;
  /**
   * Cell coordinates being edited when the active text-box targets a
   * TableElement cell. Set in `enterEditMode` when the dblclick path
   * passes a `cell` option; cleared in `finishEditMode`. Used by
   * `maskEditingElement` to clear ONLY the targeted cell's body on the
   * canvas underlay so the in-place editor doesn't double-paint.
   */
  private editingCellCoords: { row: number; col: number } | null = null;
  /**
   * Cell-range selection inside a TableElement. Set when the user
   * clicks a cell of an already-element-selected table; cleared when
   * the user clicks a different element, presses Esc, or enters text
   * edit. The range is inclusive on both ends and stored as the raw
   * (r0,c0)-(r1,c1) tuple; the overlay renderer resolves it to
   * world-space rects via `computeTableLayout`.
   *
   * Independent from `selection` (which still holds the table's id at
   * the element level) and from `editingCellCoords` (which is only
   * meaningful inside an active text edit).
   */
  private cellSelection:
    | { tableId: string; r0: number; c0: number; r1: number; c1: number }
    | null = null;
  /**
   * Live preview of a table column / row drag-resize. Set on
   * pointerdown over a border; updated on pointermove (overlay
   * paints a 1-px magenta guide at `position`); cleared on
   * pointerup / pointercancel — and at that point the final widths
   * or heights commit via `updateTableColumnWidths` /
   * `updateTableRowHeights` in one batch (one undo entry per
   * gesture).
   */
  private pendingTableResize:
    | {
        tableId: string;
        kind: 'col' | 'row';
        index: number;
        position: number;
      }
    | null = null;
  private editingTextBox: SlidesTextBoxEditor | null = null;
  /**
   * Latest content height (logical px) reported by the active text-box
   * editor via onContentHeightChange. Null when not editing or when the
   * editor has not reported yet. Read at commit to fit the frame height.
   */
  private lastEditingContentHeight: number | null = null;
  /**
   * True while editing an auto-grow text element whose frame height may
   * be driven live by `lastEditingContentHeight`. Set at enter-edit
   * (text element, no transformed ancestor) and reset on exit. Gates the
   * underlay re-render so the box fill/border grows in lockstep with the
   * live editor; matches the grow condition the commit path applies.
   */
  private editingGrowApplicable = false;
  /** Listeners for text-editing state changes (enter + exit). */
  private textEditingListeners = new Set<() => void>();
  /**
   * Active image crop session, or null when not cropping. Mutually
   * exclusive with text edit. Crop is edited in the element's CENTRED-
   * LOCAL space (origin at the frame centre, rotation removed): `full`
   * is the whole-bitmap rect, `window` is the bright crop window, both
   * centred on the origin. `center` is the fixed world rotation centre
   * and `rotation`/`cos`/`sin` its angle — applied when rendering, when
   * placing handles, and when projecting pointer deltas, so a rotated
   * image crops in its own rotated frame. Entry is top-level only (scope
   * transforms would otherwise be needed). A cancel is a pure no-op:
   * drags mutate only the in-memory `full`/`window`, and the store is
   * written once on commit.
   */
  private cropSession:
    | {
        slideId: string;
        elementId: string;
        src: string;
        center: { x: number; y: number };
        rotation: number;
        cos: number;
        sin: number;
        full: Rect;
        window: Rect;
      }
    | null = null;
  /** Capture-phase keydown handler installed while a crop session runs. */
  private cropKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  /**
   * Teardown for an in-flight crop trim/pan drag (removes the document
   * pointermove/up/cancel listeners). Called on pointerup/cancel and also
   * from `finishCropSession` / `detach` so an abandoned drag (session
   * ended or editor torn down before release) cannot leak listeners.
   */
  private cropDragCleanup: (() => void) | null = null;
  /** Listeners for crop-session state changes (enter + exit). */
  private cropListeners = new Set<() => void>();
  /** Listeners for table cell-range selection state changes. */
  private cellSelectionListeners = new Set<() => void>();
  /**
   * Current scroll offset of the slide canvas's scroll wrapper, in CSS
   * pixels. The slide canvas itself does not scroll — the host shell
   * owns a `scrollHost` div that wraps it. The editor mirrors the
   * shell's `scrollLeft` / `scrollTop` so the ruler can shift its tick
   * origin to track the visible portion of the slide.
   */
  private rulerScrollX = 0;
  private rulerScrollY = 0;
  /**
   * Format-paint snapshot, populated by `beginFormatPaint` from the
   * current selection. The next pointer-down on a compatible element
   * applies it and clears the snapshot. Esc also clears.
   *
   * v1 supports homogeneous element-frame paint only:
   * shape/connector/text element → shape/connector/text element. The
   * source element type is tracked so the paste applies only to
   * compatible targets — connectors paste only `stroke`, shapes /
   * text-boxes paste `fill + stroke`.
   */
  private paintSnapshot: PaintSnapshot | null = null;
  private paintFormatListeners = new Set<() => void>();
  /** The currently active text-box editor, or null when not editing. */
  private activeTextEditor: SlidesTextBoxEditor | null = null;
  /**
   * Last context-menu click position in viewport (clientX/clientY)
   * coords. Captured in onContextMenu so that menu-item `run`
   * callbacks fired later can anchor popovers (e.g. the layout
   * picker) at the original click site rather than at logical
   * (slide) coordinates.
   */
  private lastContextX = 0;
  private lastContextY = 0;
  /**
   * Bound mount factory. Tests can swap this out via
   * `SlidesEditorOptions.mountTextBox` to avoid driving the real docs
   * TextEditor inside jsdom (where the Canvas 2D context is a stub).
   */
  private readonly mountTextBox: typeof mountSlidesTextBox;
  // Explicit declaration + body assignment so this file stays parseable
  // by Node's `--experimental-strip-types` (used by the frontend test
  // runner via `frontend/tests/resolve-hooks.mjs`).
  private options: SlidesEditorOptions;
  /**
   * 2D context kept for click-time `isPointInPath` lookups. Reuses the
   * renderer's canvas context so we don't allocate a second one.
   */
  private hitCtx: HitTestCtx;
  /** Per-shell click tolerance (slide-logical pixels). */
  private hitTolerance = DEFAULT_HIT_TOLERANCE;
  /**
   * Optional H/V ruler. Instantiated only when the host passes all
   * three ruler DOM refs (`hRulerCanvas`, `vRulerCanvas`,
   * `rulerCorner`). Painted at the end of every `render()` so it
   * stays in lock-step with the slide canvas size/zoom.
   */
  private ruler: SlidesRuler | null = null;
  /**
   * Live preview of a guide being created from the ruler or an
   * existing guide being repositioned. Non-null only while a drag is
   * in flight; cleared on commit / cancel. Repaints flow through
   * `repaintOverlay` which forwards this to the overlay renderer.
   */
  private pendingGuide:
    | { id?: string; axis: 'x' | 'y'; position: number }
    | null = null;

  /**
   * In-canvas peer presence, pushed in by the host via `setPeers`. The
   * editor never reads Yorkie types — the host maps `SlidesPresence`
   * into `PeerView[]`. Painted by `repaintOverlay` (peers on the current
   * slide only). Empty when solo or no host has wired presence.
   */
  private peers: readonly PeerView[] = [];

  constructor(options: SlidesEditorOptions) {
    this.options = options;
    const ctx = options.canvas.getContext('2d');
    if (!ctx) throw new Error('SlidesEditor: canvas has no 2D context');
    this.hitCtx = ctx;
    this.renderer = new SlideRenderer(ctx, options);
    if (
      options.hRulerCanvas !== undefined &&
      options.vRulerCanvas !== undefined &&
      options.rulerCorner !== undefined
    ) {
      this.ruler = new SlidesRuler({
        hCanvas: options.hRulerCanvas,
        vCanvas: options.vRulerCanvas,
        corner: options.rulerCorner,
      });
    }
    this.currentId = options.store.read().slides[0]?.id;
    this.mountTextBox = options.mountTextBox ?? mountSlidesTextBox;
    this.selection.subscribe(() => {
      // Cell-range selection is anchored to a specific table id. If
      // the element-level selection no longer includes that table (the
      // user clicked elsewhere, cleared, or drilled out), drop the
      // stale range before re-rendering the overlay so the blue tint
      // disappears in the same frame as the outer selection box.
      if (
        this.cellSelection !== null &&
        !this.selection.has(this.cellSelection.tableId)
      ) {
        this.setCellSelection(null);
      }
      this.renderer.markDirty();
      this.repaintOverlay();
    });
    this.keyRules = buildKeyRules({
      store: this.options.store,
      selection: this.selection,
      currentSlideId: () => this.getCurrentSlideId(),
      setCurrentSlide: (id: string) => this.setCurrentSlide(id),
      enterEditMode: (
        slideId: string,
        elementId: string,
        options?: { initialText?: string },
      ) => this.enterEditMode(slideId, elementId, options),
      requestRender: () => this.requestRender(),
      onStartPresentation: this.options.onStartPresentation,
      onShowShortcutsHelp: this.options.onShowShortcutsHelp,
      getInsertMode: () => this.getInsertMode(),
      setInsertMode: (kind) => this.setInsertMode(kind),
      group: () => this.group(),
      ungroup: () => this.ungroup(),
      isPaintingFormat: () => this.isPaintingFormat(),
      cancelFormatPaint: () => this.cancelFormatPaint(),
      getCellSelection: () => this.cellSelection,
      clearCellSelection: () => {
        if (this.cellSelection === null) return;
        this.setCellSelection(null);
        this.repaintOverlay();
      },
    });
    // Read-only mounts (viewer-role share links) skip every pointer +
    // keyboard binding. The renderer still paints, including remote
    // peer edits, but the user cannot mutate. The editor's
    // programmatic surface (`setCurrentSlide`, `markDirty`, etc.) keeps
    // working so the host shell can drive navigation.
    if (!options.readOnly) {
      this.attachInteractions();
    }
    // Repaint with fresh width metrics when web fonts (Noto Sans KR
    // unicode-range subsets etc.) finish loading. The slides text
    // renderer's `CanvasTextMeasurer` is module-scoped, and
    // `cachedMeasureText` memoises `(font, text) → width` without a
    // load-state key. Without this listener, the layout computed during
    // the initial paint — when CJK subsets are still unloaded — pins
    // each run's `x` against the fallback font's wider advance widths;
    // `fillText` later draws with the loaded Noto Sans KR glyphs (≈ 25 px
    // narrower at 138.67 px for "캐즘 "), leaving a visible gap before
    // the next run. Re-entering edit mode masks the bug because
    // `initializeTextBox` allocates a fresh measurer per mount.
    //
    // We attach to read-only mounts too — share-link viewers see the
    // same gap. SSR / Node test envs lack `document.fonts`; bail.
    if (typeof document !== 'undefined' && document.fonts) {
      this.on(document.fonts, 'loadingdone', () => {
        clearMeasureCache();
        this.renderer.markDirty();
        this.render();
        options.onFontsLoaded?.();
      });
    }
  }

  private requestRender(): void {
    this.renderer.markDirty();
    this.render();
    this.repaintOverlay();
  }

  private repaintOverlay(): void {
    if (this.disposed) return;
    const doc = this.options.store.read();
    const slide = this.currentId
      ? doc.slides.find((s) => s.id === this.currentId)
      : undefined;
    if (!slide) {
      renderOverlay(this.options.overlay, [], {
        scale: this.scale(),
        slideWidth: SLIDE_WIDTH,
        slideHeight: SLIDE_HEIGHT,
        permanentGuides: doc.guides,
      pendingGuide: this.pendingGuide,
      });
      this.reattachEditingTextBox();
      return;
    }
    // Crop session owns the overlay: paint only the crop window + black
    // handles (no selection / guide chrome). The window is the live
    // committed-equivalent frame so its handles render rotated for a
    // rotated image.
    if (this.cropSession) {
      const s = this.cropSession;
      const f = windowToFrame(s.window, s.center, s.cos, s.sin);
      renderOverlay(this.options.overlay, [], {
        scale: this.scale(),
        slideWidth: SLIDE_WIDTH,
        slideHeight: SLIDE_HEIGHT,
        cropWindow: { ...f, rotation: s.rotation },
      });
      return;
    }
    // Suppress selection handles for the element currently in edit
    // mode — the text-box editor takes over the visual frame, and
    // overlapping handles would intercept clicks meant for the editor.
    //
    // Phase C (Task 9): scope-aware lookup. When the user has drilled
    // into a group, selected element ids refer to children nested inside
    // that group — `slide.elements.filter()` would miss them because it
    // only scans the top-level array. We resolve each id via the
    // recursive `findElement` helper, then lift the stored (group-local)
    // frame to world coords via `toWorldFrame` so that handles paint at
    // the positions the user actually sees.
    const scope = this.selection.getScope();
    const allSelectedIds = this.selection.get();
    const selected = allSelectedIds
      .filter((id) => id !== this.editingElementId)
      .map((id) => {
        const el = findElement(slide.elements, id);
        if (!el) return null;
        // For groups, the stored frame becomes stale once a child is
        // moved inside drill-in. `worldTightFrame` recomputes a tight
        // wrap around the children's current visual extent while
        // preserving the group's rotation so handles still rotate
        // with the group. For leaves, the stored frame is authoritative.
        const localFrame =
          el.type === 'group' ? worldTightFrame(el).worldFrame : el.frame;
        const worldFrame = toWorldFrame(localFrame, scope, slide);
        return { ...el, frame: worldFrame } as Element;
      })
      .filter((e): e is Element => e !== null);
    // groupOverlayFrames keys off the raw selection ids, kept separate
    // from `selected` above — which is frame-resolved and drops the
    // text-edit element for handle rendering.
    const { memberOutlines, contextBox } = groupOverlayFrames(
      slide,
      allSelectedIds,
      scope,
    );
    // Hover highlight: resolve the hovered element's world frame for the
    // overlay. Only paint when the hovered element is not already selected
    // (selected elements show handles, not a hover outline). The
    // `hoverHighlightId` is already scoped to the current drill-in level
    // via `pickScopeId`, so no extra scope filter is needed.
    const hoverId = this.hoverHighlightId;
    const hoverHighlightFrame: { id: string; frame: Frame } | null = (() => {
      if (!hoverId) return null;
      if (allSelectedIds.includes(hoverId)) return null;
      const el = findElement(slide.elements, hoverId);
      if (!el) return null;
      const worldFrame = toWorldFrame(el.frame, scope, slide);
      return { id: hoverId, frame: worldFrame };
    })();
    // Cell-range selection rects (when the user has clicked into a
    // table cell after the table is already element-selected). Skipped
    // while text-edit is active so the in-place editor's outline owns
    // the visual focus.
    const cellRangeRects: Frame[] = [];
    if (this.cellSelection !== null && this.editingElementId === null) {
      const sel = this.cellSelection;
      const tableEl = findElement(slide.elements, sel.tableId);
      if (tableEl?.type === 'table') {
        const layout = computeTableLayout(tableEl.data, {
          fontScale: deckFontScale(doc.meta),
        });
        const nCols = tableEl.data.columnWidths.length;
        const nRows = tableEl.data.rows.length;
        const rmin = Math.min(sel.r0, sel.r1);
        const rmax = Math.max(sel.r0, sel.r1);
        const cmin = Math.min(sel.c0, sel.c1);
        const cmax = Math.max(sel.c0, sel.c1);
        for (let r = rmin; r <= rmax; r++) {
          for (let c = cmin; c <= cmax; c++) {
            const cell = tableEl.data.rows[r]?.cells[c];
            if (!cell) continue;
            // Skip covered cells — they have no rect of their own; the
            // anchor's rect (with its full merged span) is painted from
            // its own (r, c).
            if (cell.gridSpan === 0 || cell.rowSpan === 0) continue;
            const gs = Math.min(
              Math.max(cell.gridSpan ?? 1, 1),
              nCols - c,
            );
            const rs = Math.min(
              Math.max(cell.rowSpan ?? 1, 1),
              nRows - r,
            );
            const x0 = layout.colX[c];
            const x1 = layout.colX[c + gs];
            const y0 = layout.rowY[r];
            const y1 = layout.rowY[r + rs];
            cellRangeRects.push({
              x: tableEl.frame.x + x0,
              y: tableEl.frame.y + y0,
              w: x1 - x0,
              h: y1 - y0,
              rotation: tableEl.frame.rotation,
            });
          }
        }
      } else {
        // The table was removed (or replaced); drop the stale selection.
        this.setCellSelection(null);
      }
    }
    // Live table column / row resize preview. Resolve the table id
    // → current frame so the magenta line lands on the table being
    // resized, then map the proposed boundary position into a 1-px
    // world-coord line segment.
    let tableResizePreview:
      | { kind: 'col' | 'row'; x0: number; y0: number; x1: number; y1: number }
      | undefined;
    if (this.pendingTableResize !== null) {
      const p = this.pendingTableResize;
      const t = findElement(slide.elements, p.tableId);
      if (t?.type === 'table') {
        const totalW = t.data.columnWidths.reduce((a, b) => a + b, 0);
        const totalH = t.data.rows.reduce((a, r) => a + r.height, 0);
        if (p.kind === 'col') {
          tableResizePreview = {
            kind: 'col',
            x0: t.frame.x + p.position,
            y0: t.frame.y,
            x1: t.frame.x + p.position,
            y1: t.frame.y + totalH,
          };
        } else {
          tableResizePreview = {
            kind: 'row',
            x0: t.frame.x,
            y0: t.frame.y + p.position,
            x1: t.frame.x + totalW,
            y1: t.frame.y + p.position,
          };
        }
      }
    }
    renderOverlay(this.options.overlay, selected, {
      scale: this.scale(),
      slideWidth: SLIDE_WIDTH,
      slideHeight: SLIDE_HEIGHT,
      peerOverlays: this.currentPeerOverlays(slide),
      // Pass the full slide so connector endpoint handles can resolve
      // `attached` endpoints to world positions via the host element's
      // frame. Free endpoints don't need this map but it's cheap to
      // pass always.
      allElements: slide.elements,
      connectorAffordance: this.connectorAffordance(),
      permanentGuides: doc.guides,
      pendingGuide: this.pendingGuide,
      memberOutlines,
      contextBox,
      hoverHighlightFrame,
      cellRangeRects: cellRangeRects.length > 0 ? cellRangeRects : undefined,
      tableResizePreview,
      // Animation order badges: shows the 1-based playback position(s) on
      // each selected element that has at least one animation. Computed
      // fresh from `slide.animations` on every overlay repaint so the
      // badge stays in sync when animations are added/removed/reordered.
      animationOrder: computeAnimationOrder(slide.animations),
      // Autofit mode toggle (GS-style bottom-left affordance on a single
      // selected text element). Patch only `data.autofit`, then request a
      // render so the canvas + overlay reflect the new mode immediately
      // (the store batch by itself does not force a repaint on this path).
      onAutofitToggle: (elementId, nextMode) => {
        this.options.store.batch(() => {
          this.options.store.updateElementData(slide.id, elementId, {
            autofit: nextMode,
          });
        });
        this.requestRender();
      },
    });
    // renderOverlay clears `overlay.innerHTML` on every call, which
    // would also unmount the text-box container. Re-append it after
    // the overlay rebuild so the editor stays visible.
    this.reattachEditingTextBox();
  }

  /**
   * Build the `connectorAffordance` for `renderOverlay`. Returns
   * undefined when the dots should not paint — either the connector
   * tool is disarmed AND no endpoint drag is in flight, or we have no
   * cursor position yet (cursor hasn't entered the canvas).
   */
  private connectorAffordance():
    | { cursor: { x: number; y: number }; zoom: number }
    | undefined {
    if (this.connectorCursor === null) return undefined;
    return { cursor: this.connectorCursor, zoom: this.scale() };
  }

  /**
   * When the drill-in scope pops (Esc, click outside the scoped group,
   * empty-canvas click while drilled in, right-click outside scope),
   * refit the popped group(s) so their `frame` matches the children's
   * current visual extent. Matches Google Slides: dropping out of
   * drill-in produces a tight selection box. The refit preserves the
   * group's rotation and scale — see `worldTightFrame` in
   * `model/group.ts` for the math.
   *
   * Each popped group is refit in its own batch so undo restores the
   * pre-pop state in a single step per group. Most pops drop one scope
   * level — the loop is here for the rare "click way outside" path
   * which can pop multiple levels at once.
   */
  private refitPoppedScope(
    beforeScope: readonly string[],
    afterScope: readonly string[],
    slideId: string,
  ): void {
    if (beforeScope.length <= afterScope.length) return;
    // Walk innermost → outermost so a refit at depth N+1 settles before
    // its parent at depth N is asked to refit (otherwise the parent
    // would read stale child geometry).
    for (let i = beforeScope.length - 1; i >= afterScope.length; i--) {
      const groupId = beforeScope[i];
      this.options.store.batch(() => {
        this.options.store.refitGroup(slideId, groupId);
      });
    }
    // The refit mutated the store but no listener re-renders. Mark the
    // canvas dirty and request a paint so the next frame uses the
    // refit'd group state (frame + children's normalized local frames).
    this.renderer.markDirty();
    this.repaintOverlay();
  }

  private reattachEditingTextBox(): void {
    const tb = this.editingTextBox;
    if (tb === null) return;
    if (tb.container.parentNode === this.options.overlay) return;
    this.options.overlay.appendChild(tb.container);
  }

  private scale(): number {
    return this.options.hostWidth / SLIDE_WIDTH;
  }

  render(): void {
    if (this.disposed) return;
    // Single read so `slide` and `doc` come from the same snapshot —
    // the renderer needs the deck's themes/master arrays to resolve
    // role-bound colors, and the in-memory slide reference must
    // belong to that same SlidesDocument so a future colorResolver
    // can look up theme palettes via `getActiveTheme(doc)`.
    const doc = this.options.store.read();
    const id = this.currentId;
    const slide = id ? doc.slides.find((s) => s.id === id) : undefined;
    if (!slide) {
      this.paintRuler();
      return;
    }
    // Hide the element-currently-in-edit's text from the slide canvas
    // so the text-box editor's own canvas doesn't double-paint it (one
    // copy from `drawText`, one from the editor's `paintLayout`).
    //
    // For TextElement the whole element is text, so we filter it out.
    // For ShapeElement the fill/stroke are still part of the slide and
    // must keep painting underneath the editor — only the `data.text`
    // body gets stripped. The walker is recursive so the mask hits
    // elements nested inside groups too; cloning is structural-only
    // (no deep block copy) so this stays cheap on every frame.
    if (this.editingElementId !== null) {
      const editingId = this.editingElementId;
      const visible = {
        ...slide,
        elements: maskEditingElement(
          slide.elements,
          editingId,
          this.editingCellCoords,
          this.editingGrowApplicable ? this.lastEditingContentHeight : null,
        ),
      };
      this.renderer.forceRender(visible, doc);
      this.paintRuler();
      return;
    }
    // Crop session: the renderer masks the cropping element and paints
    // the dimmed full bitmap + bright crop window from the live session.
    const preview = this.cropPreview();
    if (preview) {
      this.renderer.forceRender(slide, doc, undefined, undefined, preview);
      this.paintRuler();
      return;
    }
    this.renderer.render(slide, doc);
    this.paintRuler();
  }

  private paintRuler(): void {
    if (this.ruler === null) return;
    this.ruler.render({
      hostWidth: this.options.hostWidth,
      hostHeight: this.options.hostHeight,
      scrollX: this.rulerScrollX,
      scrollY: this.rulerScrollY,
    });
  }

  getSelection(): readonly string[] {
    return this.selection.get();
  }

  setSelection(ids: readonly string[]): void {
    this.selection.set(ids);
  }

  getCurrentSlideId(): string | undefined {
    return this.currentId;
  }

  setCurrentSlide(id: string): void {
    if (this.currentId === id) return;
    // Commit any in-flight crop before leaving its slide.
    if (this.cropSession !== null) this.exitImageCrop(true);
    // Selection is per-slide; clear before switching so the overlay
    // doesn't render handles for elements that don't belong to the
    // newly-current slide.
    this.selection.clear();
    this.currentId = id;
    this.renderer.markDirty();
    this.render();
    this.repaintOverlay();
    for (const cb of this.currentSlideListeners) cb();
  }

  onSelectionChange(cb: () => void): () => void {
    return this.selection.subscribe(cb);
  }

  setPeers(peers: readonly PeerView[]): void {
    if (this.disposed) return;
    this.peers = peers;
    // Peers live only in the DOM overlay; no canvas markDirty needed.
    //
    // Known limitation: a peer-presence tick that lands mid-gesture
    // repaints the steady-state overlay over the in-flight ghost preview
    // (the gesture's own `paintGhostPreview` re-establishes it on the
    // next pointermove, so it reads as a brief flicker). The proper fix
    // is a gesture-lifecycle signal that defers this repaint while a
    // gesture is live; it lands with the P2 live-frame broadcast work
    // (see docs/tasks/active/20260621-slides-live-presence-todo.md).
    this.repaintOverlay();
  }

  getCellSelection(): {
    tableId: string;
    r0: number;
    c0: number;
    r1: number;
    c1: number;
  } | null {
    return this.cellSelection;
  }

  onCellSelectionChange(cb: () => void): () => void {
    this.cellSelectionListeners.add(cb);
    return () => {
      this.cellSelectionListeners.delete(cb);
    };
  }

  /**
   * Mutator helper for `cellSelection`: applies the new value (or
   * `null` to clear) and notifies subscribers if it changed. Callers
   * still trigger overlay repaints separately — this helper only
   * handles the state + change-notify pair.
   *
   * Identity comparison is sufficient because every "real" set
   * creates a new object literal; the existing mutation sites that
   * set the same range (e.g. drag still inside the same cell) early-
   * return before reaching this setter via per-call dedup.
   */
  private setCellSelection(
    next: {
      tableId: string;
      r0: number;
      c0: number;
      r1: number;
      c1: number;
    } | null,
  ): void {
    if (this.cellSelection === next) return;
    this.cellSelection = next;
    for (const cb of this.cellSelectionListeners) cb();
  }

  onCurrentSlideChange(cb: () => void): () => void {
    this.currentSlideListeners.add(cb);
    return () => {
      this.currentSlideListeners.delete(cb);
    };
  }

  setHostSize(hostWidth: number, hostHeight: number): void {
    if (
      this.options.hostWidth === hostWidth &&
      this.options.hostHeight === hostHeight
    ) {
      return;
    }
    this.options.hostWidth = hostWidth;
    this.options.hostHeight = hostHeight;
    this.renderer.markDirty();
    this.render();
    this.repaintOverlay();
  }

  setSlideOffset(logicalX: number, logicalY: number): void {
    if (
      (this.options.slideOffsetLogicalX ?? 0) === logicalX &&
      (this.options.slideOffsetLogicalY ?? 0) === logicalY
    ) {
      return;
    }
    this.options.slideOffsetLogicalX = logicalX;
    this.options.slideOffsetLogicalY = logicalY;
    this.renderer.markDirty();
    this.render();
    this.repaintOverlay();
  }

  setRulerScroll(scrollX: number, scrollY: number): void {
    if (
      this.rulerScrollX === scrollX &&
      this.rulerScrollY === scrollY
    ) {
      return;
    }
    this.rulerScrollX = scrollX;
    this.rulerScrollY = scrollY;
    // Only the ruler needs to repaint — the slide canvas and overlay
    // are sized by the host shell, not by the editor's own scroll
    // state, so calling `render()` would do redundant work.
    this.paintRuler();
  }

  insertTable(
    rows: number,
    cols: number,
    opts?: { width?: number; height?: number },
  ): string | null {
    if (rows < 1 || cols < 1) {
      throw new Error(
        `insertTable: rows / cols must be >= 1 (got ${rows}, ${cols})`,
      );
    }
    const slideId = this.currentId;
    if (slideId === undefined) return null;
    // Default footprint: ~25% of the slide width × 25% of the slide
    // height, big enough to read at 100% zoom. Picker UI can pass
    // custom dimensions; the cell heights are derived to keep the
    // CR#13 invariant (`frame.h == sum(row.height)`).
    const width = opts?.width ?? SLIDE_WIDTH * 0.5;
    const height = opts?.height ?? SLIDE_HEIGHT * 0.25;
    const colWidth = width / cols;
    const rowHeight = height / rows;
    const x = (SLIDE_WIDTH - width) / 2;
    const y = (SLIDE_HEIGHT - height) / 2;
    // Seed every cell with a light-gray border on all four sides so
    // the freshly-inserted table is visible right away. The
    // renderer's border-collapse rule de-duplicates shared edges, so
    // the user sees the same single-stroke grid the renderer would
    // paint after a manual "Cell border: all" run.
    const newCellStyle = () => ({
      border: {
        top: { ...DEFAULT_CELL_BORDER },
        right: { ...DEFAULT_CELL_BORDER },
        bottom: { ...DEFAULT_CELL_BORDER },
        left: { ...DEFAULT_CELL_BORDER },
      },
    });
    const rowsData = Array(rows)
      .fill(0)
      .map(() => ({
        height: rowHeight,
        cells: Array(cols)
          .fill(0)
          .map(() => ({ body: { blocks: [] }, style: newCellStyle() })),
      }));
    let id = '';
    this.options.store.batch(() => {
      id = this.options.store.addElement(slideId, {
        type: 'table',
        frame: { x, y, w: width, h: height, rotation: 0 },
        data: {
          columnWidths: Array(cols).fill(colWidth),
          rows: rowsData,
        },
      });
    });
    this.selection.set([id]);
    this.requestRender();
    return id;
  }

  align(direction: AlignDirection): void {
    if (this.editingElementId !== null) return;
    const slide = this.currentSlide();
    if (!slide) return;
    const framesMap = this.collectSelectedFrames(slide);
    if (framesMap.size === 0) return;
    // Multi-select: align to the combined bbox of the selection.
    // Single-select: align to the slide canvas (1920×1080).
    let reference: AlignReference;
    if (framesMap.size >= 2) {
      reference = combinedBoundingBox(Array.from(framesMap.values()))!;
    } else {
      reference = { x: 0, y: 0, w: SLIDE_WIDTH, h: SLIDE_HEIGHT };
    }
    const updates = alignFrames(framesMap, direction, reference);
    this.applyFrameUpdates(slide.id, updates);
  }

  distribute(axis: DistributeAxis): void {
    if (this.editingElementId !== null) return;
    const slide = this.currentSlide();
    if (!slide) return;
    const framesMap = this.collectSelectedFrames(slide);
    if (framesMap.size < 3) return;
    const updates = distributeFrames(framesMap, axis);
    this.applyFrameUpdates(slide.id, updates);
  }

  bringForward(): void {
    if (this.editingElementId !== null) return;
    const slide = this.currentSlide();
    if (!slide) return;
    const selectedIds = new Set(this.selection.get());
    if (selectedIds.size === 0) return;
    const slideId = slide.id;
    // Collect selected indices, operate from highest to lowest (descending sort)
    // so that moving element at index i to i+1 only shifts the element that was
    // at i+1 — elements at lower indices are untouched, keeping stored indices valid.
    const entries = slide.elements
      .map((el, i) => ({ id: el.id, i }))
      .filter((e) => selectedIds.has(e.id))
      .sort((a, b) => b.i - a.i);
    const length = slide.elements.length;
    this.options.store.batch(() => {
      for (const { id, i } of entries) {
        const target = Math.min(i + 1, length - 1);
        if (target !== i) this.options.store.reorderElement(slideId, id, target);
      }
    });
    this.renderer.markDirty();
    this.render();
  }

  sendBackward(): void {
    if (this.editingElementId !== null) return;
    const slide = this.currentSlide();
    if (!slide) return;
    const selectedIds = new Set(this.selection.get());
    if (selectedIds.size === 0) return;
    const slideId = slide.id;
    // Ascending sort: moving element at index i to i-1 only shifts the element
    // that was at i-1 — elements at higher indices are untouched, so the stored
    // indices of elements processed later remain correct without a live re-read.
    const entries = slide.elements
      .map((el, i) => ({ id: el.id, i }))
      .filter((e) => selectedIds.has(e.id))
      .sort((a, b) => a.i - b.i);
    this.options.store.batch(() => {
      for (const { id, i } of entries) {
        const target = Math.max(i - 1, 0);
        if (target !== i) this.options.store.reorderElement(slideId, id, target);
      }
    });
    this.renderer.markDirty();
    this.render();
  }

  bringToFront(): void {
    if (this.editingElementId !== null) return;
    const slide = this.currentSlide();
    if (!slide) return;
    const selectedIds = new Set(this.selection.get());
    if (selectedIds.size === 0) return;
    const slideId = slide.id;
    // Collect in their current order (relative order preserved at the end).
    const orderedIds = slide.elements
      .filter((el) => selectedIds.has(el.id))
      .map((el) => el.id);
    this.options.store.batch(() => {
      // Re-read the live slide on each iteration because reorderElement
      // mutates the array in place (splice/insert), shifting indices.
      // Moving in ascending original order and always appending at the
      // current end yields the correct relative order.
      for (const id of orderedIds) {
        const live = this.options.store.read().slides.find((s) => s.id === slideId);
        if (!live) continue;
        this.options.store.reorderElement(slideId, id, live.elements.length - 1);
      }
    });
    this.renderer.markDirty();
    this.render();
  }

  sendToBack(): void {
    if (this.editingElementId !== null) return;
    const slide = this.currentSlide();
    if (!slide) return;
    const selectedIds = new Set(this.selection.get());
    if (selectedIds.size === 0) return;
    const slideId = slide.id;
    // Collect in their current order (relative order preserved at the start).
    const orderedIds = slide.elements
      .filter((el) => selectedIds.has(el.id))
      .map((el) => el.id);
    this.options.store.batch(() => {
      // Re-read the live slide on each iteration.
      // Moving in ascending original order and always prepending at index 0
      // reverses the relative order, so process in reverse to preserve it.
      for (const id of [...orderedIds].reverse()) {
        const live = this.options.store.read().slides.find((s) => s.id === slideId);
        if (!live) continue;
        this.options.store.reorderElement(slideId, id, 0);
      }
    });
    this.renderer.markDirty();
    this.render();
  }

  rotateBy(radians: number): void {
    if (this.editingElementId !== null) return;
    const slide = this.currentSlide();
    if (!slide) return;
    const framesMap = this.collectSelectedFrames(slide);
    if (framesMap.size === 0) return;
    const TWO_PI = 2 * Math.PI;
    const updates = new Map<string, Frame>();
    for (const [id, worldFrame] of framesMap) {
      const newRotation = ((worldFrame.rotation + radians) % TWO_PI + TWO_PI) % TWO_PI;
      updates.set(id, { ...worldFrame, rotation: newRotation });
    }
    this.applyFrameUpdates(slide.id, updates);
  }

  group(): void {
    if (this.editingElementId !== null) return;
    const slide = this.currentSlide();
    if (!slide) return;
    const ids = this.selection.get();
    if (ids.length < 2) return;
    let result: { groupId: string; excludedConnectorIds: string[] } | undefined;
    this.options.store.batch(() => {
      result = this.options.store.group(slide.id, [...ids]);
    });
    if (!result) return;
    if (result.excludedConnectorIds.length > 0) {
      const n = result.excludedConnectorIds.length;
      const noun = n === 1 ? 'connector' : 'connectors';
      this.options.onToast?.(
        `${n} ${noun} excluded from the group (linked outside).`,
      );
    }
    this.selection.set([result.groupId]);
    this.requestRender();
  }

  ungroup(): void {
    if (this.editingElementId !== null) return;
    const slide = this.currentSlide();
    if (!slide) return;
    const ids = this.selection.get();
    if (ids.length !== 1) return;
    const path = findElementPath(slide.elements, ids[0]);
    const el = path?.[path.length - 1];
    if (!el || el.type !== 'group') return;
    let childIds: string[] = [];
    this.options.store.batch(() => {
      childIds = this.options.store.ungroup(slide.id, ids[0]);
    });
    this.selection.set(childIds);
    this.requestRender();
  }

  deleteSelected(): void {
    if (this.editingElementId !== null) return;
    const slide = this.currentSlide();
    if (!slide) return;
    const ids = this.selection.get();
    if (ids.length === 0) return;
    this.options.store.batch(() => {
      this.options.store.removeElements(slide.id, [...ids]);
    });
    this.selection.clear();
    this.requestRender();
  }

  // ─── Format painter ──────────────────────────────────────────────────────
  //
  // The painter is a small state machine layered on top of the existing
  // pointer/selection flow. `beginFormatPaint` captures a snapshot from
  // the *current* selection (single shape / connector / text element
  // only — multi-select and empty selection both no-op so the toolbar
  // button can stay clickable without spurious side effects). The next
  // pointer-down on a compatible element pastes via the same store
  // helpers used by the contextual toolbar controls, then exits paint
  // mode. Esc also exits via the keyboard ruleset. v1 ships
  // homogeneous-type paint only; cross-type drops are silent no-ops.

  beginFormatPaint(): void {
    const snapshot = this.captureFormatPaintSnapshot();
    if (snapshot === null) {
      // Nothing eligible under the current selection — exit any existing
      // paint mode and emit a single change event so a stuck toolbar
      // toggle resets cleanly.
      if (this.paintSnapshot !== null) {
        this.paintSnapshot = null;
        this.notifyPaintFormatChange();
      }
      return;
    }
    this.paintSnapshot = snapshot;
    this.notifyPaintFormatChange();
  }

  cancelFormatPaint(): void {
    if (this.paintSnapshot === null) return;
    this.paintSnapshot = null;
    this.notifyPaintFormatChange();
  }

  isPaintingFormat(): boolean {
    return this.paintSnapshot !== null;
  }

  onPaintFormatChange(cb: () => void): () => void {
    this.paintFormatListeners.add(cb);
    return () => {
      this.paintFormatListeners.delete(cb);
    };
  }

  private notifyPaintFormatChange(): void {
    for (const cb of this.paintFormatListeners) cb();
  }

  getHoverHighlightId(): string | null {
    return this.hoverHighlightId;
  }

  /**
   * Get the last computed hover cursor. Exposed for tests.
   */
  getLastHoverCursor(): string {
    return this.lastHoverCursor;
  }

  /**
   * Read `fill` + `stroke` off the single selected element. Returns
   * null when zero or multiple elements are selected, or when the
   * selected element is not a shape / connector / text box.
   */
  private captureFormatPaintSnapshot(): PaintSnapshot | null {
    const slide = this.currentSlide();
    if (!slide) return null;
    const ids = this.selection.get();
    if (ids.length !== 1) return null;
    const el = findElement(slide.elements, ids[0]);
    if (!el) return null;
    if (el.type === 'shape') {
      const s = el as ShapeElement;
      return {
        sourceId: el.id,
        sourceType: 'shape',
        fill: s.data.fill,
        stroke: s.data.stroke,
      };
    }
    if (el.type === 'text') {
      const t = el as TextElement;
      return {
        sourceId: el.id,
        sourceType: 'text',
        fill: t.data.fill,
        stroke: t.data.stroke,
      };
    }
    if (el.type === 'connector') {
      const c = el as ConnectorElement;
      return {
        sourceId: el.id,
        sourceType: 'connector',
        stroke: c.stroke,
      };
    }
    return null;
  }

  /**
   * Apply the active paint snapshot to the element under (clientX,
   * clientY) and exit paint mode. Cross-type drops are silent no-ops
   * (we still exit so the user's next click acts normally).
   */
  private applyFormatPaintAt(clientX: number, clientY: number): void {
    const snapshot = this.paintSnapshot;
    if (!snapshot) return;
    const slide = this.currentSlide();
    if (!slide) {
      this.cancelFormatPaint();
      return;
    }
    const { x, y } = this.clientToLogical(clientX, clientY);
    const hit = this.hitTestAt(slide, x, y);
    if (hit === null) {
      // Empty canvas: just exit paint mode.
      this.cancelFormatPaint();
      return;
    }
    const target = findElement(slide.elements, hit.elementId);
    if (!target) {
      this.cancelFormatPaint();
      return;
    }
    // Self-paint is a no-op: clicking the same element you captured
    // from would produce an empty undo entry. Bail before reaching the
    // store so the user can re-click without polluting history.
    if (target.id === snapshot.sourceId) {
      this.cancelFormatPaint();
      return;
    }
    const store = this.options.store;
    // Homogeneous paste only. Shape ↔ text mix shares the fill+stroke
    // shape so we group them; connector paste is stroke-only and only
    // lands on another connector. Anything else exits silently.
    if (
      snapshot.sourceType !== 'connector' &&
      (target.type === 'shape' || target.type === 'text')
    ) {
      // Only write keys the source *had*. Spreading
      // `{ fill: undefined, stroke: undefined }` would `delete` those
      // keys on the target (see yorkie-slides-store.updateElementData),
      // clobbering the target's own fill/stroke whenever the source
      // happened to have no fill / no stroke set.
      const patch: { fill?: ThemeColor; stroke?: Stroke } = {};
      if (snapshot.fill !== undefined) patch.fill = snapshot.fill;
      if (snapshot.stroke !== undefined) patch.stroke = snapshot.stroke;
      if (Object.keys(patch).length === 0) {
        this.cancelFormatPaint();
        return;
      }
      store.batch(() => {
        store.updateElementData(slide.id, target.id, patch);
      });
    } else if (
      snapshot.sourceType === 'connector' &&
      target.type === 'connector' &&
      snapshot.stroke !== undefined
    ) {
      store.batch(() => {
        store.updateConnectorStroke(slide.id, target.id, snapshot.stroke);
      });
    }
    // Always exit paint mode after the click — single-shot semantics.
    this.cancelFormatPaint();
  }

  /**
   * Collect frames for currently-selected elements that still exist on
   * the given slide. Defends against ids that were removed remotely
   * between selection and the toolbar action.
   */
  private collectSelectedFrames(slide: Slide): Map<string, Frame> {
    // Walk the element tree so this works at any drill-in depth — at
    // slide-root scope the elements are top-level; in drill-in, the
    // selected ids live inside the scoped group's children.
    //
    // Returned frames are in WORLD coordinates so consumers
    // (align / distribute / rotateBy + combinedBoundingBox) reason in a
    // single coordinate system. `applyFrameUpdates` converts each back
    // to scope-local before writing.
    const scope = this.selection.getScope();
    const selectedIds = this.selection.get();
    const result = new Map<string, Frame>();
    for (const id of selectedIds) {
      const el = findElement(slide.elements, id);
      if (!el) continue;
      result.set(id, toWorldFrame(el.frame, scope, slide));
    }
    return result;
  }

  /**
   * Commit a set of WORLD frame updates in a single store.batch so
   * undo/redo treats them atomically. Each world frame is converted
   * back to scope-local via `fromWorldFrame` so the store writes
   * coordinates in the element's parent coordinate system. Empty
   * `updates` is a no-op (skips the empty batch).
   *
   * Connectors take a different path: their `frame` is derived from
   * world-coord `start`/`end` endpoints, so `updateElementFrame`
   * would (correctly) throw. The caller's target world frame is
   * interpreted as a translation — we compute (dx, dy) against the
   * connector's current world frame and route through
   * `commitTranslate`, which writes endpoints directly. Size /
   * rotation in the target frame are ignored for connectors because
   * both are derived; rotateBy passes the same x/y so the delta is
   * zero and `commitTranslate` short-circuits.
   */
  private applyFrameUpdates(slideId: string, updates: ReadonlyMap<string, Frame>): void {
    if (updates.size === 0) return;
    const scope = this.selection.getScope();
    const slide = this.currentSlide();
    if (!slide) return;
    this.options.store.batch(() => {
      for (const [id, worldFrame] of updates) {
        const path = findElementPath(slide.elements, id);
        if (!path) continue;
        const el = path[path.length - 1];
        if (el.type === 'connector') {
          const currentWorldFrame = toWorldFrame(el.frame, scope, slide);
          commitTranslate(
            this.options.store, slideId, el,
            worldFrame.x - currentWorldFrame.x,
            worldFrame.y - currentWorldFrame.y,
          );
          continue;
        }
        const localFrame = fromWorldFrame(worldFrame, scope, slide);
        this.options.store.updateElementFrame(slideId, id, localFrame);
      }
    });
    this.renderer.markDirty();
    this.render();
    this.repaintOverlay();
  }

  setInsertMode(kind: InsertKind | null): void {
    if (this.insertKind === kind) return;
    this.insertKind = kind;
    // Entering insert mode clears any idle hover highlight so the next
    // pointermove that re-evaluates the highlight lands on a clean slate.
    if (kind !== null) this.clearHoverHighlight();
    // Crosshair cursor signals to the user that the next click will
    // place a shape (or text box). Mirrors GS / PPT. We set it on
    // both the canvas (where the click lands) and the overlay (which
    // sits on top and would otherwise reset the cursor back to the
    // default while hovering selection / resize handles for some
    // pixel rows). Setting `cursor = ''` reverts to the stylesheet
    // default so we don't override author styles unconditionally.
    const cursor = kind === null ? '' : 'crosshair';
    this.options.canvas.style.cursor = cursor;
    this.options.overlay.style.cursor = cursor;
    if (kind === null) this.lastHoverCursor = '';
    // Any insert-mode change clears the stale ghost: when the user
    // disarms (null), switches to text mode (no preview), or swaps
    // shape kind A → B, we drop the cached preview so the next
    // mousemove repopulates it with the new kind. Without this, a
    // pending rAF queued just before the switch would briefly paint
    // a kind-A ghost after the user already picked kind B.
    const hadGhost = this.hoverPreview !== null;
    this.hoverPreview = null;
    if (this.hoverRenderRaf !== null) {
      cancelAnimationFrame(this.hoverRenderRaf);
      this.hoverRenderRaf = null;
    }
    // Only force a clean repaint when leaving a ghost-eligible mode.
    // Shape-to-shape transitions repaint on the next mousemove anyway
    // and an extra paint here would flash the slide between kinds.
    // Connector modes also have no shape hover-ghost, so leaving a
    // ghost into a connector mode needs the same clean repaint as
    // leaving into text/null.
    if (
      hadGhost &&
      (kind === null || kind === 'text' || isConnectorInsertKind(kind))
    ) {
      this.renderer.markDirty();
      this.render();
    }
    // Disarming connector mode (or switching away from it without
    // entering a fresh connector mode) drops the cached affordance
    // cursor so the next overlay repaint clears the dots. Switching
    // between connector variants keeps the cursor: the user is still
    // hovering and we want continuous visual feedback.
    if (!isConnectorInsertKind(kind) && this.connectorCursor !== null) {
      this.connectorCursor = null;
      this.repaintOverlay();
    }
    for (const cb of this.insertModeListeners) cb();
  }

  getInsertMode(): InsertKind | null {
    return this.insertKind;
  }

  isConnectorMode(): boolean {
    return isConnectorInsertKind(this.insertKind);
  }

  onInsertModeChange(cb: () => void): () => void {
    this.insertModeListeners.add(cb);
    return () => {
      this.insertModeListeners.delete(cb);
    };
  }

  getEditingElementId(): string | null {
    return this.editingElementId;
  }

  isTextEditing(): boolean {
    return this.editingElementId !== null;
  }

  onTextEditingChange(cb: () => void): () => void {
    this.textEditingListeners.add(cb);
    return () => {
      this.textEditingListeners.delete(cb);
    };
  }

  getActiveTextEditor(): SlidesTextBoxEditor | null {
    return this.activeTextEditor;
  }

  enterTextEditing(elementId: string): void {
    const slide = this.currentSlide();
    if (!slide) return;
    this.enterEditMode(slide.id, elementId);
  }

  exitTextEditing(): void {
    this.exitEditMode('commit');
  }

  isCropping(): boolean {
    return this.cropSession !== null;
  }

  onCropChange(cb: () => void): () => void {
    this.cropListeners.add(cb);
    return () => {
      this.cropListeners.delete(cb);
    };
  }

  enterImageCrop(elementId: string): void {
    const slide = this.currentSlide();
    if (!slide) return;
    // Top-level only: `slide.elements` is the root array. Grouped images
    // have parent-local frames, so the world math below would be wrong —
    // mirrors the table-cell-edit guard.
    const el = slide.elements.find((e) => e.id === elementId);
    if (!el || el.type !== 'image') return;
    // Flipped frames aren't threaded through the preview / handle / pointer
    // projection yet, so a flip would crop against the wrong visual edge.
    // Reject until flip support lands (P1).
    if (el.frame.flipH || el.frame.flipV) return;
    // Mutually exclusive with text edit — commit any in-flight text.
    if (this.editingElementId !== null) this.exitEditMode('commit');
    if (this.cropSession !== null) this.exitImageCrop(true);

    // Work in the element's centred-local frame so a rotated image crops
    // in its own rotated space; the math is the same axis-aligned rect
    // math, only the render / handles / pointer apply the rotation.
    const frame = el.frame;
    const window = frameToLocalWindow(frame);
    const full = cropToFull(window, el.data.crop);
    const basis = frameRotationBasis(frame);
    this.cropSession = {
      slideId: slide.id,
      elementId,
      src: el.data.src,
      center: basis.center,
      rotation: frame.rotation,
      cos: basis.cos,
      sin: basis.sin,
      full,
      window,
    };

    // Modal key handling: Enter commits, Esc cancels, everything else is
    // swallowed so global shortcuts (Delete, arrows, …) can't mutate the
    // image mid-crop. Capture phase runs before the bubble-phase keyRules
    // listener, so stopPropagation suppresses them.
    const handler = (ev: KeyboardEvent): void => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        this.exitImageCrop(true);
        return;
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        this.exitImageCrop(false);
        return;
      }
      ev.stopPropagation();
    };
    this.cropKeyHandler = handler;
    document.addEventListener('keydown', handler, true);

    this.selection.set([elementId]);
    this.notifyCropChange();
    this.renderer.markDirty();
    this.render();
    this.repaintOverlay();
  }

  exitImageCrop(commit: boolean): void {
    const session = this.cropSession;
    if (!session) return;
    // Always tear the session down, even if the commit write throws (e.g.
    // the image was removed by a concurrent collaborative edit) — leaving
    // the capture key handler + session installed would wedge the editor.
    try {
      if (commit) {
        const crop = normalizeCrop(windowToCrop(session.full, session.window));
        this.commitCropFrame(
          session.slideId,
          session.elementId,
          session.window,
          session,
          crop,
        );
      }
    } finally {
      this.finishCropSession();
    }
  }

  resetImageCrop(elementId: string): void {
    const slide = this.currentSlide();
    if (!slide) return;
    const el = slide.elements.find((e) => e.id === elementId);
    if (!el || el.type !== 'image') return;
    // Discard any live crop session on this element first.
    if (this.cropSession?.elementId === elementId) this.exitImageCrop(false);
    if (!el.data.crop) return;
    // Restore proportions: the uncropped frame is the full bitmap, placed
    // (via the centred-local math) so the visible image does not shift.
    // Works uniformly for rotated images — rotation is preserved.
    const frame = el.frame;
    const full = cropToFull(frameToLocalWindow(frame), el.data.crop);
    this.commitCropFrame(
      slide.id,
      elementId,
      full,
      frameRotationBasis(frame),
      undefined,
    );
    this.renderer.markDirty();
    this.render();
    this.repaintOverlay();
  }

  /**
   * Convert a centred-local crop window back to a stored frame and write
   * the frame + crop in one undo step. Shared by crop-commit and reset.
   * The frame's `rotation` is left untouched (only `x/y/w/h` change), so
   * a rotated image stays rotated.
   */
  private commitCropFrame(
    slideId: string,
    elementId: string,
    window: Rect,
    basis: { center: { x: number; y: number }; cos: number; sin: number },
    crop: Crop | undefined,
  ): void {
    const frame = windowToFrame(window, basis.center, basis.cos, basis.sin);
    this.options.store.batch(() => {
      this.options.store.updateElementFrame(slideId, elementId, {
        x: frame.x,
        y: frame.y,
        w: frame.w,
        h: frame.h,
      });
      this.options.store.updateElementData(slideId, elementId, { crop });
    });
  }

  private finishCropSession(): void {
    this.cropDragCleanup?.();
    if (this.cropKeyHandler) {
      document.removeEventListener('keydown', this.cropKeyHandler, true);
      this.cropKeyHandler = null;
    }
    this.cropSession = null;
    this.notifyCropChange();
    this.renderer.markDirty();
    this.render();
    this.repaintOverlay();
  }

  private notifyCropChange(): void {
    for (const cb of this.cropListeners) cb();
  }

  /** Build the crop preview descriptor for the renderer, or null. */
  private cropPreview() {
    const s = this.cropSession;
    if (!s) return undefined;
    return {
      elementId: s.elementId,
      src: s.src,
      center: s.center,
      rotation: s.rotation,
      full: s.full,
      window: s.window,
    };
  }

  /**
   * Pointer-down routing while a crop session is active: a black handle
   * trims, the window body pans the image, and a click outside commits +
   * exits.
   */
  private onPointerDownCrop(e: MouseEvent): void {
    const session = this.cropSession;
    if (!session) return;
    const handle = this.handleAtClient(e.clientX, e.clientY);
    if (handle !== null && isCropHandle(handle)) {
      this.startCropHandleDrag(handle, e.clientX, e.clientY);
      return;
    }
    // Pan hit-test in the element's centred-local frame (handles rotation).
    const world = this.clientToLogical(e.clientX, e.clientY);
    const p = rotateVec(
      world.x - session.center.x,
      world.y - session.center.y,
      session.cos,
      -session.sin,
    );
    const w = session.window;
    if (p.x >= w.x && p.x <= w.x + w.w && p.y >= w.y && p.y <= w.y + w.h) {
      this.startCropPan(e.clientX, e.clientY);
      return;
    }
    this.exitImageCrop(true);
  }

  private startCropHandleDrag(
    handle: CropHandle,
    clientX: number,
    clientY: number,
  ): void {
    const session = this.cropSession;
    if (!session) return;
    const startWindow = session.window;
    this.runCropDrag(session, clientX, clientY, (dx, dy) => {
      session.window = applyCropHandle(session.full, startWindow, handle, dx, dy);
    });
  }

  private startCropPan(clientX: number, clientY: number): void {
    const session = this.cropSession;
    if (!session) return;
    const startFull = session.full;
    this.runCropDrag(session, clientX, clientY, (dx, dy) => {
      session.full = panFull(startFull, session.window, dx, dy);
    });
  }

  /**
   * Shared pointer-drag loop for crop trim / pan. `onDelta` receives the
   * delta already projected into the element's centred-local space (so
   * the same axis-aligned math works for rotated images); we repaint
   * after each move and tear the listeners down on pointerup. If the
   * session is ended mid-drag (Esc, detach, slide switch) the move is
   * ignored so a stale session is never mutated or painted.
   */
  private runCropDrag(
    session: NonNullable<typeof this.cropSession>,
    clientX: number,
    clientY: number,
    onDelta: (dx: number, dy: number) => void,
  ): void {
    // A new drag supersedes any previous one (shouldn't happen, but keeps
    // the single-cleanup invariant honest).
    this.cropDragCleanup?.();
    const start = this.clientToLogical(clientX, clientY);
    const onMove = (ev: MouseEvent): void => {
      if (this.cropSession !== session) return;
      const cur = this.clientToLogical(ev.clientX, ev.clientY);
      // World delta → centred-local delta via R(-θ) (rotation only).
      const d = rotateVec(
        cur.x - start.x,
        cur.y - start.y,
        session.cos,
        -session.sin,
      );
      onDelta(d.x, d.y);
      this.render();
      this.repaintOverlay();
    };
    const cleanup = (): void => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', cleanup);
      document.removeEventListener('pointercancel', cleanup);
      this.cropDragCleanup = null;
    };
    this.cropDragCleanup = cleanup;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', cleanup);
    document.addEventListener('pointercancel', cleanup);
  }

  markDirty(): void {
    this.renderer.markDirty();
    // External markDirty signals "the store changed in a way the editor
    // didn't initiate" (remote Yorkie edit, host shell mutation outside
    // an interaction handler). Both the canvas AND the overlay need to
    // refresh — the overlay carries permanent guides and selection
    // chrome that may now reference different ids / positions. Internal
    // mutators call `renderer.markDirty()` directly + their own
    // `repaintOverlay()`, so this branch only fires for external
    // signals and doesn't double-paint.
    this.repaintOverlay();
  }

  /** Cancel any in-flight preview RAF loop. Safe to call when idle. */
  private cancelPreviewRaf(): void {
    if (this.previewRafHandle !== null) {
      cancelAnimationFrame(this.previewRafHandle);
      this.previewRafHandle = null;
    }
  }

  previewAnimations(): void {
    if (this.disposed) return;

    // Cancel any existing preview and restart from step 0.
    this.cancelPreviewRaf();

    const doc = this.options.store.read();
    const id = this.currentId;
    const slide = id ? doc.slides.find((s) => s.id === id) : undefined;
    if (!slide) return;

    // Build the set of element ids present on this slide (flattened to
    // include group children so animations that target nested elements
    // are not filtered out by compileTimeline's existingElementIds guard).
    const existingElementIds = new Set(
      flattenElements(slide.elements).map((e) => e.id),
    );
    const paragraphCounts = buildParagraphCounts(slide);
    const steps = compileTimeline(slide, { existingElementIds, paragraphCounts });
    if (steps.length === 0) return;

    const player = new AnimationPlayer(
      steps,
      { w: SLIDE_WIDTH, h: SLIDE_HEIGHT },
      (states) => {
        if (this.disposed) return;
        this.renderer.forceRender(slide, doc, undefined, states);
      },
    );

    // Auto-play: advance through every step back-to-back without waiting
    // for user input (unlike the presenter which requires clicks).
    player.advance(); // start step 0

    const tick = (nowMs: number): void => {
      if (this.disposed) {
        this.previewRafHandle = null;
        return;
      }
      player.tick(nowMs);
      if (!player.isAnimating) {
        // Current step has settled.
        if (player.done) {
          // All steps finished — return to static render.
          this.previewRafHandle = null;
          this.renderer.markDirty();
          this.render();
          return;
        }
        // Advance to the next step and keep the loop going.
        player.advance();
      }
      this.previewRafHandle = requestAnimationFrame(tick);
    };

    this.previewRafHandle = requestAnimationFrame(tick);
  }

  detach(): void {
    this.disposed = true;
    if (this.editingTextBox !== null) {
      this.editingTextBox.detach();
      this.editingTextBox = null;
      this.editingElementId = null;
    }
    // Drop any active crop session, its in-flight drag listeners, and its
    // capture-phase key listener so a SlidesView remount starts clean.
    this.cropDragCleanup?.();
    if (this.cropKeyHandler !== null) {
      document.removeEventListener('keydown', this.cropKeyHandler, true);
      this.cropKeyHandler = null;
    }
    this.cropSession = null;
    // A pending hover-ghost rAF would otherwise fire after teardown
    // and paint into a detached canvas. Cancel it and drop the
    // preview state so a remount starts clean.
    if (this.hoverRenderRaf !== null) {
      cancelAnimationFrame(this.hoverRenderRaf);
      this.hoverRenderRaf = null;
    }
    // Cancel any in-flight animation preview so it doesn't paint into
    // a detached canvas after teardown.
    this.cancelPreviewRaf();
    this.hoverPreview = null;
    this.connectorCursor = null;
    // Rotate-angle tooltip is attached to the overlay's parent, not the
    // overlay itself, so renderOverlay's innerHTML rebuilds don't wipe
    // it. That same parent ownership means we must remove it explicitly
    // on teardown — otherwise a SlidesView remount leaves an orphan
    // hidden div behind every cycle.
    if (this.rotateTooltipEl !== null) {
      this.rotateTooltipEl.remove();
      this.rotateTooltipEl = null;
    }
    for (const { target, type, handler } of this.listeners) {
      target.removeEventListener(type, handler as EventListener);
    }
    this.listeners.length = 0;
    this.ruler?.dispose();
    this.ruler = null;
  }

  /** Internal helper used by interaction modules in T3-T7. */
  on<E extends Event>(target: EventTarget, type: string, handler: (e: E) => void): void {
    target.addEventListener(type, handler as EventListener);
    this.listeners.push({ target, type, handler: handler as (e: Event) => void });
  }

  private attachInteractions(): void {
    // Mousedown listens on BOTH the canvas (for clicks on the slide
    // surface) AND the overlay (for clicks on resize/rotate handles).
    // The overlay div has `pointer-events: none` so empty-area clicks
    // pass through to the canvas — only handle children with
    // `pointer-events: auto` are caught by the overlay listener.
    // Without the overlay listener, handle clicks bubble through the
    // overlay and never reach the canvas, so resize/rotate would
    // silently no-op.
    const onMouseDown = (e: Event) => this.onPointerDown(e as MouseEvent);
    this.on(this.options.canvas, 'pointerdown', onMouseDown);
    this.on(this.options.overlay, 'pointerdown', onMouseDown);
    this.on(document, 'keydown', (e) => {
      void this.handleKeyDown(e as KeyboardEvent);
    });
    // Hover-preview: while insert mode is armed, paint a translucent
    // "ghost" of the to-be-inserted shape under the cursor so the user
    // sees the kind / size / position before clicking. The overlay
    // sits above the canvas with `pointer-events: none`, so mousemove
    // on the canvas alone is enough — the overlay never intercepts
    // empty-area moves. mouseleave clears the ghost (otherwise it
    // would stick at the last in-canvas pointer position while the
    // user is in the toolbar).
    const onMove = (e: Event) => {
      this.onInsertHoverMove(e as MouseEvent);
      this.onSelectionHoverMove(e as PointerEvent);
    };
    const onLeave = () => {
      this.onInsertHoverLeave();
      if (this.lastHoverCursor !== '' && this.insertKind === null) {
        this.options.canvas.style.cursor = '';
        this.lastHoverCursor = '';
      }
    };
    this.on(this.options.canvas, 'pointermove', onMove);
    this.on(this.options.canvas, 'pointerleave', onLeave);
    // Double-click on the slide canvas (or overlay, when the click
    // hits a selection-frame area that overlaps a text element) enters
    // text edit mode if a text element was hit.
    const onDblClick = (e: Event) => this.onDoubleClick(e as MouseEvent);
    this.on(this.options.canvas, 'dblclick', onDblClick);
    this.on(this.options.overlay, 'dblclick', onDblClick);
    // Right-click on canvas (empty area) AND overlay (handles + selected
    // elements covered by the overlay). The hit-test inside
    // onContextMenu picks the appropriate menu kind.
    const onContext = (e: Event) => this.onContextMenu(e as MouseEvent);
    this.on(this.options.canvas, 'contextmenu', onContext);
    this.on(this.options.overlay, 'contextmenu', onContext);

    // Ruler drag-out: pressing on either ruler canvas seeds a pending
    // guide that follows the cursor. The drag is owned by
    // `startRulerDragOut` (it attaches its own document-level
    // pointermove / pointerup) so the gesture continues even if the
    // cursor wanders off the ruler. Only bound when the host actually
    // mounted the ruler (read-only viewers skip the ruler-canvas
    // listener entirely so even pointermove on the ruler is inert).
    if (this.options.hRulerCanvas !== undefined) {
      this.on(this.options.hRulerCanvas, 'pointerdown', (e) => {
        startRulerDragOut(this.guideDragHost(), 'x', e as PointerEvent);
      });
    }
    if (this.options.vRulerCanvas !== undefined) {
      this.on(this.options.vRulerCanvas, 'pointerdown', (e) => {
        startRulerDragOut(this.guideDragHost(), 'y', e as PointerEvent);
      });
    }

    // Body-area click: pointerdowns on the gray space surrounding the
    // slide canvas (between the rulers and the slide) deselect any
    // selected elements. Strict `target === bodyHost` check so children
    // — the canvas wrap, the rulers, the corner — keep their own
    // handlers (canvas owns lasso / drag, rulers own guide drag-out).
    if (this.options.bodyHost !== undefined) {
      this.on(this.options.bodyHost, 'pointerdown', (e) =>
        this.onBodyPointerDown(e as PointerEvent),
      );
    }
  }

  /**
   * Set the in-flight guide preview state and trigger an overlay
   * repaint. Passing `null` clears the preview. The interaction module
   * uses this through the `GuideDragHost` interface; the editor's
   * `repaintOverlay` reads `this.pendingGuide` to render the preview.
   */
  private setPendingGuide(
    guide: { id?: string; axis: 'x' | 'y'; position: number } | null,
  ): void {
    this.pendingGuide = guide;
    this.repaintOverlay();
  }

  /**
   * Compose the GuideDragHost backed by editor state. Captures
   * coordinate-conversion + region tests so the ruler interaction
   * module stays unaware of zoom / DPR / DOM layout.
   */
  private guideDragHost(): GuideDragHost {
    return {
      setPendingGuide: (guide) => this.setPendingGuide(guide),
      commitAddGuide: (axis, position) => {
        this.options.store.batch(() => {
          this.options.store.addGuide(axis, position);
        });
      },
      commitMoveGuide: (id, position) => {
        this.options.store.batch(() => {
          this.options.store.moveGuide(id, position);
        });
      },
      commitRemoveGuide: (id) => {
        this.options.store.batch(() => {
          this.options.store.removeGuide(id);
        });
      },
      readGuides: () => this.options.store.read().guides,
      clientToLogical: (cx, cy) => this.clientToLogical(cx, cy),
      isOverRuler: (cx, cy) => {
        const h = this.options.hRulerCanvas;
        const v = this.options.vRulerCanvas;
        if (h !== undefined) {
          const r = h.getBoundingClientRect();
          if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
            return 'h';
          }
        }
        if (v !== undefined) {
          const r = v.getBoundingClientRect();
          if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
            return 'v';
          }
        }
        return null;
      },
      isInsideSlide: (x, y) =>
        x >= 0 && x <= SLIDE_WIDTH && y >= 0 && y <= SLIDE_HEIGHT,
      setBodyCursor: (cursor) => {
        if (typeof document === 'undefined') return;
        document.body.style.cursor = cursor ?? '';
      },
    };
  }

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    this.lastContextX = e.clientX;
    this.lastContextY = e.clientY;
    const slide = this.currentSlide();
    if (!slide) return;
    const { x, y } = this.clientToLogical(e.clientX, e.clientY);
    const hitResult = this.hitTestAt(slide, x, y);
    if (hitResult === null) {
      // Guide hit takes precedence over the empty-canvas menu when the
      // user right-clicks directly on / near an alignment guide. Same
      // 4-px hit zone as pointerdown.
      const guide = hitTestGuide(this.options.store.read().guides, { x, y });
      if (guide !== null) {
        showContextMenu(
          document.body,
          this.guideContextItems(guide.id, guide.axis),
          e.clientX,
          e.clientY,
        );
        return;
      }
      showContextMenu(document.body, this.canvasContextItems(x, y), e.clientX, e.clientY);
      return;
    }
    // Route the right-click through the same drill-in state machine as
    // single-click. Without this, right-clicking inside a group sets
    // selection to the leaf child (whose frame is in group-local coords)
    // and the overlay draws handles at the wrong position; it also leaves
    // the selection on a non-group element so Ungroup stays disabled.
    if (!this.selection.has(hitResult.elementId)) {
      const beforeScope = this.selection.getScope();
      this.selection.click(hitResult, {});
      this.refitPoppedScope(beforeScope, this.selection.getScope(), slide.id);
    }
    const items = this.elementContextItems(slide.id);
    showContextMenu(document.body, items, e.clientX, e.clientY);
  }

  private elementContextItems(slideId: string): ContextMenuItem[] {
    // Selection has already been resolved by `onContextMenu` (right-click)
    // through the drill-in state machine. We DO NOT set it here — calling
    // `selection.set([leafId])` would bypass drill-in rules and leave the
    // overlay drawing handles at group-local coords for grouped children.
    const slide = this.options.store.read().slides.find((s) => s.id === slideId);
    const selectedIds = [...this.selection.get()];
    // Table-specific entries take priority over the generic shape /
    // connector / group menus when a table is the active element. The
    // tableItems block below is empty for non-tables so callers can
    // spread it unconditionally.
    const tableItems = this.tableContextItems(slideId);
    const groupItem: ContextMenuItem = {
      label: 'Group',
      disabled: !slide || !canGroup(selectedIds, slide),
      run: () => this.group(),
    };
    const ungroupItem: ContextMenuItem = {
      label: 'Ungroup',
      disabled: !slide || !canUngroup(selectedIds, slide),
      run: () => this.ungroup(),
    };

    // Vertical text alignment for single-text-element selections.
    // Sparse: undefined === 'top' (matches the renderer's fallback).
    // Skip for multi-selection or non-text elements so the action's
    // target is unambiguous.
    const textAlignItems: ContextMenuItem[] = [];
    // Routing radio group for connector selections (Straight / Elbow /
    // Curved). Single-selection only so the action's target is
    // unambiguous; the radio reflects the current routing.
    const connectorItems: ContextMenuItem[] = [];
    if (selectedIds.length === 1 && slide) {
      // Walk the element tree so the right-click menu still surfaces
      // text/connector items when the selection is a drilled-in group
      // child (whose id isn't in `slide.elements` directly).
      const el = findElement(slide.elements, selectedIds[0]);
      if (el?.type === 'text') {
        const current = el.data.verticalAnchor ?? 'top';
        const elementId = el.id;
        const store = this.options.store;
        const writeAnchor = (anchor: 'top' | 'middle' | 'bottom'): void => {
          if (anchor === current) return; // no-op write would still create an undo entry
          store.batch(() => store.updateElementData(slideId, elementId, { verticalAnchor: anchor }));
        };
        textAlignItems.push(
          { label: '---', run: () => undefined },
          { label: 'Align text top',    selected: current === 'top',    run: () => writeAnchor('top') },
          { label: 'Align text middle', selected: current === 'middle', run: () => writeAnchor('middle') },
          { label: 'Align text bottom', selected: current === 'bottom', run: () => writeAnchor('bottom') },
        );
      } else if (el?.type === 'connector') {
        const current = el.routing;
        const elementId = el.id;
        const store = this.options.store;
        const writeRouting = (r: typeof current): void => {
          if (r === current) return;
          store.batch(() => store.updateConnectorRouting(slideId, elementId, r));
        };
        connectorItems.push(
          { label: '---', run: () => undefined },
          { label: 'Straight', selected: current === 'straight', run: () => writeRouting('straight') },
          { label: 'Elbow',    selected: current === 'elbow',    run: () => writeRouting('elbow') },
          { label: 'Curved',   selected: current === 'curved',   run: () => writeRouting('curved') },
        );
      }
    }

    return [
      { label: 'Copy',  run: () => this.dispatchKey('c', { meta: true }) },
      { label: 'Cut',   run: () => this.dispatchKey('x', { meta: true }) },
      { label: 'Paste', run: () => this.dispatchKey('v', { meta: true }) },
      { label: '---', run: () => undefined },
      { label: 'Duplicate', run: () => this.dispatchKey('d', { meta: true }) },
      { label: 'Delete',    run: () => this.deleteSelected() },
      { label: '---', run: () => undefined },
      groupItem,
      ungroupItem,
      ...textAlignItems,
      ...connectorItems,
      ...tableItems,
      { label: '---', run: () => undefined },
      { label: 'Bring forward',  run: () => this.dispatchKey('ArrowUp',   { meta: true }) },
      { label: 'Send backward',  run: () => this.dispatchKey('ArrowDown', { meta: true }) },
      { label: 'Bring to front', run: () => this.dispatchKey('ArrowUp',   { meta: true, shift: true }) },
      { label: 'Send to back',   run: () => this.dispatchKey('ArrowDown', { meta: true, shift: true }) },
    ];
  }

  /**
   * Right-click menu items for table structural ops. Returns an empty
   * list (which is spread harmlessly) when the selection isn't a single
   * table — every other element kind falls back to its existing menu.
   *
   * When `cellSelection` is set, ops target the cell range:
   *   - Insert row above / below the range
   *   - Insert column left / right of the range
   *   - Delete row(s) / column(s) the range spans
   *   - Merge cells (when the range is > 1 cell and no overlap)
   *   - Unmerge cells (when the active anchor's gridSpan/rowSpan > 1)
   *
   * Without `cellSelection` the menu only exposes the element-level
   * "Delete table" (which is the generic Delete entry above), so the
   * table sub-menu collapses to nothing.
   */
  private tableContextItems(slideId: string): ContextMenuItem[] {
    if (this.selection.get().length !== 1) return [];
    const id = this.selection.get()[0];
    const slide = this.options.store.read().slides.find((s) => s.id === slideId);
    if (!slide) return [];
    const table = findElement(slide.elements, id);
    if (!table || table.type !== 'table') return [];
    const sel = this.cellSelection;
    if (sel === null || sel.tableId !== id) return [];

    const rmin = Math.min(sel.r0, sel.r1);
    const rmax = Math.max(sel.r0, sel.r1);
    const cmin = Math.min(sel.c0, sel.c1);
    const cmax = Math.max(sel.c0, sel.c1);
    const rowCount = rmax - rmin + 1;
    const colCount = cmax - cmin + 1;
    const store = this.options.store;

    // Single-cell anchor check: only the very cell the user
    // right-clicked is the gating coord for "Unmerge". When the user
    // has a multi-cell range we still expose Unmerge if the TOP-LEFT
    // of the range is a merge anchor — covers the common "select the
    // merged region by dragging and unmerge" path.
    const topLeft = table.data.rows[rmin]?.cells[cmin];
    const isAnchor =
      topLeft !== undefined &&
      ((topLeft.gridSpan ?? 1) > 1 || (topLeft.rowSpan ?? 1) > 1);
    const canMerge = rowCount > 1 || colCount > 1;

    // A row/column op that splices the table at `boundary` (the new
    // row's index, or the splice point for a column) corrupts any
    // merge anchor whose span strictly straddles that boundary —
    // the anchor's covered cells end up referencing rows / columns
    // that no longer line up. Disable the menu item rather than
    // throwing or orphaning cells. Delete passes its top + bottom
    // boundaries; insert passes the one splice point. Full
    // structural rewrite of mid-merge ops tracked separately.
    const crossesAt = (axis: 'row' | 'col', boundary: number): boolean => {
      const nRows = table.data.rows.length;
      const nCols = table.data.columnWidths.length;
      for (let r = 0; r < nRows; r++) {
        for (let c = 0; c < nCols; c++) {
          const cell = table.data.rows[r]?.cells[c];
          if (!cell) continue;
          const rs = cell.rowSpan ?? 1;
          const gs = cell.gridSpan ?? 1;
          if (rs <= 1 && gs <= 1) continue; // not an anchor
          if (axis === 'row') {
            if (rs > 1 && r < boundary && r + rs > boundary) return true;
          } else {
            if (gs > 1 && c < boundary && c + gs > boundary) return true;
          }
        }
      }
      return false;
    };

    const items: ContextMenuItem[] = [{ label: '---', run: () => undefined }];
    items.push({
      label: rowCount > 1 ? `Insert ${rowCount} rows above` : 'Insert row above',
      disabled: crossesAt('row', rmin),
      run: () => {
        store.batch(() => {
          for (let i = 0; i < rowCount; i++) {
            store.insertTableRow(slideId, id, rmin);
          }
        });
        this.requestRender();
      },
    });
    items.push({
      label: rowCount > 1 ? `Insert ${rowCount} rows below` : 'Insert row below',
      disabled: crossesAt('row', rmax + 1),
      run: () => {
        store.batch(() => {
          for (let i = 0; i < rowCount; i++) {
            store.insertTableRow(slideId, id, rmax + 1);
          }
        });
        this.requestRender();
      },
    });
    items.push({
      label: colCount > 1 ? `Insert ${colCount} columns left` : 'Insert column left',
      disabled: crossesAt('col', cmin),
      run: () => {
        store.batch(() => {
          for (let i = 0; i < colCount; i++) {
            store.insertTableColumn(slideId, id, cmin);
          }
        });
        this.requestRender();
      },
    });
    items.push({
      label: colCount > 1 ? `Insert ${colCount} columns right` : 'Insert column right',
      disabled: crossesAt('col', cmax + 1),
      run: () => {
        store.batch(() => {
          for (let i = 0; i < colCount; i++) {
            store.insertTableColumn(slideId, id, cmax + 1);
          }
        });
        this.requestRender();
      },
    });
    items.push({ label: '---', run: () => undefined });
    items.push({
      label: rowCount > 1 ? `Delete ${rowCount} rows` : 'Delete row',
      // Cannot remove the only row; the store throws "last row". The
      // menu greys out instead of letting the user discover that
      // mid-undo-stack. Also guard mid-merge bisects (anchor's row
      // span straddles either the top or bottom edge of the
      // deletion range).
      disabled:
        rowCount >= table.data.rows.length ||
        crossesAt('row', rmin) ||
        crossesAt('row', rmax + 1),
      run: () => {
        store.batch(() => {
          // Delete from the bottom so earlier indices stay valid as
          // rows splice out.
          for (let r = rmax; r >= rmin; r--) {
            store.deleteTableRow(slideId, id, r);
          }
        });
        // Cell-range now points at removed rows; drop it so the
        // overlay doesn't paint stale rects.
        this.setCellSelection(null);
        this.requestRender();
        this.repaintOverlay();
      },
    });
    items.push({
      label: colCount > 1 ? `Delete ${colCount} columns` : 'Delete column',
      disabled:
        colCount >= table.data.columnWidths.length ||
        crossesAt('col', cmin) ||
        crossesAt('col', cmax + 1),
      run: () => {
        store.batch(() => {
          for (let c = cmax; c >= cmin; c--) {
            store.deleteTableColumn(slideId, id, c);
          }
        });
        this.setCellSelection(null);
        this.requestRender();
        this.repaintOverlay();
      },
    });
    if (canMerge) {
      items.push({
        label: 'Merge cells',
        run: () => {
          store.batch(() => {
            try {
              store.mergeTableCells(slideId, id, {
                r0: rmin,
                c0: cmin,
                r1: rmax,
                c1: cmax,
              });
            } catch {
              // Overlap or out-of-range — surface as a no-op rather
              // than throwing past the menu's run() boundary.
            }
          });
          this.requestRender();
        },
      });
    }
    if (isAnchor) {
      items.push({
        label: 'Unmerge cells',
        run: () => {
          store.batch(() => {
            store.unmergeTableCells(slideId, id, { row: rmin, col: cmin });
          });
          this.requestRender();
        },
      });
    }

    // Cell-style ops. Patches apply to every non-covered cell in the
    // range so a 2x2 cell-range fill paints all four cells in one
    // batch (one undo entry). Covered cells skip — `updateTableCellStyle`
    // would throw on them.
    const applyStyleToRange = (
      patch: Partial<import('../../model/element').CellStyle>,
    ): void => {
      store.batch(() => {
        for (let r = rmin; r <= rmax; r++) {
          for (let c = cmin; c <= cmax; c++) {
            const cell = table.data.rows[r]?.cells[c];
            if (!cell) continue;
            if (cell.gridSpan === 0 || cell.rowSpan === 0) continue;
            store.updateTableCellStyle(slideId, id, r, c, patch);
          }
        }
      });
      this.requestRender();
    };

    // Fill palette — a fixed set of common backgrounds. "No fill"
    // removes the key entirely (so the cell renders transparent and
    // any future theme background shows through). Theme-aware
    // palettes can layer on top in a follow-up TableControls toolbar.
    items.push({ label: '---', run: () => undefined });
    const FILL_PALETTE: ReadonlyArray<{ label: string; color: string | undefined }> = [
      { label: 'Fill: none',       color: undefined },
      { label: 'Fill: white',      color: '#FFFFFF' },
      { label: 'Fill: light gray', color: '#E5E7EB' },
      { label: 'Fill: yellow',     color: '#FEF3C7' },
      { label: 'Fill: blue',       color: '#DBEAFE' },
      { label: 'Fill: green',      color: '#D1FAE5' },
      { label: 'Fill: red',        color: '#FEE2E2' },
    ];
    const sampleCellFill = (() => {
      // The "selected" radio prefix uses the top-left cell's current
      // fill as the representative value. Mixed fills across the
      // range fall through with no radio mark (the next click forces
      // them all to the chosen color).
      const sample = table.data.rows[rmin]?.cells[cmin]?.style.fill;
      return typeof sample === 'string' ? sample : undefined;
    })();
    for (const swatch of FILL_PALETTE) {
      items.push({
        label: swatch.label,
        selected: sampleCellFill === swatch.color,
        run: () => applyStyleToRange({ fill: swatch.color }),
      });
    }

    // Vertical alignment — three radio items. Selected reflects the
    // top-left cell; same "mixed range" caveat as the fill palette.
    items.push({ label: '---', run: () => undefined });
    const sampleVAlign =
      table.data.rows[rmin]?.cells[cmin]?.style.verticalAlign ?? 'top';
    items.push({
      label: 'Align cell top',
      selected: sampleVAlign === 'top',
      run: () => applyStyleToRange({ verticalAlign: 'top' }),
    });
    items.push({
      label: 'Align cell middle',
      selected: sampleVAlign === 'middle',
      run: () => applyStyleToRange({ verticalAlign: 'middle' }),
    });
    items.push({
      label: 'Align cell bottom',
      selected: sampleVAlign === 'bottom',
      run: () => applyStyleToRange({ verticalAlign: 'bottom' }),
    });

    // Border presets: all sides on, outer perimeter only, all sides
    // cleared. The default border style is 1-px solid black — enough
    // to be visible against any cell fill. Per-side + custom-color
    // pickers will live in the contextual TableControls toolbar.
    items.push({ label: '---', run: () => undefined });
    const DEFAULT_BORDER: import('../../model/element').CellBorder = {
      color: '#000000',
      width: 1,
    };
    const applyBorderPattern = (
      pattern: 'all' | 'outer' | 'clear',
    ): void => {
      store.batch(() => {
        for (let r = rmin; r <= rmax; r++) {
          for (let c = cmin; c <= cmax; c++) {
            const cell = table.data.rows[r]?.cells[c];
            if (!cell) continue;
            if (cell.gridSpan === 0 || cell.rowSpan === 0) continue;
            const onTop = pattern === 'all' || (pattern === 'outer' && r === rmin);
            const onBottom = pattern === 'all' || (pattern === 'outer' && r === rmax);
            const onLeft = pattern === 'all' || (pattern === 'outer' && c === cmin);
            const onRight = pattern === 'all' || (pattern === 'outer' && c === cmax);
            const nextBorder: import('../../model/element').CellStyle['border'] = {
              ...(cell.style.border ?? {}),
              top: onTop ? { ...DEFAULT_BORDER } : undefined,
              bottom: onBottom ? { ...DEFAULT_BORDER } : undefined,
              left: onLeft ? { ...DEFAULT_BORDER } : undefined,
              right: onRight ? { ...DEFAULT_BORDER } : undefined,
            };
            // Drop the whole border object when no side remains so the
            // model stays clean. The renderer treats `border ===
            // undefined` and `border = { top: undefined, ... }` the
            // same, but the former round-trips through PPTX export
            // more faithfully (no empty container nodes).
            if (pattern === 'clear') {
              store.updateTableCellStyle(slideId, id, r, c, { border: undefined });
            } else {
              store.updateTableCellStyle(slideId, id, r, c, { border: nextBorder });
            }
          }
        }
      });
      this.requestRender();
    };
    items.push({ label: 'Cell border: all', run: () => applyBorderPattern('all') });
    items.push({ label: 'Cell border: outer', run: () => applyBorderPattern('outer') });
    items.push({ label: 'Cell border: clear', run: () => applyBorderPattern('clear') });

    // Distribute columns / rows evenly — common when one drag-resize
    // throws off the proportions. Operates across the WHOLE table
    // (not just the range) because a partial distribute would shift
    // the unrelated columns' positions which is rarely what the user
    // wants. The store ops keep the CR#13 invariant so the total
    // width / height stays constant.
    items.push({ label: '---', run: () => undefined });
    items.push({
      label: 'Distribute columns evenly',
      disabled: table.data.columnWidths.length < 2,
      run: () => {
        const total = table.data.columnWidths.reduce((a, b) => a + b, 0);
        const n = table.data.columnWidths.length;
        const even = Array(n).fill(total / n);
        store.batch(() => {
          store.updateTableColumnWidths(slideId, id, even);
        });
        this.requestRender();
      },
    });
    items.push({
      label: 'Distribute rows evenly',
      disabled: table.data.rows.length < 2,
      run: () => {
        const total = table.data.rows.reduce((a, r) => a + r.height, 0);
        const n = table.data.rows.length;
        const even = Array(n).fill(total / n);
        store.batch(() => {
          store.updateTableRowHeights(slideId, id, even);
        });
        this.requestRender();
      },
    });

    // Delete the whole table — distinct from the generic "Delete"
    // entry above (which removes the selected ELEMENT regardless of
    // cell-range state). Surface here so a user with a cell range
    // doesn't have to Esc + Backspace to drop the table.
    items.push({ label: '---', run: () => undefined });
    items.push({
      label: 'Delete table',
      run: () => {
        this.setCellSelection(null);
        store.batch(() => {
          store.removeElement(slideId, id);
        });
        this.selection.clear();
        this.requestRender();
        this.repaintOverlay();
      },
    });

    return items;
  }

  private guideContextItems(
    guideId: string,
    axis: 'x' | 'y',
  ): ContextMenuItem[] {
    const store = this.options.store;
    return [
      {
        label: 'Delete guide',
        run: () => {
          store.batch(() => store.removeGuide(guideId));
        },
      },
      {
        label: axis === 'x'
          ? 'Delete all vertical guides'
          : 'Delete all horizontal guides',
        run: () => {
          const ids = store
            .read()
            .guides.filter((g) => g.axis === axis)
            .map((g) => g.id);
          if (ids.length === 0) return;
          store.batch(() => {
            for (const id of ids) store.removeGuide(id);
          });
        },
      },
      {
        label: 'Delete all guides',
        run: () => {
          const ids = store.read().guides.map((g) => g.id);
          if (ids.length === 0) return;
          store.batch(() => {
            for (const id of ids) store.removeGuide(id);
          });
        },
      },
    ];
  }

  private canvasContextItems(x: number, y: number): ContextMenuItem[] {
    return [
      { label: 'Paste', run: () => this.dispatchKey('v', { meta: true }) },
      { label: '---',   run: () => undefined },
      {
        label: 'Change layout…',
        run: () => {
          const slide = this.currentSlide();
          if (!slide) return;
          showLayoutPicker(document.body, {
            store: this.options.store,
            anchor: { x: this.lastContextX, y: this.lastContextY },
            selectedLayoutId: slide.layoutId,
            onPick: (layoutId) => {
              this.options.store.batch(() =>
                this.options.store.applyLayout(slide.id, layoutId),
              );
              this.requestRender();
            },
            onClose: () => {},
          });
        },
      },
      { label: '---',   run: () => undefined },
      { label: 'Insert rectangle', run: () => this.insertAt('rect', x, y) },
      { label: 'Insert ellipse',   run: () => this.insertAt('ellipse', x, y) },
      { label: 'Insert text',      run: () => this.insertAt('text', x, y) },
    ];
  }

  private insertAt(kind: ShapeOrTextInsertKind, x: number, y: number): void {
    const slide = this.currentSlide();
    if (!slide) return;
    // Default-size insert at the click point. Passing start === end
    // triggers buildInsertElement's click branch, which looks up the
    // per-kind default frame (rect → SHAPE_WIDE, ellipse →
    // SHAPE_SQUARE, etc.). Text uses its own fixed default box.
    const init = buildInsertElement(kind, { x, y }, { x, y });
    this.options.store.batch(() => {
      const id = this.options.store.addElement(slide.id, init);
      this.selection.set([id]);
    });
    this.requestRender();
  }

  private dispatchKey(
    key: string,
    mods: { meta?: boolean; shift?: boolean },
  ): void {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key,
      metaKey: mods.meta,
      shiftKey: mods.shift,
      bubbles: true,
    }));
  }

  private async handleKeyDown(e: KeyboardEvent): Promise<void> {
    await runKeyRules(e, this.keyRules);
  }

  private onPointerDown(e: MouseEvent): void {
    // Clear any pending hover highlight when the user starts interacting.
    // This suppresses the outline during drag/resize/connector operations.
    this.clearHoverHighlight();

    // Keep hover suppressed for the lifetime of the gesture. The canvas
    // `pointermove` listener (`onSelectionHoverMove`) keeps firing during
    // lasso/move/resize/rotate drags — those install document-level
    // listeners but don't otherwise stop the canvas listener from
    // re-running hit-test and re-assigning `hoverHighlightId`. The
    // capture-phase pointerup/cancel handler below flips the flag back
    // off before any of the per-drag onUp handlers run, so resuming hover
    // on the very next pointermove after release feels instant.
    this.pointerInteractionActive = true;
    const onAnyUp = (): void => {
      this.pointerInteractionActive = false;
      document.removeEventListener('pointerup', onAnyUp, true);
      document.removeEventListener('pointercancel', onAnyUp, true);
    };
    document.addEventListener('pointerup', onAnyUp, true);
    document.addEventListener('pointercancel', onAnyUp, true);

    // Crop session is modal: route the gesture to the crop handlers and
    // never fall through to select / drag / resize / lasso.
    if (this.cropSession !== null) {
      this.onPointerDownCrop(e);
      return;
    }

    // Format painter: the very first branch so a paint-mode click
    // can never accidentally trigger select / drag / lasso / insert.
    // Paint mode is suppressed while a text box is open — the user
    // is in a different keystroke domain — falling through to the
    // regular text-edit click logic below.
    if (this.paintSnapshot !== null && this.editingElementId === null) {
      this.applyFormatPaintAt(e.clientX, e.clientY);
      return;
    }
    // While a text-box is being edited:
    //   - clicks INSIDE its container should pass through to the
    //     text-box editor (let the docs TextEditor handle cursor /
    //     selection). The container has `pointer-events: auto` and the
    //     mousedown event's target will be either the container itself
    //     or a descendant (canvas inside it).
    //   - clicks OUTSIDE commit the text-box and exit edit mode.
    //   - either way the editor's drag/resize/lasso paths must NOT run
    //     while editing.
    if (this.editingElementId !== null) {
      const tb = this.editingTextBox;
      if (tb !== null) {
        const target = e.target as Node | null;
        if (target !== null && tb.container.contains(target)) {
          // Inside the editor — let TextEditor handle it.
          return;
        }
        // Click outside → commit + exit edit mode. We commit synchronously
        // (commit() blurs the textarea, which routes through onCommit).
        // Don't propagate the click into select/drag/lasso — that gives
        // a familiar "click-out cancels editing" affordance without
        // accidentally starting a drag on whatever was clicked.
        this.exitEditMode('commit');
      }
      return;
    }
    if (this.insertKind !== null) {
      this.startInsert(e.clientX, e.clientY);
      return;
    }
    const handle = this.handleAtClient(e.clientX, e.clientY);
    if (handle !== null) {
      this.onPointerDownHandle(handle, e.clientX, e.clientY);
      return;
    }

    const slide = this.currentSlide();
    if (!slide) return;
    const { x, y } = this.clientToLogical(e.clientX, e.clientY);

    // Hit-test against an element first. Use the depth-aware hitTestSlide
    // (which descends into groups) and route through Selection.click so the
    // drill-in state machine picks the right element at the current scope.
    const hitResult = this.hitTestAt(slide, x, y);
    if (hitResult === null) {
      // No element under the pointer — check for an alignment guide
      // within the 4-px hit zone. Elements take precedence (guides are
      // editor scaffolding that lives "underneath" content); guides
      // pre-empt the empty-canvas fallbacks below (lasso, drill-out).
      const guide = hitTestGuide(this.options.store.read().guides, { x, y });
      if (guide !== null) {
        startGuideMove(this.guideDragHost(), guide, e as PointerEvent);
        return;
      }
    }
    if (hitResult !== null) {
      const mods = { shift: e.shiftKey };
      // If the scope-level element under the pointer is already in the
      // current selection, skip Selection.click to preserve a multi-selection
      // (e.g. clicking on one of several selected elements should keep all
      // selected so a subsequent drag moves them together).
      const scopeId = pickScopeId(hitResult, this.selection.getScope());
      // Click on an already-selected, top-level, non-rotated table:
      // - On an interior column / row border (4-px tolerance) → arm a
      //   drag-resize for that border. Border check wins over cell
      //   selection so the user can grab a border that runs through
      //   the cell they would otherwise have selected.
      // - Elsewhere → drill into cell selection. The table's element
      //   selection (and its outer handles) stay; only the interior
      //   click pivots from "arm drag" to "set cellSelection". Matches
      //   Google Slides where an interior click on a selected table
      //   picks a cell and the user moves the whole table via the
      //   selection-border / handles.
      if (
        scopeId !== null &&
        this.selection.has(scopeId) &&
        this.selection.get().length === 1
      ) {
        const hitEl = findElement(slide.elements, scopeId);
        const topLevel = slide.elements.some((el) => el.id === scopeId);
        if (
          hitEl?.type === 'table' &&
          hitEl.frame.rotation === 0 &&
          topLevel
        ) {
          const doc = this.options.store.read();
          const layout = computeTableLayout(hitEl.data, {
            fontScale: deckFontScale(doc.meta),
          });
          const localX = x - hitEl.frame.x;
          const localY = y - hitEl.frame.y;
          // Border drag check first — same 4-px host-pixel tolerance
          // the hover cursor logic uses (so the visible col-resize
          // cursor and the actual grab zone agree).
          const edge = tableEdgeAt(layout, localX, localY, 4 / this.scale());
          if (edge !== null) {
            e.preventDefault();
            this.startTableEdgeResize(e as PointerEvent, hitEl, edge);
            return;
          }
          const cell = tableCellAtPoint(
            hitEl.data,
            layout,
            localX,
            localY,
          );
          if (cell !== null) {
            // Shift+click extends the current range to include the
            // newly-clicked cell. Plain click resets to a fresh
            // single-cell range anchored at the click. The drag tail
            // (below) keeps the anchor (r0,c0) fixed and updates
            // (r1,c1) as the pointer moves.
            const anchor =
              mods.shift && this.cellSelection?.tableId === scopeId
                ? { r0: this.cellSelection.r0, c0: this.cellSelection.c0 }
                : { r0: cell.row, c0: cell.col };
            this.setCellSelection({
              tableId: scopeId,
              r0: anchor.r0,
              c0: anchor.c0,
              r1: cell.row,
              c1: cell.col,
            });
            this.lastClickElementId = scopeId;
            this.lastClickAt = e.timeStamp;
            this.repaintOverlay();
            // Arm drag-to-extend: track pointermove and update r1/c1
            // as the pointer hits new cells. pointerup tears the
            // listeners down. Stays within the same table — moves
            // outside the table bounds clamp to the last valid cell.
            this.startCellRangeDrag(hitEl, layout);
            return;
          }
        }
      }
      if (!mods.shift && scopeId !== null && this.selection.has(scopeId)) {
        // P1.5 eligibility: the spec requires a real PRIOR click on the
        // same element within the sequence window — programmatic selection
        // alone must not arm slow-double-click. We additionally suppress
        // the synthetic click + focus cascade on the eligible path so the
        // freshly-mounted textarea keeps focus on entry (same hazard the
        // P1.4 branch below preventDefaults for).
        const eligible =
          this.lastClickElementId === scopeId &&
          e.timeStamp - this.lastClickAt < SLOW_DOUBLE_CLICK_SEQUENCE_WINDOW_MS;
        this.lastClickElementId = scopeId;
        this.lastClickAt = e.timeStamp;
        if (eligible) e.preventDefault();
        this.startDrag(e.clientX, e.clientY, e.timeStamp, eligible);
        return;
      }
      const beforeScope = this.selection.getScope();
      this.selection.click(hitResult, mods);
      const afterScope = this.selection.getScope();
      this.refitPoppedScope(beforeScope, afterScope, slide.id);

      // P1.4: empty-placeholder 1-click entry. A fresh non-shift click on
      // a `text` element acting as an empty layout placeholder (ghost hint
      // visible) selects AND enters text-edit in the same gesture, so a
      // brand-new "Title + Body" slide is typeable in one click per region.
      // Non-placeholders and non-empty placeholders fall through to the
      // regular `startDrag` arming. See
      // docs/design/slides/slides-hover-and-text-edit-entry.md § P1.4.
      if (!mods.shift && this.selection.get().length === 1) {
        const selectedId = this.selection.get()[0];
        const el = findElement(slide.elements, selectedId);
        if (isEmptyPlaceholder(el)) {
          // Match the dblclick path: stop the browser's default click /
          // focus cascade so the freshly-mounted text-box's textarea
          // keeps focus. Without preventDefault, the pointerup +
          // synthetic click that follow this pointerdown re-focus the
          // canvas (or body) and the textarea blurs → onCommit fires
          // before the user types anything, dropping us back out of
          // edit mode within ~1 ms. See onDoubleClick at line 2096.
          e.preventDefault();
          // Record the click so a subsequent click after exitTextEditing
          // can be recognised as the "second" click of a P1.5 sequence.
          this.lastClickElementId = selectedId;
          this.lastClickAt = e.timeStamp;
          this.enterEditMode(slide.id, selectedId);
          return;
        }
      }

      // Begin drag on the (possibly newly-)selected elements unless the
      // element was just removed by shift-toggle. Not a slow-double-click
      // candidate: the element was just selected by THIS click, so the
      // release must stay a no-op (Google Slides parity). We still record
      // the click so the NEXT pointer-down on the same element can become
      // the "second click" of a P1.5 sequence.
      if (this.selection.get().length > 0) {
        if (!mods.shift && scopeId !== null) {
          this.lastClickElementId = scopeId;
          this.lastClickAt = e.timeStamp;
        }
        this.startDrag(e.clientX, e.clientY, e.timeStamp, false);
      }
      return;
    }

    // Empty canvas — Google Slides behavior:
    //   * If drilled into a group, pop the entire scope first (and refit
    //     each popped group). Subsequent click-actions (lasso etc.) run
    //     at the slide root.
    //   * Then start a lasso (unless shift is held).
    if (this.selection.getScope().length > 0) {
      const beforeScope = this.selection.getScope();
      // Clear scope + ids in one notify, matching Google Slides' "click
      // outside a drilled-in group exits drill-in".
      this.selection.click(null, {});
      this.refitPoppedScope(beforeScope, this.selection.getScope(), slide.id);
    }
    if (e.shiftKey) {
      return;
    }
    this.startLasso(e.clientX, e.clientY);
  }

  private onBodyPointerDown(e: PointerEvent): void {
    // Only the empty body itself — clicks that bubble up from a child
    // (canvas wrap, rulers, corner) are owned by those elements'
    // dedicated handlers.
    if (e.target !== this.options.bodyHost) return;

    // Mirror the canvas branch: a body click while cropping commits +
    // exits the crop session (and must NOT fall through to deselect).
    if (this.cropSession !== null) {
      this.exitImageCrop(true);
      return;
    }

    // Inert during paint / insert modes: missing the slide canvas
    // shouldn't apply a paint or place a shape, and silently
    // deselecting under the user's gesture would feel surprising.
    if (this.paintSnapshot !== null) return;
    if (this.insertKind !== null) return;

    // Mirror the canvas branch: clicking outside an open text-box
    // commits and exits edit mode. No deselect — the user's intent is
    // just to leave the textbox.
    if (this.editingElementId !== null) {
      this.exitEditMode('commit');
      return;
    }

    const slide = this.currentSlide();
    if (!slide) return;
    const beforeScope = this.selection.getScope();
    // `selection.click(null, {})` clears ids + pops scope in one notify,
    // matching the empty-canvas branch above.
    this.selection.click(null, {});
    this.refitPoppedScope(beforeScope, this.selection.getScope(), slide.id);
  }

  private onDoubleClick(e: MouseEvent): void {
    // Double-click enters text-edit on text elements and on shapes
    // (matches PowerPoint / Google Slides where every autoshape is a
    // text container). For grouped elements, drill in one level first
    // so the user descends into groups the same way Google Slides does.
    // Clicks on other element kinds at the leaf level are ignored.
    // A crop session owns its own pointer handling — ignore dblclicks.
    if (this.cropSession !== null) return;
    const slide = this.currentSlide();
    if (!slide) return;
    const { x, y } = this.clientToLogical(e.clientX, e.clientY);
    const hitResult = this.hitTestAt(slide, x, y);
    if (hitResult === null) return;
    // The text-box editor's container lives inside the overlay, so a
    // dblclick *inside* the active editor bubbles up here. Re-entering
    // edit mode on the same element would commit + remount the
    // text-box, resetting the docs cursor to offset 0 and wiping the
    // word selection the inner TextEditor's second mousedown just
    // made. Bail out and let the inner editor own the dblclick.
    if (hitResult.elementId === this.editingElementId) return;

    // Drive the drill-in state machine first.
    const beforeScope = this.selection.getScope();
    this.selection.doubleClick(hitResult);
    this.refitPoppedScope(beforeScope, this.selection.getScope(), slide.id);

    // After drill-in, check if the newly-selected element accepts text.
    // Use the leaf-most element id from the hit (which is what
    // Selection.doubleClick ultimately lands on at the deepest available
    // scope level).
    const selectedIds = this.selection.get();
    if (selectedIds.length !== 1) return;
    const el = findElement(slide.elements, selectedIds[0]);
    if (!el) return;
    if (el.type === 'table') {
      // Tables route the dblclick into the table-aware cell editor.
      // Rotated tables don't support cell editing in P3 (the cell's
      // center of rotation is NOT the table's center, so the in-place
      // editor and the painted cell would diverge); silently fall
      // through. Group-nested tables also fall through — `frame.x/y`
      // is parent-local for grouped elements, so the world-to-local
      // subtraction below would land on the wrong cell; mirrors the
      // single-click guard at ~2708.
      if (el.frame.rotation !== 0) return;
      const topLevel = slide.elements.some((e) => e.id === el.id);
      if (!topLevel) return;
      const localX = x - el.frame.x;
      const localY = y - el.frame.y;
      const doc = this.options.store.read();
      const layout = computeTableLayout(el.data, {
        fontScale: deckFontScale(doc.meta),
      });
      const cell = tableCellAtPoint(el.data, layout, localX, localY);
      if (!cell) return;
      e.preventDefault();
      e.stopPropagation();
      this.enterEditMode(slide.id, el.id, { cell });
      return;
    }
    if (el.type === 'image') {
      // Double-click an image enters crop (Google Slides parity), rotated
      // or not. Top-level only — grouped images have parent-local frames.
      if (!slide.elements.some((e) => e.id === el.id)) return;
      e.preventDefault();
      e.stopPropagation();
      this.enterImageCrop(el.id);
      return;
    }
    if (el.type !== 'text' && el.type !== 'shape') return;
    e.preventDefault();
    e.stopPropagation();
    this.enterEditMode(slide.id, el.id);
  }

  private enterEditMode(
    slideId: string,
    elementId: string,
    options?: { initialText?: string; cell?: { row: number; col: number } },
  ): void {
    // If we're already editing some other text-box, commit it first so
    // the text in flight is not lost when focus moves.
    if (this.editingElementId !== null) {
      this.exitEditMode('commit');
    }
    // Single read so the slide and the deck theme come from the same
    // snapshot — the text-box editor needs a theme-aware colorResolver
    // (built below) to paint text in the deck's theme color, matching
    // the committed slide canvas.
    const doc = this.options.store.read();
    const slide = doc.slides.find((s) => s.id === slideId);
    if (!slide) return;
    // Resolve the element anywhere in the slide tree (including inside
    // groups) — `Array.prototype.find` would only see top-level
    // elements, so grouped text/shape would silently fail to enter
    // edit mode.
    const localElement = findElement(slide.elements, elementId);
    if (!localElement) return;
    const isCellMode = options?.cell !== undefined;
    if (isCellMode) {
      // Cell edit requires the element to be a table; everything else
      // is a programmer error so reject silently rather than mounting
      // a text editor over an unrelated element.
      if (localElement.type !== 'table') return;
    } else if (
      localElement.type !== 'text' &&
      localElement.type !== 'shape'
    ) {
      return;
    }

    // The overlay text-box mounts in WORLD coords (`frame.x * scale`,
    // CSS rotate around centre). For grouped elements the stored
    // `frame` is group-local; compose the ancestor transforms via
    // `buildElementWorldLookup` so the editor lines up with where the
    // slide canvas paints the element. For top-level elements the
    // world lookup returns the live element by reference, so this is
    // a no-op.
    const worldLookup = buildElementWorldLookup(slide.elements);
    const worldElement = worldLookup.get(elementId);
    if (!worldElement) return;

    // Build a small descriptor that papers over the difference between
    // editing a TextElement (text in `data.blocks`, frame auto-grows to
    // fit content), a ShapeElement (text in `data.text.blocks`, frame
    // is user-sized and does NOT auto-grow), and a single TableElement
    // cell (text in `data.rows[r].cells[c].body.blocks`, mounted on
    // the cell's inner rect within the table's world frame).
    let target: EditTarget | null;
    if (isCellMode) {
      const cellCoord = options!.cell!;
      target = buildCellEditTarget(
        worldElement as TableElement,
        cellCoord.row,
        cellCoord.col,
        worldElement.frame,
        deckFontScale(doc.meta),
      );
      // null means rotated table / covered cell / out-of-bounds —
      // dblclick should silently fall through rather than mount on a
      // bogus rect.
      if (target === null) return;
    } else {
      target = buildEditTarget(
        worldElement as TextElement | ShapeElement,
      );
    }

    // Frame height at entry; the committed fit only writes when the
    // content height differs from this (text-element only; shapes skip
    // the post-commit frame fit). Read from the LOCAL element because
    // `store.updateElementFrame` writes the height back in local space.
    // Reset the per-edit tracker so a stale height from a previous
    // edit can't leak into this commit.
    const enterFrameH = localElement.frame.h;
    // The autofit-grow commit path reads the editor's reported content
    // height (in world / canvas-logical coords) and writes it straight
    // into `frame.h` (LOCAL). For top-level elements local === world;
    // for groups with rotation 0 + unit scale, w/h/rotation still
    // match between local and world. When they DIVERGE (rotated or
    // scaled ancestor group), the world-h cannot be stored as local-h
    // without dividing by the cumulative scaleY — out of scope here.
    // Skip the fit in those cases so we never corrupt the stored
    // height; rotated/scaled groups simply don't autofit-grow on
    // commit. Falls through cleanly for normal (top-level / scale-1)
    // elements.
    const localFrame = localElement.frame;
    const worldFrame = worldElement.frame;
    const ancestorHasTransform =
      worldFrame.w !== localFrame.w ||
      worldFrame.h !== localFrame.h ||
      worldFrame.rotation !== localFrame.rotation;
    this.lastEditingContentHeight = null;
    // Auto-grow only applies to text elements without a transformed
    // ancestor — the same gate the commit path uses before writing the
    // grown height back. Drives the live underlay re-render so the box
    // fill/border tracks the growing editor.
    this.editingGrowApplicable = target.kind === 'text' && !ancestorHasTransform;

    // Make sure the selection is on the editing element so the rest of
    // the editor (toolbar etc.) reflects the active target. Drop any
    // standing cell-range selection: text edit is a different mode and
    // the cell rect's blue tint would compete visually with the text-
    // box's outline.
    this.selection.set([elementId]);
    this.editingElementId = elementId;
    this.editingCellCoords = target.cell ?? null;
    this.setCellSelection(null);
    // Drop any idle hover highlight and stale hover cursor; once
    // text-edit owns the box, pointermove early-returns without
    // re-evaluating either.
    this.clearHoverHighlight();
    if (this.lastHoverCursor !== '') {
      this.options.canvas.style.cursor = '';
      this.lastHoverCursor = '';
    }

    // Escape sets `cancelled` first, THEN the docs editor routes the
    // blur cascade through the onCommit branch below. The flag tells
    // onCommit to skip the store write so the user's in-flight edits
    // are discarded — matching the Word / Google Docs convention. The
    // editor's source of truth (Yorkie) is only ever touched on
    // commit, so "discard" is just "don't write" — no rollback needed.
    let cancelled = false;
    const tb = this.mountTextBox({
      overlay: this.options.overlay,
      // Shapes inset the editing frame by the same padding the renderer
      // applies (`SHAPE_TEXT_PADDING`) so the caret + glyphs in the
      // editor sit where the committed paint will land. Text elements
      // pass the full element frame as today.
      frame: target.editFrame,
      scale: this.scale(),
      blocks: target.blocks,
      // Drives editor autofit: 'shrink' scales fonts to fit the fixed box,
      // 'grow' (and absent) tracks content height, 'none' is fixed. The
      // wrapper gates onContentHeightChange so shrink/none never auto-grow.
      autofit: target.autofit,
      // Shapes and table cells keep the editor canvas at the inner-frame
      // height so the vertical anchor in the editor agrees with the
      // renderer's anchor inside the original frame. Without this the docs
      // editor would shrink the canvas to text height and anchor at
      // originY=0, producing a visible jump between edit and committed
      // positions — for cells this reads as the box collapsing to the text
      // height on entry. Cell rows auto-grow only on commit via the
      // renderer, so the box must stay fixed while editing, just like a
      // shape. Only text elements keep the default auto-grow behavior.
      growMode: target.kind === 'text' ? 'auto' : 'never',
      // Mirror the slide canvas offset so in-place editing keeps the
      // caret and text glyphs aligned with the committed render.
      verticalAnchor: target.verticalAnchor,
      colorResolver: makeColorResolver(getActiveTheme(doc)),
      // Deck-level font pre-scale (from `deckFontScale(meta)`). Composed
      // into the in-place editor's `transformLayoutBlocks` so the
      // editing canvas paints at the same px size the committed slide
      // renderer does. Decks without `meta.pxPerPt` get `1`.
      fontScale: deckFontScale(doc.meta),
      onLinkRequest: this.options.onLinkRequest,
      // P2.6 — forward the printable key that triggered text-edit entry
      // so the wrapper can inject it on first focus(). Absent for every
      // other entry path (dblclick, F2/Enter, click on empty placeholder).
      initialText: options?.initialText,
      // Fixed boxes (shape / cell) don't auto-grow, so text can overflow
      // the box. The committed slide renderer paints that overflow with no
      // per-box clip — bounded only by the slide edge. Mount the editing
      // canvas as a full-slide surface positioned over the slide (the box
      // sits `editFrame.x/y` px inside it) so live overflow paints in every
      // direction exactly where the committed render puts it. Text elements
      // auto-grow instead, so they never overflow and keep the frame-sized
      // canvas.
      overflowBounds:
        target.kind === 'text'
          ? undefined
          : {
              left: target.editFrame.x,
              top: target.editFrame.y,
              width: SLIDE_WIDTH,
              height: SLIDE_HEIGHT,
            },
      onContentHeightChange: (h: number): void => {
        const changed = this.lastEditingContentHeight !== h;
        this.lastEditingContentHeight = h;
        // Repaint the underlay so the box fill/border grows in lockstep
        // with the live editor height. Without this the decoration stays
        // at the enter-time height until commit. Gated to grow-eligible
        // text edits so shape/cell/fixed boxes never repaint here.
        if (changed && this.editingGrowApplicable) {
          this.render();
        }
      },
      onCommit: (next) => {
        // Persist via the kind-appropriate bridge and exit edit mode.
        // We snapshot the slide id at enter-time because the user could
        // have switched slides during editing.
        if (!cancelled) {
          try {
            this.options.store.batch(() => {
              if (target!.kind === 'text') {
                this.options.store.withTextElement(slideId, elementId, () => next);
                // Fit the frame height to the content in the SAME batch
                // as the text write — one undo entry, no per-keystroke
                // churn. Shapes keep their authored frame; skip the fit.
                // Also skip when the element sits inside a rotated /
                // non-unit-scale group: the reported height is in world
                // coords, and writing it into the local `frame.h`
                // without composing the inverse ancestor transform
                // would silently corrupt the stored height.
                const h = this.lastEditingContentHeight;
                if (h !== null && !ancestorHasTransform) {
                  const targetH = Math.max(MIN_TEXT_BOX_H, h);
                  if (targetH !== enterFrameH) {
                    this.options.store.updateElementFrame(slideId, elementId, { h: targetH });
                  }
                }
              } else if (target!.kind === 'cell' && target!.cell) {
                // Cell text writes through the table-aware bridge. Row
                // height auto-grow is handled by the renderer at next
                // paint via computeTableLayout's "max(declared,
                // contentHeight)" rule, so no row.height writeback is
                // needed here — keeping the declared row.height stable
                // matches PPTX `<a:tr h>` "minimum" semantics.
                this.options.store.withTableCellBody(
                  slideId,
                  elementId,
                  target!.cell.row,
                  target!.cell.col,
                  () => next,
                );
              } else {
                this.options.store.withShapeText(slideId, elementId, () => next);
              }
            });
          } catch {
            // The element may have been removed during editing; swallow
            // the not-found and just exit edit mode cleanly.
          }
        }
        this.finishEditMode();
      },
      onCancel: () => {
        cancelled = true;
      },
    });
    this.editingTextBox = tb;
    this.activeTextEditor = tb;
    for (const cb of this.textEditingListeners) cb();
    // Repaint the slide canvas so the element being edited disappears
    // (render() filters it out while editingElementId is non-null), then
    // refresh the overlay (which also hides the resize/rotate handles
    // for that element). Without the slide repaint the canvas keeps the
    // pre-edit text, which would show through under the editor's own
    // canvas as a ghost copy.
    this.renderer.markDirty();
    this.render();
    this.repaintOverlay();
    // Cell-edit only: intercept Tab / Shift+Tab on the text-box
    // container before the docs editor's contenteditable sees it,
    // commit the current cell, and re-enter on the adjacent cell.
    // Capture phase guarantees we run before any descendant Tab
    // handler the docs editor might attach; preventDefault stops the
    // browser's default focus-out behaviour. Bounces at table edges
    // (auto-append row on Tab from the last cell is a P4 affordance).
    // The listener lives on the container DOM node, which `finishEditMode`
    // detaches via `tb.detach()` — once detached the node is GC'd along
    // with its listener, so no explicit teardown is needed here.
    if (target.kind === 'cell' && target.cell) {
      const startCell = target.cell;
      // Cache the docs editor's current cursor position so the
      // ArrowLeft / ArrowRight boundary check below can decide
      // synchronously (before the docs editor processes the
      // keystroke) whether the caret is at the very start / end of
      // the cell body. `onCursorMove` fires after every typing,
      // click, and programmatic-move so the cache stays current.
      let cursorPos: { blockId: string; offset: number } | null = null;
      tb.onCursorMove((pos) => {
        cursorPos = pos;
      });

      const cellBodyBoundary = (): {
        atStart: boolean;
        atEnd: boolean;
      } => {
        if (cursorPos === null) return { atStart: false, atEnd: false };
        // Read the LIVE block list from the store, not the edit-entry
        // snapshot — the docs editor writes blocks back per keystroke,
        // so `target.blocks` becomes stale the moment the user types.
        // Without this lookup the boundary check fires on the wrong
        // offsets and ArrowRight at "hello"'s end (offset 5) misses
        // while ArrowRight at offset 0 falsely jumps to the next cell.
        const liveDoc = this.options.store.read();
        const liveSlide = liveDoc.slides.find((s) => s.id === slideId);
        const liveEl =
          liveSlide && findElement(liveSlide.elements, elementId);
        if (!liveEl || liveEl.type !== 'table') {
          return { atStart: false, atEnd: false };
        }
        const liveCell =
          liveEl.data.rows[startCell.row]?.cells[startCell.col];
        const cellBlocks = liveCell?.body?.blocks ?? [];
        if (cellBlocks.length === 0) {
          return { atStart: true, atEnd: true };
        }
        const first = cellBlocks[0];
        const last = cellBlocks[cellBlocks.length - 1];
        const lastLen = last.inlines.reduce(
          (s, inl) => s + inl.text.length,
          0,
        );
        return {
          atStart: cursorPos.blockId === first.id && cursorPos.offset === 0,
          atEnd: cursorPos.blockId === last.id && cursorPos.offset === lastLen,
        };
      };

      tb.container.addEventListener(
        'keydown',
        (e: KeyboardEvent) => {
          // ArrowLeft / ArrowRight at the cell-body boundary jumps
          // to the previous / next cell. Inside the body the docs
          // editor handles the arrow normally; the boundary check
          // bypasses preventDefault so character-by-character
          // navigation inside text keeps working.
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            const direction: 1 | -1 = e.key === 'ArrowRight' ? 1 : -1;
            const { atStart, atEnd } = cellBodyBoundary();
            const atBoundary = direction === 1 ? atEnd : atStart;
            if (!atBoundary) return;
            const liveDoc = this.options.store.read();
            const liveSlide = liveDoc.slides.find((s) => s.id === slideId);
            if (!liveSlide) return;
            const liveEl = findElement(liveSlide.elements, elementId);
            if (!liveEl || liveEl.type !== 'table') return;
            const next = nextCellInDirection(
              liveEl.data,
              startCell.row,
              startCell.col,
              direction,
            );
            if (next === null) return; // let the docs editor handle it (bounce)
            e.preventDefault();
            e.stopPropagation();
            this.enterEditMode(slideId, elementId, { cell: next });
            return;
          }
          if (e.key !== 'Tab') return;
          // Re-read the table from the store: a peer (or undo / redo)
          // could have mutated rows / cells while the user was typing.
          const liveDoc = this.options.store.read();
          const liveSlide = liveDoc.slides.find((s) => s.id === slideId);
          if (!liveSlide) return;
          const liveEl = findElement(liveSlide.elements, elementId);
          if (!liveEl || liveEl.type !== 'table') return;
          const direction: 1 | -1 = e.shiftKey ? -1 : 1;
          const next = nextCellInDirection(
            liveEl.data,
            startCell.row,
            startCell.col,
            direction,
          );
          // Suppress the default tab-out / tab-insert regardless of
          // outcome so the user never falls out of the table by
          // accident.
          e.preventDefault();
          e.stopPropagation();
          if (next !== null) {
            this.enterEditMode(slideId, elementId, { cell: next });
            return;
          }
          // Tab past the last cell appends a new row and enters its
          // first cell — Google Sheets / PowerPoint convention. The
          // insert + enter share one logical user action; calling
          // enterEditMode here triggers the existing auto-commit at
          // the top of enterEditMode, but the row insert needs its
          // own batch first so the new cell exists when we enter it.
          if (direction === 1) {
            const newRowIndex = liveEl.data.rows.length;
            this.options.store.batch(() => {
              this.options.store.insertTableRow(
                slideId,
                elementId,
                newRowIndex,
              );
            });
            this.enterEditMode(slideId, elementId, {
              cell: { row: newRowIndex, col: 0 },
            });
          }
          // Shift+Tab past the first cell bounces — no equivalent
          // "prepend row" UX in PowerPoint / Google Slides.
        },
        { capture: true },
      );
    }
    // Focus so keystrokes flow into the textarea immediately.
    tb.focus();
  }

  /**
   * Trigger commit (or no-op) and then tear the text-box down. Safe to
   * call when no text-box is mounted.
   */
  private exitEditMode(reason: 'commit' | 'cancel'): void {
    const tb = this.editingTextBox;
    if (tb === null) return;
    if (reason === 'commit') {
      tb.commit();
    }
    // commit() above synchronously blurs the textarea, which routes
    // through onCommit → finishEditMode. If reason === 'cancel' we
    // detach without committing. finishEditMode is idempotent in
    // either case.
    if (reason === 'cancel') {
      this.finishEditMode();
    }
  }

  /**
   * Compute the col-resize / row-resize cursor for a selected table
   * whose interior column or row border is under the pointer. Returns
   * `null` when the selection isn't a top-level non-rotated table, the
   * pointer is outside the table, or it's not within tolerance of any
   * interior border.
   */
  private computeTableEdgeCursor(
    clientX: number,
    clientY: number,
  ): string | null {
    const slide = this.currentSlide();
    if (!slide) return null;
    const ids = this.selection.get();
    if (ids.length !== 1) return null;
    const table = findElement(slide.elements, ids[0]);
    if (!table || table.type !== 'table') return null;
    if (table.frame.rotation !== 0) return null;
    if (!slide.elements.some((el) => el.id === table.id)) return null;
    const { x, y } = this.clientToLogical(clientX, clientY);
    const layout = computeTableLayout(table.data, {
      fontScale: deckFontScale(this.options.store.read().meta),
    });
    // The hover tolerance in slide-logical coords is 4 host-pixels
    // divided by the current zoom — keeps the grab band the same
    // visual thickness regardless of zoom level.
    const tolPx = 4;
    const localX = x - table.frame.x;
    const localY = y - table.frame.y;
    const edge = tableEdgeAt(layout, localX, localY, tolPx / this.scale());
    if (edge === null) return null;
    return edge.kind === 'col' ? 'col-resize' : 'row-resize';
  }

  /**
   * Start a column / row border drag-resize. The gesture lives outside
   * the standard element-drag flow so the table's columnWidths /
   * rowHeights are the only things mutated — frame.w / frame.h follow
   * via the store op's `sum(columnWidths)` / `sum(rowH)` recalc, and
   * the merge-aware redistribution in `computeTableLayout` keeps cell
   * paints honouring the new sizes.
   *
   * No store writes during the drag itself; the overlay paints a
   * magenta guide line at the proposed border position and the final
   * widths / heights commit on pointerup in one batch (one undo entry
   * per gesture).
   */
  private startTableEdgeResize(
    e: PointerEvent,
    table: TableElement,
    edge: { kind: 'col' | 'row'; index: number; position: number },
  ): void {
    const slideId = this.currentSlide()?.id;
    if (slideId === undefined) return;
    const store = this.options.store;
    const tableId = table.id;
    const kind = edge.kind;
    const idx = edge.index;
    const originalWidths = [...table.data.columnWidths];
    const originalHeights = table.data.rows.map((r) => r.height);
    // Anchor the gesture at the pointerdown logical position so a
    // single dx / dy can compute the new boundary regardless of
    // intermediate move events. Track the pointer offset from the
    // true edge — the hit-test allows a 4-px grab tolerance so the
    // user can pointerdown a few pixels off-edge. Without this delta
    // a no-move release would commit a 1–4 px resize equal to the
    // off-edge grab offset.
    const start = this.clientToLogical(e.clientX, e.clientY);
    const startLocalX = start.x - table.frame.x;
    const startLocalY = start.y - table.frame.y;
    const grabDelta =
      kind === 'col' ? startLocalX - edge.position : startLocalY - edge.position;
    const MIN_CELL = 10;

    const clampPosition = (proposed: number): number => {
      if (kind === 'col') {
        const leftMin = sumPrefix(originalWidths, idx - 1) + MIN_CELL;
        const rightMax =
          sumPrefix(originalWidths, idx + 1) - MIN_CELL;
        return Math.max(leftMin, Math.min(rightMax, proposed));
      }
      const topMin = sumPrefix(originalHeights, idx - 1) + MIN_CELL;
      const bottomMax = sumPrefix(originalHeights, idx + 1) - MIN_CELL;
      return Math.max(topMin, Math.min(bottomMax, proposed));
    };

    // Initial preview at the edge's true position so a no-move
    // release commits no change. The pointermove handler subtracts
    // grabDelta to keep the gesture stable even when the user
    // pointerdown'd off-edge.
    this.pendingTableResize = {
      tableId,
      kind,
      index: idx,
      position: clampPosition(edge.position),
    };
    this.repaintOverlay();
    // While the gesture is live, lock the cursor — pointermove
    // fires on document with no chance for the hover logic to
    // reassert col/row-resize.
    document.body.style.cursor = kind === 'col' ? 'col-resize' : 'row-resize';

    const onMove = (ev: PointerEvent): void => {
      const cur = this.clientToLogical(ev.clientX, ev.clientY);
      const localX = cur.x - table.frame.x;
      const localY = cur.y - table.frame.y;
      const proposed = (kind === 'col' ? localX : localY) - grabDelta;
      const clamped = clampPosition(proposed);
      if (this.pendingTableResize?.position === clamped) return;
      this.pendingTableResize = {
        tableId,
        kind,
        index: idx,
        position: clamped,
      };
      this.repaintOverlay();
    };
    const finish = (commit: boolean): void => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onCancel, true);
      document.body.style.cursor = '';
      const pending = this.pendingTableResize;
      this.pendingTableResize = null;
      if (commit && pending !== null) {
        if (pending.kind === 'col') {
          const left = pending.position - sumPrefix(originalWidths, idx - 1);
          const right =
            sumPrefix(originalWidths, idx + 1) - pending.position;
          const next = [...originalWidths];
          next[idx - 1] = left;
          next[idx] = right;
          store.batch(() => {
            store.updateTableColumnWidths(slideId, tableId, next);
          });
        } else {
          const top = pending.position - sumPrefix(originalHeights, idx - 1);
          const bottom =
            sumPrefix(originalHeights, idx + 1) - pending.position;
          const next = [...originalHeights];
          next[idx - 1] = top;
          next[idx] = bottom;
          store.batch(() => {
            store.updateTableRowHeights(slideId, tableId, next);
          });
        }
        // The store mutation alone doesn't repaint the canvas — the
        // overlay's preview rect is cleared by `repaintOverlay`
        // below, but the column / row commit needs a fresh canvas
        // pass for the new widths / heights to take effect. Without
        // this the table stays visually frozen at the pre-resize
        // state until some unrelated event triggers a repaint.
        this.renderer.markDirty();
        this.render();
      }
      this.repaintOverlay();
    };
    const onUp = (): void => finish(true);
    const onCancel = (): void => finish(false);
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onCancel, true);
  }

  /**
   * Arm a drag-to-extend gesture: pointermove updates `cellSelection.r1/c1`
   * to the cell under the pointer; pointerup / pointercancel tears the
   * listeners down. Anchor (`r0`, `c0`) stays fixed at the pointerdown
   * cell — matches Google Sheets / PowerPoint range-select.
   *
   * No commit step is needed because `cellSelection` is editor-local
   * state (not persisted to the store). Layout is captured at gesture
   * start so the drag uses one consistent grid even if the table
   * auto-grows mid-drag.
   */
  private startCellRangeDrag(
    table: TableElement,
    layout: TableLayout,
  ): void {
    const tableId = table.id;
    const data = table.data;
    const frame = table.frame;
    let lastCell: { row: number; col: number } | null = this.cellSelection
      ? { row: this.cellSelection.r1, col: this.cellSelection.c1 }
      : null;
    const onMove = (ev: PointerEvent): void => {
      if (
        this.cellSelection === null ||
        this.cellSelection.tableId !== tableId
      ) {
        teardown();
        return;
      }
      const { x: lx, y: ly } = this.clientToLogical(ev.clientX, ev.clientY);
      // Clamp the pointer-in-table coords to the table's painted
      // bounds so dragging past the edge just selects the last cell
      // in that direction (rather than returning null and freezing
      // the range mid-stream).
      const localX = lx - frame.x;
      const localY = ly - frame.y;
      const maxX = layout.colX[layout.colX.length - 1] - 0.5;
      const maxY = layout.rowY[layout.rowY.length - 1] - 0.5;
      const clampedX = Math.max(0, Math.min(localX, maxX));
      const clampedY = Math.max(0, Math.min(localY, maxY));
      const cell = tableCellAtPoint(data, layout, clampedX, clampedY);
      if (cell === null) return;
      // Coalesce same-cell moves so we don't repaint the overlay 60×/s
      // when the pointer wiggles inside one cell rect.
      if (
        lastCell !== null &&
        cell.row === lastCell.row &&
        cell.col === lastCell.col
      ) {
        return;
      }
      lastCell = cell;
      this.setCellSelection({
        ...this.cellSelection,
        r1: cell.row,
        c1: cell.col,
      });
      this.repaintOverlay();
    };
    const teardown = (): void => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', teardown, true);
      document.removeEventListener('pointercancel', teardown, true);
    };
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', teardown, true);
    document.addEventListener('pointercancel', teardown, true);
  }

  private finishEditMode(): void {
    const tb = this.editingTextBox;
    this.editingTextBox = null;
    this.editingElementId = null;
    this.editingCellCoords = null;
    this.lastEditingContentHeight = null;
    this.editingGrowApplicable = false;
    this.activeTextEditor = null;
    for (const cb of this.textEditingListeners) cb();
    if (tb !== null) {
      tb.detach();
    }
    this.renderer.markDirty();
    this.render();
    this.repaintOverlay();
  }

  /**
   * Update the hover-ghost position as the cursor moves over the slide
   * canvas. No-op when not in shape-insert mode, when text-insert is
   * armed (text drag-inserts but an empty box paints no useful ghost),
   * or while a drag-to-size insert is already in flight (the live
   * drag preview from `startInsert` takes over rendering).
   */
  private onInsertHoverMove(e: MouseEvent): void {
    const kind = this.insertKind;
    // Freeform has no fixed-size ghost — the scribble preview is driven
    // by the live capture in `startScribbleInsert`, not a hover preview.
    if (kind === null || kind === 'text' || kind === 'freeform') return;
    // Connector insert modes: no shape-style hover ghost, but DO drive
    // the Task 13 connection-points affordance so the user sees where
    // their connector will attach before they even click. The live
    // drag preview takes over rendering after mousedown.
    if (isConnectorInsertKind(kind)) {
      if (this.editingElementId !== null) return;
      if (this.insertDragging) return;
      this.connectorCursor = this.clientToLogical(e.clientX, e.clientY);
      this.repaintOverlay();
      return;
    }
    if (this.editingElementId !== null) return;
    if (this.insertDragging) return;
    const { x, y } = this.clientToLogical(e.clientX, e.clientY);
    this.hoverPreview = { kind, x, y };
    if (this.hoverRenderRaf !== null) return;
    this.hoverRenderRaf = requestAnimationFrame(() => {
      this.hoverRenderRaf = null;
      this.paintWithHoverGhost();
    });
  }

  /**
   * Drag-affordance cursor. On `pointermove` over the canvas, if the
   * pointer is a mouse and we're idle (no insert mode, no text edit, no
   * handle hit), set `cursor: move` whenever the pointer is inside the
   * bbox of any selected element. Otherwise restore the default.
   *
   * Cached against `lastHoverCursor` so we only touch the DOM when the
   * value actually changes — `pointermove` fires at frame rate and
   * writing identical strings to `style.cursor` is wasted work.
   */
  private onSelectionHoverMove(e: PointerEvent): void {
    if (e.pointerType !== undefined && e.pointerType !== 'mouse') return;
    // A pointer-down gesture is active (lasso / move / resize / rotate /
    // connector / insert). `onPointerDown` cleared the hover; we keep it
    // clear here so the canvas-level pointermove that fires alongside
    // each document-level drag listener does not re-pick a hover target
    // mid-gesture.
    if (this.pointerInteractionActive) return;
    if (this.insertKind !== null) {
      this.clearHoverHighlight();
      return;
    }
    if (this.editingElementId !== null) {
      this.clearHoverHighlight();
      return;
    }
    if (this.handleAtClient(e.clientX, e.clientY) !== null) {
      this.clearHoverHighlight();
      return;
    }

    const slide = this.currentSlide();
    let desired = '';
    let nextHighlightId: string | null = null;

    // Table interior border (col/row resize) wins over both the outer
    // bbox edge cursor and the move cursor — the user is mousing over
    // a draggable border that lives inside the table's frame, and
    // showing "move" here would suggest the wrong gesture.
    const tableEdgeCursor =
      this.selection.get().length === 1
        ? this.computeTableEdgeCursor(e.clientX, e.clientY)
        : null;
    if (tableEdgeCursor !== null) {
      desired = tableEdgeCursor;
    } else {
    // P2.7 — edge-zone resize cursor wins over text-region / move /
    // idle-hover when the pointer is within 4 px of the selected
    // element's bbox edge (inside OR outside the bbox). The handle hit
    // above already wins over this; non-rotated single-selection only.
    // See docs/design/slides/slides-hover-and-text-edit-entry.md § P2.7.
    //
    // Cheap gate before the expensive resolve: the common idle case
    // (no/multi selection) skips the findElement + toWorldFrame walk
    // by failing this conjunct first. pointermove fires at 60–120 Hz
    // so this matters on deeply-nested grouped slides.
    const edgeCursor = this.selection.get().length === 1
      ? this.computeEdgeZoneCursor(e.clientX, e.clientY)
      : null;
    if (edgeCursor !== null) {
      desired = edgeCursor;
    } else if (this.isPointerOverSelected(e.clientX, e.clientY)) {
      desired = this.computeSelectedHoverCursor(e.clientX, e.clientY);
    } else {
      const { x, y } = this.clientToLogical(e.clientX, e.clientY);
      const guide = hitTestGuide(this.options.store.read().guides, { x, y });
      if (guide !== null) {
        desired = guide.axis === 'x' ? 'col-resize' : 'row-resize';
      } else if (slide) {
        // Idle hover: highlight the topmost unselected hit element in
        // the current selection scope.
        const hit = hitTestSlide(slide, x, y, this.hitOptions());
        if (hit !== null) {
          const scopeId = pickScopeId(hit, this.selection.getScope());
          if (scopeId !== null && !this.selection.get().includes(scopeId)) {
            nextHighlightId = scopeId;
          }
        }
      }
    }
    }

    this.setHoverHighlight(nextHighlightId);
    if (this.lastHoverCursor === desired) return;
    this.lastHoverCursor = desired;
    this.options.canvas.style.cursor = desired;
  }

  private setHoverHighlight(next: string | null): void {
    if (this.hoverHighlightId === next) return;
    this.hoverHighlightId = next;
    this.repaintOverlay();
  }

  private clearHoverHighlight(): void {
    this.setHoverHighlight(null);
  }

  /**
   * Resolve the (slide, element, world-space frame, logical pointer
   * coords) tuple for the single currently-selected element. Returns
   * `null` whenever the caller's predicates wouldn't apply: no slide,
   * not exactly one selected, or `findElement` came up empty. Centralised
   * here so the P1.5 slow-double-click entry, the P2.7 edge-zone cursor,
   * and the text-region hover cursor share one resolution path —
   * keeping their geometric inputs in lockstep when the model changes
   * (drilled-in scope transforms, grouped descendants, etc.).
   */
  private resolveSingleSelectedWorldContext(
    clientX: number,
    clientY: number,
  ): {
    slide: ReturnType<SlidesEditorImpl['currentSlide']>;
    el: Element;
    worldFrame: Frame;
    x: number;
    y: number;
  } | null {
    const slide = this.currentSlide();
    if (!slide) return null;
    const selectedIds = this.selection.get();
    if (selectedIds.length !== 1) return null;
    const el = findElement(slide.elements, selectedIds[0]);
    if (!el) return null;
    const scope = this.selection.getScope();
    const worldFrame = toWorldFrame(el.frame, scope, slide);
    const { x, y } = this.clientToLogical(clientX, clientY);
    return { slide, el, worldFrame, x, y };
  }

  /**
   * Drives the P1.5 slow-double-click entry. Returns true when the
   * pointer-up landed inside the selected element's editable region AND
   * the selection is a single text-capable element — in which case it
   * enters edit mode and the caller should treat the pointer cycle as
   * consumed.
   *
   * Editable region resolution:
   * - Text elements use `getTextRegionRect` (frame inset by the same
   *   visual padding the hover I-beam cursor uses).
   * - Shapes WITH a text body: same.
   * - Shapes WITHOUT a text body (freshly inserted, never edited): fall
   *   back to the shape's `SHAPE_TEXT_PADDING`-inset frame. Otherwise
   *   `getTextRegionRect` would return null and P1.5 would silently
   *   no-op on shapes the user can clearly enter via dblclick — those
   *   shapes are still editable; `buildEditTarget` seeds an empty
   *   paragraph on first commit.
   */
  private tryEnterEditFromSlowDoubleClick(
    clientX: number,
    clientY: number,
  ): boolean {
    const ctx = this.resolveSingleSelectedWorldContext(clientX, clientY);
    if (!ctx) return false;
    const { slide, el, worldFrame, x, y } = ctx;
    if (el.type !== 'text' && el.type !== 'shape') return false;
    let region = getTextRegionRect(el, worldFrame);
    if (region === null && el.type === 'shape') {
      // Mirror `buildEditTarget` (4154): the editable area for shape
      // inline text is the world frame inset by `SHAPE_TEXT_PADDING`.
      region = {
        x: worldFrame.x + SHAPE_TEXT_PADDING.x,
        y: worldFrame.y + SHAPE_TEXT_PADDING.y,
        w: Math.max(0, worldFrame.w - 2 * SHAPE_TEXT_PADDING.x),
        h: Math.max(0, worldFrame.h - 2 * SHAPE_TEXT_PADDING.y),
      };
    }
    if (region === null) return false;
    if (region.w === 0 || region.h === 0) return false;
    if (!isPointInRect(x, y, region)) return false;
    if (slide) this.enterEditMode(slide.id, el.id);
    return true;
  }

  /**
   * P2.7 — resolve the resize cursor for the edge zone around the single
   * selected element. Returns `null` when the gate fails (multi-select,
   * rotated past the cap, or pointer outside the extended bbox) so the
   * caller falls back to text-region / move / idle-hover handling.
   * Caller is responsible for the cheap "is exactly one selected"
   * pre-check (see `onSelectionHoverMove`) so the common idle/multi
   * cases don't pay for `findElement` + `toWorldFrame`.
   */
  private computeEdgeZoneCursor(
    clientX: number,
    clientY: number,
  ): string | null {
    const ctx = this.resolveSingleSelectedWorldContext(clientX, clientY);
    if (!ctx) return null;
    const { el, worldFrame, x, y } = ctx;
    // Connectors are line-like and have a derived bbox; edge-zone here
    // would mislead because endpoints (not bbox edges) drive resize.
    if (el.type === 'connector') return null;
    const zone = edgeZoneAt(x, y, worldFrame);
    if (zone === null) return null;
    return edgeZoneCursor(zone);
  }

  private computeSelectedHoverCursor(clientX: number, clientY: number): string {
    const ctx = this.resolveSingleSelectedWorldContext(clientX, clientY);
    // Region-aware cursor only applies to a single selection. Multi-select
    // (and missing slide) stay 'move' because there is no unambiguous
    // element to enter.
    if (!ctx) return 'move';
    const { el, worldFrame, x, y } = ctx;
    const region = getTextRegionRect(el, worldFrame);
    if (!region) return 'move';
    return isPointInRect(x, y, region) ? 'text' : 'move';
  }

  private isPointerOverSelected(clientX: number, clientY: number): boolean {
    const slide = this.currentSlide();
    if (!slide) return false;
    const selectedIds = this.selection.get();
    if (selectedIds.length === 0) return false;
    const scope = this.selection.getScope();
    const { x, y } = this.clientToLogical(clientX, clientY);
    // Hit-test against world frames so drilled-in selections (elements
    // inside a group) also flip the cursor — `slide.elements` is the
    // top-level tree, so a raw walk would miss grouped descendants.
    for (const id of selectedIds) {
      const el = findElement(slide.elements, id);
      if (!el) continue;
      const worldFrame = toWorldFrame(el.frame, scope, slide);
      if (containsPoint(worldFrame, x, y)) return true;
    }
    return false;
  }

  /** Cursor left the canvas — drop the ghost and repaint cleanly. */
  private onInsertHoverLeave(): void {
    // Drop the idle hover highlight when the cursor exits the canvas.
    this.clearHoverHighlight();
    // Drop the connector affordance dots when the cursor exits the
    // canvas. Repaint runs unconditionally below if either the shape
    // ghost or the connector cursor was active.
    const hadConnectorCursor = this.connectorCursor !== null;
    if (
      hadConnectorCursor &&
      !this.insertDragging &&
      !this.endpointDragging
    ) {
      this.connectorCursor = null;
      this.repaintOverlay();
    }
    if (this.hoverPreview === null) return;
    this.hoverPreview = null;
    if (this.hoverRenderRaf !== null) {
      cancelAnimationFrame(this.hoverRenderRaf);
      this.hoverRenderRaf = null;
    }
    this.renderer.markDirty();
    this.render();
  }

  /**
   * Paint the committed slide + the hover ghost on top at
   * `GHOST_ALPHA`. Keeps the slide's own elements untouched so the
   * ghost can never participate in selection or hit-test.
   */
  private paintWithHoverGhost(): void {
    const slide = this.currentSlide();
    if (!slide || this.hoverPreview === null) return;
    const init = buildInsertElement(
      this.hoverPreview.kind,
      { x: this.hoverPreview.x, y: this.hoverPreview.y },
      { x: this.hoverPreview.x, y: this.hoverPreview.y },
    );
    const ghost = { ...init, id: '__hover_preview__' } as Element;
    this.renderer.forceRender(slide, this.options.store.read(), [ghost]);
  }

  private startInsert(clientX: number, clientY: number): void {
    const kind = this.insertKind;
    if (kind === null) return;
    const slide = this.currentSlide();
    if (!slide) return;
    const start = this.clientToLogical(clientX, clientY);

    if (kind === 'text') {
      // Drag-to-size like shapes, but without a ghost preview (an empty
      // text box paints nothing). On release, place the box and drop the
      // caret straight inside it — matching Google Slides.
      this.insertDragging = true;
      this.hoverPreview = null;
      let endPoint = start;
      let cancelled = false;
      const onMove = (ev: MouseEvent): void => {
        endPoint = this.clientToLogical(ev.clientX, ev.clientY);
      };
      const cleanup = (): void => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('keydown', onKey, true);
        this.insertDragging = false;
      };
      const onUp = (): void => {
        cleanup();
        if (cancelled) return;
        const init = buildInsertElement('text', start, endPoint);
        let id = '';
        this.options.store.batch(() => {
          id = this.options.store.addElement(slide.id, init);
          this.selection.set([id]);
        });
        this.setInsertMode(null);
        // enterEditMode mounts the docs text-box, repaints, and focuses.
        this.enterEditMode(slide.id, id);
      };
      const onKey = (ev: KeyboardEvent): void => {
        if (ev.key !== 'Escape') return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        cancelled = true;
        cleanup();
        this.setInsertMode(null);
        this.renderer.markDirty();
        this.render();
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('keydown', onKey, true);
      return;
    }

    if (isConnectorInsertKind(kind)) {
      this.startConnectorInsert(kind, slide, start);
      return;
    }

    if (kind === 'freeform') {
      this.startScribbleInsert(slide, start);
      return;
    }

    // Drag-to-size for shapes. Mark insertDragging so the hover-ghost
    // listener stops repainting; the drag preview below owns the
    // canvas until mouseup. The preview is rendered through the same
    // `forceRender(slide, doc, [ghost])` channel as the hover ghost so
    // the in-progress shape stays semi-transparent — the user can see
    // any underlying content while sizing, and the commit on mouseup
    // is the moment the shape goes opaque.
    this.insertDragging = true;
    this.hoverPreview = null;
    let endPoint = start;
    let cancelled = false;
    const onMove = (ev: MouseEvent) => {
      const raw = this.clientToLogical(ev.clientX, ev.clientY);
      endPoint = ev.shiftKey ? constrainToSquare(start, raw) : raw;
      const init = buildInsertElement(kind, start, endPoint);
      const ghost = { ...init, id: '__preview__' } as Element;
      this.renderer.forceRender(slide, this.options.store.read(), [ghost]);
    };
    const cleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('keydown', onKey, true);
      this.insertDragging = false;
    };
    const onUp = () => {
      cleanup();
      if (cancelled) return; // ESC pressed mid-drag — discard.
      // buildInsertElement handles the click-vs-drag distinction: if
      // the pointer barely moved, it returns a per-kind default-sized
      // frame anchored at `start`; otherwise it uses the drag rect.
      const init = buildInsertElement(kind, start, endPoint);
      this.options.store.batch(() => {
        const id = this.options.store.addElement(slide.id, init);
        this.selection.set([id]);
      });
      this.setInsertMode(null);
      this.renderer.markDirty();
      this.render();
    };
    // ESC during a drag aborts the in-flight insert without committing
    // anything. We listen with `capture: true` and stopImmediatePropagation
    // so the editor's own keyrules (which would otherwise also disarm
    // insert mode via `setInsertMode(null)`) don't double-fire — the
    // drag handler owns the cancel here. After cleanup we still
    // disarm insert mode so the user lands in select mode with the
    // canvas clean.
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      cancelled = true;
      cleanup();
      this.setInsertMode(null);
      this.renderer.markDirty();
      this.render();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('keydown', onKey, true);
  }

  /**
   * Drag-to-place flow for connectors. Mirrors `startInsert`'s shape
   * branch: live ghost preview during the drag (rendered via the same
   * `forceRender(slide, doc, [ghost])` channel), commit on mouseup,
   * ESC cancels with capture-phase pre-emption so the keyboard rule's
   * own `setInsertMode(null)` Esc handler doesn't double-fire.
   *
   * Sub-threshold drags (`< MIN_DRAG_DISTANCE`) are discarded by
   * `finalizeConnectorInsert` returning null; we still disarm insert
   * mode afterwards so a stray click leaves the editor in select mode
   * rather than stuck in connector-arm.
   */
  private startConnectorInsert(
    kind: ConnectorInsertKind,
    slide: Slide,
    start: { x: number; y: number },
  ): void {
    const variant = connectorVariant(kind);
    this.insertDragging = true;
    this.hoverPreview = null;
    let endPoint = start;
    let cancelled = false;
    // Drive the Task 13 connection-points affordance throughout the
    // drag. The cursor at mousedown seeds the dots so they appear on
    // the very first paint, before any mousemove.
    this.connectorCursor = start;
    const onMove = (ev: MouseEvent) => {
      const raw = this.clientToLogical(ev.clientX, ev.clientY);
      endPoint = ev.shiftKey ? snapEndpointAngle(start, raw) : raw;
      this.connectorCursor = endPoint;
      const init = buildConnectorInit(variant, start, endPoint, slide.elements, this.scale());
      const ghost = { ...init, id: '__preview__' } as Element;
      this.renderer.forceRender(slide, this.options.store.read(), [ghost]);
      // Repaint the overlay so the connection-points dots track the
      // cursor. The forceRender above paints the canvas; the overlay
      // is a separate DOM layer and needs its own update.
      this.repaintOverlay();
    };
    const cleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('keydown', onKey, true);
      this.insertDragging = false;
      // Clear the affordance cursor on drag end; the surrounding
      // tool-armed hover plumbing will refill it on the next mousemove
      // if the user is still in connector mode.
      this.connectorCursor = null;
    };
    const onUp = () => {
      cleanup();
      if (cancelled) return; // ESC pressed mid-drag — discard.
      // `finalizeConnectorInsert` owns its own `store.batch(...)` so that a
      // sub-threshold drag (< MIN_DRAG_DISTANCE) skips the batch entirely
      // and doesn't pollute the undo stack with an empty snapshot.
      const newId = finalizeConnectorInsert(
        this.options.store,
        slide.id,
        variant,
        start,
        endPoint,
        slide.elements,
        this.scale(),
      );
      if (newId !== null) this.selection.set([newId]);
      this.setInsertMode(null);
      this.renderer.markDirty();
      this.render();
      this.repaintOverlay();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      cancelled = true;
      cleanup();
      this.setInsertMode(null);
      this.renderer.markDirty();
      this.render();
      // `cleanup` cleared the affordance cursor; explicitly rebuild
      // the overlay so the connection-point dots painted on the last
      // mousemove vanish (otherwise they linger until the next
      // overlay repaint).
      this.repaintOverlay();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('keydown', onKey, true);
  }

  /**
   * Freehand-scribble flow for the `'freeform'` insert kind. Captures
   * pointer positions from mousedown to mouseup, paints a live ghost of
   * the in-progress polyline through the same `forceRender` channel as
   * the shape/connector previews, and commits a stroke-only freeform
   * ShapeElement on release. ESC cancels (capture-phase pre-emption so
   * the editor's own Esc keyrule doesn't also fire).
   *
   * Points are decimated by a small distance threshold so a slow drag
   * doesn't accumulate hundreds of near-duplicate vertices in the
   * stored path.
   */
  private startScribbleInsert(
    slide: Slide,
    start: { x: number; y: number },
  ): void {
    this.insertDragging = true;
    this.hoverPreview = null;
    const points: { x: number; y: number }[] = [start];
    let cancelled = false;
    // Square of the minimum logical distance between retained points.
    const MIN_POINT_DISTANCE_SQ = 4;
    const onMove = (ev: MouseEvent) => {
      const p = this.clientToLogical(ev.clientX, ev.clientY);
      const last = points[points.length - 1];
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      if (dx * dx + dy * dy < MIN_POINT_DISTANCE_SQ) return;
      points.push(p);
      const init = buildFreeformInit(points);
      if (!init) return;
      const ghost = { ...init, id: '__preview__' } as Element;
      this.renderer.forceRender(slide, this.options.store.read(), [ghost]);
    };
    const cleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('keydown', onKey, true);
      this.insertDragging = false;
    };
    const onUp = () => {
      cleanup();
      if (cancelled) return; // ESC pressed mid-draw — discard.
      const init = buildFreeformInit(points);
      if (init) {
        this.options.store.batch(() => {
          const id = this.options.store.addElement(slide.id, init);
          this.selection.set([id]);
        });
      }
      this.setInsertMode(null);
      this.renderer.markDirty();
      this.render();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      cancelled = true;
      cleanup();
      this.setInsertMode(null);
      this.renderer.markDirty();
      this.render();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('keydown', onKey, true);
  }

  private startLasso(clientX: number, clientY: number): void {
    const rectEl = document.createElement('div');
    rectEl.style.position = 'absolute';
    rectEl.style.border = '1px dashed #3a7';
    rectEl.style.background = 'rgba(58, 168, 119, 0.1)';
    rectEl.style.pointerEvents = 'none';
    this.options.overlay.appendChild(rectEl);

    const start = this.clientToLogical(clientX, clientY);
    const onMove = (ev: MouseEvent) => {
      const cur = this.clientToLogical(ev.clientX, ev.clientY);
      const rect = normalizeRect(start.x, start.y, cur.x, cur.y);
      const scale = this.scale();
      rectEl.style.left = `${rect.x * scale}px`;
      rectEl.style.top = `${rect.y * scale}px`;
      rectEl.style.width = `${rect.w * scale}px`;
      rectEl.style.height = `${rect.h * scale}px`;
    };
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      rectEl.remove();
      const cur = this.clientToLogical(ev.clientX, ev.clientY);
      const rect = normalizeRect(start.x, start.y, cur.x, cur.y);
      const slide = this.currentSlide();
      if (!slide) return;
      if (rect.w < 2 && rect.h < 2) {
        // A click without drag — treat as empty-canvas click → clear.
        this.selection.clear();
        return;
      }
      this.selection.set(selectInRect(slide, rect));
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  private startDrag(
    clientX: number,
    clientY: number,
    downTimeMs: number,
    slowDoubleClickEligible: boolean,
  ): void {
    const startSlide = this.currentSlide();
    if (!startSlide) return;
    const scope = this.selection.getScope();
    const selectedIds = new Set(this.selection.get());

    // Capture each selected element's frame in WORLD coordinates and
    // the element snapshot itself. The world-frame map drives snap math
    // and ghost placement; the element map is needed at commit time
    // because connectors translate through their endpoints, not their
    // frame — `commitTranslate` reads `el.start`/`el.end` from the
    // pre-drag snapshot.
    const originalWorldFrames = new Map<string, Frame>();
    const originals = new Map<string, Element>();
    for (const id of selectedIds) {
      const el = findElement(startSlide.elements, id);
      if (!el) continue;
      originalWorldFrames.set(id, toWorldFrame(el.frame, scope, startSlide));
      originals.set(id, el);
    }
    if (originalWorldFrames.size === 0) return;

    const start = this.clientToLogical(clientX, clientY);
    // Collect snap candidates within the active scope, excluding the
    // dragged elements. Each candidate is an axis-aligned AABB so
    // rotated shapes/groups snap against their visible bbox.
    const otherFrames = collectSnapCandidates(startSlide, [...scope], selectedIds);

    // Needed when a ghost connector's attached endpoint targets a
    // dragged shape: the ghost line must follow the ghost shape's
    // connection site, not snap back to the original.
    const slideLookup = buildElementWorldLookup(startSlide.elements);

    let liveDx = 0;
    let liveDy = 0;
    // Peak raw client-px distance reached during this gesture. Used to
    // disqualify P1.5 entry when the user moved past the threshold even
    // briefly and then returned to within 3 px of the start point (e.g.
    // a deliberate drag-and-cancel, snap-back to original). Without this
    // a "moved 30 px then back" gesture would be misclassified as a
    // tight tap-and-release and silently enter edit mode.
    let peakRawClientDist = 0;

    const onMove = (ev: MouseEvent) => {
      const dxClient = ev.clientX - clientX;
      const dyClient = ev.clientY - clientY;
      const d = Math.hypot(dxClient, dyClient);
      if (d > peakRawClientDist) peakRawClientDist = d;
      const cur = this.clientToLogical(ev.clientX, ev.clientY);
      const rawDx = cur.x - start.x;
      const rawDy = cur.y - start.y;
      const locked = ev.shiftKey ? lockAxis(rawDx, rawDy) : { dx: rawDx, dy: rawDy };
      const bbox = combinedBoundingBox(Array.from(originalWorldFrames.values()))!;
      const snapped = snapDelta(
        bbox,
        locked.dx,
        locked.dy,
        otherFrames,
        { w: SLIDE_WIDTH, h: SLIDE_HEIGHT },
        this.options.store.read().guides,
      );
      const smart = smartGuides(bbox, snapped.dx, snapped.dy, otherFrames);
      // Re-lock after snap + smart-guides: both evaluations run independently
      // on X and Y, so a sibling edge within the snap/align threshold of the
      // locked-zero axis would otherwise un-zero it and let Shift-drag drift
      // off axis. The lock has the final say.
      const final = ev.shiftKey ? lockAxis(smart.dx, smart.dy) : smart;
      const dx = final.dx;
      const dy = final.dy;
      const guides: (SnapGuide | SmartGuide)[] = [
        ...snapped.guides,
        ...smart.guides,
      ].filter((g) => {
        if (!ev.shiftKey) return true;
        // After lockAxis, one of dx/dy is zero. Drop guides on that axis.
        if (dx !== 0 && dy === 0) return g.axis === 'x';
        if (dy !== 0 && dx === 0) return g.axis === 'y';
        return true;
      });
      liveDx = dx;
      liveDy = dy;

      // Ghosts paint at WORLD coords on top of the unmodified slide
      // (which itself paints group-local frames through their group's
      // transform). Non-connectors translate their world frame.
      //
      // Connectors render via endpoint lookup against the underlying
      // slide elements, so we must materialize each endpoint into the
      // ghost itself rather than relying on the lookup:
      //  - `free` endpoint            → translate by (dx, dy).
      //  - `attached` to a dragged    → resolve to world coords and
      //    element                      translate by (dx, dy) so the
      //                                 ghost line meets the ghost
      //                                 shape's connection site.
      //  - `attached` to a non-dragged → keep as-is; the renderer
      //    element                      resolves it against the
      //                                 untouched slide, matching the
      //                                 commit-time behavior of
      //                                 `commitTranslate` (which only
      //                                 moves free endpoints).
      const ghostEndpoint = (ep: Endpoint): Endpoint => {
        if (ep.kind === 'free') {
          return { kind: 'free', x: ep.x + dx, y: ep.y + dy };
        }
        if (selectedIds.has(ep.elementId)) {
          const world = resolveEndpoint(ep, slideLookup);
          return { kind: 'free', x: world.x + dx, y: world.y + dy };
        }
        return ep;
      };

      const ghosts: Element[] = [];
      for (const el of originals.values()) {
        if (el.type === 'connector') {
          ghosts.push({
            ...el,
            start: ghostEndpoint(el.start),
            end: ghostEndpoint(el.end),
            frame: { ...el.frame, x: el.frame.x + dx, y: el.frame.y + dy },
          } as Element);
        } else {
          const baseWorld = originalWorldFrames.get(el.id)!;
          ghosts.push({
            ...el,
            frame: { ...baseWorld, x: baseWorld.x + dx, y: baseWorld.y + dy },
          } as Element);
        }
      }

      // Handles anchor to the ORIGINAL world frames so the user reads
      // them as "where it started"; the ghost reads as "where it will
      // land". Build pseudo-elements with the world frame patched in.
      const handleElements: Element[] = Array.from(originals.values()).map((el) => ({
        ...el,
        frame: originalWorldFrames.get(el.id)!,
      } as Element));

      this.paintGhostPreview(ghosts, handleElements, guides);
    };
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      // P1.5 slow double-click: a second pointer-down → up cycle on an
      // already-selected single text-capable element, finishing inside
      // its text region within the tight time + distance window, enters
      // edit mode. Coexists with the browser `dblclick` route — both
      // funnel through `enterEditMode`, and `onDoubleClick` early-returns
      // when an edit session is already live. See
      // docs/design/slides/slides-hover-and-text-edit-entry.md § P1.5.
      //
      // `peakRawClientDist` gate disqualifies a drag-and-cancel gesture
      // (moved away then returned to within 3 px of start) — the spec
      // is "tight click", not "ended close to start". Distance is in
      // raw client px so the gesture feel is zoom-independent ("did the
      // human finger move?" rather than "did the slide-space delta
      // exceed N world px"); a 2 px twitch at 25 % zoom is the same
      // human gesture as a 2 px twitch at 400 %.
      if (
        slowDoubleClickEligible &&
        peakRawClientDist < SLOW_DOUBLE_CLICK_MAX_DISTANCE_PX &&
        isSlowDoubleClick(
          clientX, clientY, downTimeMs,
          ev.clientX, ev.clientY, ev.timeStamp,
        ) &&
        this.tryEnterEditFromSlowDoubleClick(ev.clientX, ev.clientY)
      ) {
        this.renderer.markDirty();
        this.render();
        this.repaintOverlay();
        return;
      }
      // Skip the batch when the pointer never moved past snap noise:
      // an empty `store.batch` still pushes an undo snapshot and clears
      // the redo stack. A pure click-without-drag must be a no-op
      // against history.
      if (liveDx === 0 && liveDy === 0) {
        this.renderer.markDirty();
        this.render();
        this.repaintOverlay();
        return;
      }
      const slideId = startSlide.id;
      this.options.store.batch(() => {
        for (const [id, baseWorld] of originalWorldFrames) {
          const el = originals.get(id);
          if (!el) continue;
          if (el.type === 'connector') {
            // Connectors translate via endpoints; `updateElementFrame`
            // rejects them because their frame is derived.
            commitTranslate(this.options.store, slideId, el, liveDx, liveDy);
            continue;
          }
          const newWorld = {
            ...baseWorld,
            x: baseWorld.x + liveDx,
            y: baseWorld.y + liveDy,
          };
          const localFrame = fromWorldFrame(newWorld, scope, startSlide);
          this.options.store.updateElementFrame(slideId, id, localFrame);
        }
      });
      this.renderer.markDirty();
      this.render();
      // Clear lingering snap-guide nodes from the last `paintGhostPreview`.
      this.repaintOverlay();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  /**
   * Outer-frame resize preview for tables. Paints the committed slide
   * untouched + a translucent ghost table at the proposed frame with
   * its `columnWidths` / `rows[].height` scaled proportionally — same
   * channel as `paintGhostPreview` (canvas-level GHOST_ALPHA), so the
   * user sees their actual table content (cells, fills, text) ghosted
   * at the new size rather than a placeholder outline. Handles snap
   * to the ghost frame so the drag stays interactive. Commit on
   * pointerup goes through `updateElementFrame`, whose CR#4 scaling
   * matches the ghost's preview.
   */
  private paintTableResizeGhost(
    startEl: TableElement,
    worldFrame: Frame,
    scope: readonly string[],
    guides: readonly (SnapGuide | SmartGuide)[] = [],
  ): void {
    const slide = this.currentSlide();
    if (!slide) return;
    const oldW = startEl.frame.w;
    const oldH = startEl.frame.h;
    const sx = oldW > 0 ? worldFrame.w / oldW : 1;
    const sy = oldH > 0 ? worldFrame.h / oldH : 1;
    const localFrame = fromWorldFrame(worldFrame, scope, slide);
    const ghostTable: TableElement = {
      ...startEl,
      frame: localFrame,
      data: {
        ...startEl.data,
        columnWidths: startEl.data.columnWidths.map((w) => w * sx),
        rows: startEl.data.rows.map((r) => ({ ...r, height: r.height * sy })),
      },
    };
    this.renderer.forceRender(slide, this.options.store.read(), [ghostTable]);
    // Overlay handles track the ghost frame so the user can keep dragging
    // smoothly — unlike move where handles stay anchored to the original
    // (move semantics are "where will it land vs. where it started";
    // resize semantics are "the active size right now").
    const ghostWorld: Element = { ...startEl, frame: worldFrame };
    renderOverlay(this.options.overlay, [ghostWorld], {
      scale: this.scale(),
      slideWidth: SLIDE_WIDTH,
      slideHeight: SLIDE_HEIGHT,
      guides,
      allElements: slide.elements,
      connectorAffordance: this.connectorAffordance(),
      permanentGuides: this.options.store.read().guides,
      pendingGuide: this.pendingGuide,
    });
  }

  /**
   * Live-preview paint shared by move, rotate, and resize:
   * - Renders the committed slide at full opacity.
   * - Overlays `ghosts` at `GHOST_ALPHA`.
   * - Anchors selection handles to `handleElements` — pass `ghosts`
   *   for resize (the dragged handle must follow the cursor), pass
   *   the originals for move and rotate (the gesture is by direction,
   *   not position).
   */
  private paintGhostPreview(
    ghosts: readonly Element[],
    handleElements: readonly Element[],
    guides: readonly (SnapGuide | SmartGuide)[] = [],
  ): void {
    const slide = this.currentSlide();
    if (!slide) return;
    this.renderer.forceRender(slide, this.options.store.read(), ghosts);
    renderOverlay(this.options.overlay, handleElements, {
      scale: this.scale(),
      slideWidth: SLIDE_WIDTH,
      slideHeight: SLIDE_HEIGHT,
      // Keep peer rings / name tags visible through the gesture preview —
      // this path rebuilds the overlay DOM, so omitting peers would drop
      // them on the first drag/resize/rotate repaint until the gesture ends.
      peerOverlays: this.currentPeerOverlays(slide),
      guides,
      allElements: slide.elements,
      connectorAffordance: this.connectorAffordance(),
      permanentGuides: this.options.store.read().guides,
      pendingGuide: this.pendingGuide,
    });
  }

  /**
   * Build the peer-presence overlays (selection rings / live frames /
   * guide previews) for `slide`, or `undefined` when no peers are
   * present. `buildElementWorldLookup` lifts every element (group
   * children included) to an absolute world frame so a peer's selected
   * ids resolve to the same coordinates the local handles use — the same
   * order of work as the `store.read()` deep clone these repaint paths
   * already do, so it adds no new asymptotic cost. `computePeerOverlays`
   * filters to peers on `slide` and prefers their live `activeFrames`
   * over the static selection ring. Shared by `repaintOverlay` and
   * `paintGhostPreview` so peers render in every overlay path.
   */
  private currentPeerOverlays(slide: Slide): PeerOverlays | undefined {
    if (this.peers.length === 0) return undefined;
    const peerLookup = buildElementWorldLookup(slide.elements);
    return computePeerOverlays(
      this.peers,
      slide.id,
      (id) => peerLookup.get(id)?.frame,
    );
  }

  private currentSlide() {
    const id = this.currentId;
    if (!id) return undefined;
    return this.options.store.read().slides.find((s) => s.id === id);
  }

  private clientToLogical(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.options.canvas.getBoundingClientRect();
    const scale = this.scale();
    // The canvas DOM may extend past the slide rect on each axis
    // (the surrounding empty area inside `scrollHost` becomes the
    // pasteboard). Subtract the slide's offset inside the canvas so
    // logical (0,0) lands at slide-left/top regardless.
    const offsetX = this.options.slideOffsetLogicalX ?? 0;
    const offsetY = this.options.slideOffsetLogicalY ?? 0;
    return {
      x: (clientX - rect.left) / scale - offsetX,
      y: (clientY - rect.top) / scale - offsetY,
    };
  }

  /**
   * Common arguments for `selectAt` / `topmostUnderPoint`. Connector
   * tolerance scales with the editor's zoom so a 6-logical-pixel
   * threshold stays at a roughly-constant 6 viewport pixels.
   */
  private hitOptions(): { ctx: HitTestCtx; tolerance: number } {
    return {
      ctx: this.hitCtx,
      tolerance: this.hitTolerance / this.scale(),
    };
  }

  /**
   * Run `hitTestSlide` with the shared `hitCtx`'s transform pinned to
   * identity. `SlideRenderer` paints with `scale((hostWidth /
   * SLIDE_WIDTH) * dpr)` and leaves that transform applied; `Path2D`
   * isPointInPath / isPointInStroke calls then interpret the path
   * commands through the active transform but receive the query (lx,
   * ly) in canvas-pixel space, so an interior click misses every
   * shape. Save / setTransform(identity) / restore around the
   * hit-test makes the path live in the same logical space as (lx,
   * ly) without disturbing the renderer's post-paint state.
   */
  private hitTestAt(slide: Slide, x: number, y: number) {
    const ctx = this.hitCtx as Partial<CanvasRenderingContext2D>;
    const hasSave = typeof ctx.save === 'function';
    if (hasSave) ctx.save!();
    try {
      if (typeof ctx.setTransform === 'function') {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      return hitTestSlide(slide, x, y, this.hitOptions());
    } finally {
      if (hasSave) ctx.restore!();
    }
  }

  private handleAtClient(clientX: number, clientY: number): HandleKind | null {
    const rect = this.options.overlay.getBoundingClientRect();
    return handleHitTest(
      this.options.overlay,
      clientX - rect.left,
      clientY - rect.top,
      this.options.touchHandleTolerance,
    );
  }

  private onPointerDownHandle(handle: HandleKind, clientX: number, clientY: number): void {
    if (handle === 'rotate') {
      this.startRotate(clientX, clientY);
      return;
    }
    if (handle === 'start' || handle === 'end') {
      this.startConnectorEndpointDrag(handle, clientX, clientY);
      return;
    }
    if (handle === 'bend') {
      this.startBendDrag(clientX, clientY);
      return;
    }
    if (handle.startsWith('adjust-')) {
      const handleIndex = parseInt(handle.slice('adjust-'.length), 10);
      this.startAdjustmentDrag(handleIndex, clientX, clientY);
      return;
    }
    this.startResize(handle as ResizeHandle, clientX, clientY);
  }

  /**
   * Drag one endpoint of a selected connector. Snaps to connection
   * sites of other elements within `SITE_SNAP_RADIUS` while the cursor
   * moves; on mouseup the final endpoint is committed via a single
   * batched `updateConnectorEndpoint` so undo treats the whole drag as
   * one operation.
   *
   * During the drag we paint a synthesised slide with the connector's
   * endpoint replaced by the in-progress value — same pattern as
   * `paintLive` for shape drags, just keyed on the endpoint instead of
   * the frame. The store is not touched until mouseup, so each move is
   * one canvas paint, not one Yorkie op.
   */
  private startConnectorEndpointDrag(
    side: 'start' | 'end',
    clientX: number,
    clientY: number,
  ): void {
    const startSlide = this.currentSlide();
    if (!startSlide) return;
    const selectedIds = this.selection.get();
    if (selectedIds.length !== 1) return;
    const elementId = selectedIds[0];
    const startEl = startSlide.elements.find((e) => e.id === elementId);
    if (!startEl || startEl.type !== 'connector') return;
    const startConnector = startEl;
    const slideId = startSlide.id;
    // Gate `onInsertHoverLeave` from clobbering `connectorCursor` /
    // wiping the endpoint ghost when the cursor crosses overlay DOM
    // (handle, ghost, snap dots) mid-drag.
    this.endpointDragging = true;

    const startCursor = this.clientToLogical(clientX, clientY);
    let liveEndpoint = side === 'start' ? startConnector.start : startConnector.end;
    let liveCursor = startCursor;
    let moved = false;
    // Drive the Task 13 connection-points overlay throughout the drag.
    // Seeded with the start cursor so dots appear on the first paint —
    // important when the user clicks the handle directly over a nearby
    // shape and never crosses the move threshold below.
    this.connectorCursor = startCursor;

    // World-space position of the OTHER (non-dragging) endpoint. Captured
    // once at mousedown — the opposite endpoint stays fixed for the
    // duration of this drag, so we don't need to re-resolve per move.
    const otherEndpoint = side === 'start' ? startConnector.end : startConnector.start;
    const otherWorld = resolveEndpoint(
      otherEndpoint,
      buildElementWorldLookup(startSlide.elements),
    );

    const recompute = (cur: { x: number; y: number }) => {
      // Other elements as snap candidates — exclude the connector itself
      // so the endpoint can't self-link. Mirrors `dragEndpoint`'s filter
      // but applied here so the live preview matches the eventual
      // commit exactly.
      const candidates = startSlide.elements.filter(
        (e) => e.id !== startConnector.id,
      );
      liveEndpoint = snappedEndpoint(cur, candidates, this.scale());
      liveCursor = cur;
    };

    const paintLiveConnector = () => {
      // Canvas: render the slide unchanged so the real connector stays
      // anchored, then layer a translucent ghost copy with the dragged
      // endpoint replaced by `liveEndpoint` — same `ghost` slot the
      // hover-preview path uses for shape inserts, so it inherits the
      // existing `GHOST_ALPHA` rendering with no extra plumbing.
      const ghostConnector = {
        ...startConnector,
        start: side === 'start' ? liveEndpoint : startConnector.start,
        end:   side === 'end'   ? liveEndpoint : startConnector.end,
      };
      this.renderer.forceRender(
        startSlide,
        this.options.store.read(),
        [ghostConnector],
      );
      // Overlay: original connector → handles stay at the pre-drag
      // positions. On mouseup, `dragEndpoint` commits and the next
      // `repaintOverlay` reads the store-side new endpoint, so the
      // handle teleports to where the ghost was.
      const selected = startSlide.elements.filter((e) =>
        this.selection.has(e.id),
      );
      renderOverlay(this.options.overlay, selected, {
        scale: this.scale(),
        slideWidth: SLIDE_WIDTH,
        slideHeight: SLIDE_HEIGHT,
        allElements: startSlide.elements,
        connectorAffordance: this.connectorAffordance(),
      });
    };

    const onMove = (ev: MouseEvent) => {
      const raw = this.clientToLogical(ev.clientX, ev.clientY);
      // Deadband is measured against the RAW pointer position, not the
      // Shift-snapped one — `snapEndpointAngle` preserves distance from
      // `otherWorld`, not from `startCursor`, so a snapped click can
      // land many logical units from `startCursor` and falsely cross
      // the threshold (detaching an attached endpoint on what the user
      // intended as a click). Apply Shift only after the pure-click
      // gate has been cleared.
      if (!moved) {
        const dx = raw.x - startCursor.x;
        const dy = raw.y - startCursor.y;
        // Use the same screen-pixel constant as insert so click-vs-drag
        // feels identical across modes (insert / endpoint-drag) and
        // across zoom levels. `MIN_DRAG_DISTANCE` is in screen pixels;
        // `dx`/`dy` are slide-logical, so divide by zoom for the
        // matching logical threshold. A pure click then never
        // reinterprets the endpoint (e.g. detaches an attached
        // endpoint because the free cursor landed off-site).
        const threshold = CONNECTOR_MIN_DRAG_DISTANCE / this.scale();
        if (dx * dx + dy * dy < threshold * threshold) {
          // Update the affordance cursor with the raw position so dots
          // track continuously below the deadband.
          this.connectorCursor = raw;
          return;
        }
        moved = true;
      }
      // Shift snap is relative to the fixed opposite endpoint, then the
      // result flows through the normal snap-to-connection-site test
      // inside `recompute(cur)`. If the snapped point lands on a site,
      // it attaches; otherwise it stays free — same precedence as B2.
      const cur = ev.shiftKey ? snapEndpointAngle(otherWorld, raw) : raw;
      this.connectorCursor = cur;
      recompute(cur);
      paintLiveConnector();
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      this.endpointDragging = false;
      // Drop the affordance cursor before repainting so the dots
      // disappear on commit (no drag = no affordance).
      this.connectorCursor = null;
      if (!moved) {
        // No drag occurred — repaint anyway to clear the seed-time
        // affordance dots we painted on mousedown.
        this.repaintOverlay();
        return;
      }
      // Commit the final endpoint via dragEndpoint so the snap rules
      // match exactly between live preview and committed state.
      this.options.store.batch(() => {
        dragEndpoint(
          this.options.store,
          slideId,
          startConnector,
          side,
          liveCursor,
          startSlide.elements,
          this.scale(),
        );
      });
      this.renderer.markDirty();
      this.render();
      this.repaintOverlay();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  private startAdjustmentDrag(
    handleIndex: number,
    clientX: number,
    clientY: number,
  ): void {
    const startSlide = this.currentSlide();
    if (!startSlide) return;
    const selectedIds = this.selection.get();
    if (selectedIds.length !== 1) return;
    const elementId = selectedIds[0];
    // World lookup so grouped shapes resolve and the world↔local
    // conversion below operates on the world frame the canvas paints
    // (pointer logical coords are world coords). The render-side
    // `paintLiveAdjustments` recurses into groups to write the live
    // preview, and the store commit goes through `updateElementData`
    // which is already group-aware.
    const startEl = buildElementWorldLookup(startSlide.elements).get(elementId);
    if (!startEl || startEl.type !== 'shape') return;

    const handles = ADJUSTMENT_HANDLES.get(startEl.data.kind);
    if (!handles || !handles[handleIndex]) return;
    const handle = handles[handleIndex];
    const specs = ADJUSTMENT_SPECS.get(startEl.data.kind) ?? [];
    const startAdjustments =
      startEl.data.adjustments ?? defaultAdjustmentsFor(startEl.data.kind);

    const startWorld = this.clientToLogical(clientX, clientY);

    let live = startAdjustments;
    let moved = false;

    const onMove = (ev: MouseEvent) => {
      const cur = this.clientToLogical(ev.clientX, ev.clientY);
      if (!moved) {
        const dx = cur.x - startWorld.x;
        const dy = cur.y - startWorld.y;
        if (dx * dx + dy * dy < 4) return; // 2px threshold
        moved = true;
      }
      const local = adjustmentWorldToLocal(startEl.frame, cur);
      let next = handle.apply(
        { w: startEl.frame.w, h: startEl.frame.h },
        startAdjustments,
        local,
      );
      if (ev.shiftKey) next = snapToDefaults(startEl.data.kind, next);
      live = next;
      this.paintLiveAdjustments(elementId, live);

      // Tooltip — formatted value, upper-right of handle in world coords.
      const handleLocal = handle.position(
        { w: startEl.frame.w, h: startEl.frame.h },
        live,
      );
      const handleWorld = adjustmentLocalToWorld(startEl.frame, handleLocal);
      showAdjustmentTooltip(
        this.options.overlay,
        handleWorld.x,
        handleWorld.y,
        this.scale(),
        formatAdjustments(specs, live),
      );
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      hideAdjustmentTooltip();
      if (!moved) return;
      this.options.store.batch(() => {
        this.options.store.updateElementData(startSlide.id, elementId, {
          adjustments: live,
        });
      });
      this.renderer.markDirty();
      this.render();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  /**
   * Drag the yellow-diamond bend handle on a selected connector.
   * `bendFromCursor` computes the per-routing value from the cursor
   * each move; we ghost-paint a synthetic connector through
   * `renderer.forceRender` so the canvas previews the new path
   * without touching the store, then commit a single batched
   * `commitBend` on mouseup so undo treats the whole drag as one op.
   */
  private startBendDrag(clientX: number, clientY: number): void {
    const startSlide = this.currentSlide();
    if (!startSlide) return;
    const selectedIds = this.selection.get();
    if (selectedIds.length !== 1) return;
    const elementId = selectedIds[0];
    const startEl = startSlide.elements.find((e) => e.id === elementId);
    if (!startEl || startEl.type !== 'connector') return;
    const startConnector = startEl;
    const slideId = startSlide.id;

    const lookup = buildElementWorldLookup(startSlide.elements);
    let liveBend: number | null = null;
    let moved = false;
    const startCursor = this.clientToLogical(clientX, clientY);

    const paintLive = () => {
      if (liveBend === null) return;
      const ghost =
        startConnector.routing === 'elbow'
          ? { ...startConnector, elbowBend: liveBend }
          : { ...startConnector, curveBend: liveBend };
      this.renderer.forceRender(
        startSlide,
        this.options.store.read(),
        [ghost],
      );
      const selected = startSlide.elements.filter((e) =>
        this.selection.has(e.id),
      );
      renderOverlay(this.options.overlay, selected, {
        scale: this.scale(),
        slideWidth: SLIDE_WIDTH,
        slideHeight: SLIDE_HEIGHT,
        allElements: startSlide.elements,
      });
    };

    const onMove = (ev: MouseEvent) => {
      const cur = this.clientToLogical(ev.clientX, ev.clientY);
      if (!moved) {
        const dx = cur.x - startCursor.x;
        const dy = cur.y - startCursor.y;
        const threshold = CONNECTOR_MIN_DRAG_DISTANCE / this.scale();
        if (dx * dx + dy * dy < threshold * threshold) return;
        moved = true;
      }
      const next = bendFromCursor(startConnector, cur, lookup);
      if (next === null) return;
      liveBend = next;
      paintLive();
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (!moved || liveBend === null) return;
      const value = liveBend;
      this.options.store.batch(() => {
        commitBend(this.options.store, slideId, startConnector, value);
      });
      this.renderer.markDirty();
      this.render();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  private paintLiveAdjustments(elementId: string, adjustments: number[]): void {
    // Render a synthetic slide where the target shape's data has the live
    // adjustments applied. Mirrors paintLive but overrides element data
    // instead of frame, using the same forceRender pattern. The walker
    // recurses into groups so adjustments on grouped shapes preview
    // correctly.
    const slide = this.currentSlide();
    if (!slide) return;
    const synthetic = {
      ...slide,
      elements: replaceShapeAdjustments(
        slide.elements,
        elementId,
        adjustments,
      ),
    };
    this.renderer.forceRender(synthetic, this.options.store.read());
    // Repaint overlay so adjustment handles follow the live shape.
    // `buildElementWorldLookup` resolves the live element (with the new
    // adjustments) AND composes ancestor group transforms into its
    // frame — both required so the yellow diamond tracks the shape
    // inside a group.
    const liveEl = buildElementWorldLookup(synthetic.elements).get(elementId);
    if (!liveEl) return;
    renderOverlay(this.options.overlay, [liveEl], {
      scale: this.scale(),
      slideWidth: SLIDE_WIDTH,
      slideHeight: SLIDE_HEIGHT,
      allElements: synthetic.elements,
    });
  }

  private startRotate(clientX: number, clientY: number): void {
    const startSlide = this.currentSlide();
    if (!startSlide) return;
    const scope = this.selection.getScope();
    const selectedIds = this.selection.get();
    if (selectedIds.length === 0) return;

    // Capture each selected element's starting world frame. For groups
    // we wrap them through `worldTightFrame` so the rotation pivot uses
    // the same combined bbox the user sees (overlay handles).
    type Entry = {
      id: string;
      original: Element;
      startWorld: Frame;
      startCenter: { x: number; y: number };
      startRotation: number;
    };
    const entries: Entry[] = [];
    for (const id of selectedIds) {
      const el = findElement(startSlide.elements, id);
      if (!el) continue;
      const displayLocal =
        el.type === 'group' ? worldTightFrame(el).worldFrame : el.frame;
      const startWorld = toWorldFrame(displayLocal, scope, startSlide);
      entries.push({
        id,
        original: el,
        startWorld,
        startCenter: {
          x: startWorld.x + startWorld.w / 2,
          y: startWorld.y + startWorld.h / 2,
        },
        startRotation: startWorld.rotation,
      });
    }
    if (entries.length === 0) return;

    // Pivot = combined bbox center (matches what `renderAxisAlignedHandles`
    // uses for the rotate handle position in multi-select).
    const bbox = combinedBoundingBox(entries.map((e) => e.startWorld));
    if (!bbox) return;
    const pivotX = bbox.x + bbox.w / 2;
    const pivotY = bbox.y + bbox.h / 2;

    const start = this.clientToLogical(clientX, clientY);
    const startAngle = Math.atan2(start.y - pivotY, start.x - pivotX);
    let liveDelta = 0;

    // For a single-element selection, the rotation handle is conceptually
    // "spin in place" — Google Slides keeps the element's center fixed.
    // Skipping the pivot rotation in this case preserves that behavior
    // (the pivot equals the element's own center, so the position update
    // is a no-op anyway, but skipping the matrix work also avoids any
    // floating-point drift on the position).
    const isMulti = entries.length > 1;

    // Selection handles stay anchored to the ORIGINAL world frames so
    // the user reads them as "where the rotation started"; the ghost
    // reads as "where it will land on release". Matches the drag-move
    // ghost pattern from `slides-shape-move.md`.
    const handleElements: Element[] = entries.map(
      (e) => ({ ...e.original, frame: e.startWorld }) as Element,
    );

    const rotatePoint = (
      x: number,
      y: number,
      cosT: number,
      sinT: number,
    ): { x: number; y: number } => {
      const dx = x - pivotX;
      const dy = y - pivotY;
      return {
        x: pivotX + dx * cosT - dy * sinT,
        y: pivotY + dx * sinT + dy * cosT,
      };
    };

    const buildLiveState = (
      delta: number,
    ): {
      liveFrames: Map<string, Frame>;
      ghosts: Element[];
    } => {
      const cosT = Math.cos(delta);
      const sinT = Math.sin(delta);
      const liveFrames = new Map<string, Frame>();
      const ghosts: Element[] = [];

      for (const e of entries) {
        if (e.original.type === 'connector') {
          // Connector ghost: rotate free endpoints around the pivot.
          // Attached endpoints stay anchored to their (un-rotating)
          // host. Frame is also rotated for consumers that read it for
          // bbox/hit-test purposes (the renderer uses endpoints).
          const c = e.original;
          const rotateEp = (ep: typeof c.start) =>
            ep.kind === 'free'
              ? ({ kind: 'free', ...rotatePoint(ep.x, ep.y, cosT, sinT) } as typeof ep)
              : ep;
          const liveWorld: Frame = isMulti
            ? (() => {
                const c2 = rotatePoint(e.startCenter.x, e.startCenter.y, cosT, sinT);
                return {
                  ...e.startWorld,
                  x: c2.x - e.startWorld.w / 2,
                  y: c2.y - e.startWorld.h / 2,
                  rotation: e.startRotation + delta,
                };
              })()
            : { ...e.startWorld, rotation: e.startRotation + delta };
          liveFrames.set(e.id, liveWorld);
          ghosts.push({
            ...c,
            start: rotateEp(c.start),
            end: rotateEp(c.end),
            frame: liveWorld,
          });
          continue;
        }

        const liveWorld: Frame = isMulti
          ? (() => {
              const c = rotatePoint(e.startCenter.x, e.startCenter.y, cosT, sinT);
              return {
                ...e.startWorld,
                x: c.x - e.startWorld.w / 2,
                y: c.y - e.startWorld.h / 2,
                rotation: e.startRotation + delta,
              };
            })()
          : { ...e.startWorld, rotation: e.startRotation + delta };
        liveFrames.set(e.id, liveWorld);
        ghosts.push({ ...e.original, frame: liveWorld } as Element);
      }

      return { liveFrames, ghosts };
    };

    const tooltip = this.acquireRotateTooltip();
    // The tooltip is appended to overlay.parentElement (see
    // `acquireRotateTooltip`) so `renderOverlay`'s innerHTML reset
    // doesn't wipe it mid-drag. That means `tooltip.style.transform`
    // is interpreted in the PARENT's containing block — not the
    // overlay's. When the slides-view installs a pasteboard, the
    // overlay lives inside `canvasWrap` at `(slideOffsetCssX,
    // slideOffsetCssY)`, so basing the coords on the overlay's rect
    // would translate the tooltip by that offset relative to where
    // the mouse actually is. Measure against the parent rect instead.
    const tooltipContainer = tooltip.parentElement ?? this.options.overlay;
    const showTooltip = (clientPx: number, clientPy: number, delta: number) => {
      const rect = tooltipContainer.getBoundingClientRect();
      const localX = clientPx - rect.left;
      const localY = clientPy - rect.top;
      // `transform` first, then `display: block` — same paint frame
      // so the tooltip never lands at a stale position; see
      // `acquireRotateTooltip` for context.
      // Show absolute rotation for single-element (matches Google Slides),
      // delta for multi (since the selection had no group rotation).
      const display = isMulti
        ? delta
        : entries[0].startRotation + delta;
      // Normalize to (-180°, 180°] for compact display.
      const deg = ((display * 180) / Math.PI + 540) % 360 - 180;
      tooltip.textContent = `${Math.round(deg)}°`;
      tooltip.style.transform = `translate(${localX + 14}px, ${localY + 14}px)`;
      tooltip.style.display = 'block';
    };
    // Paint the tooltip at the click position immediately so the user
    // gets a 0° reading next to the cursor without waiting for the
    // first pointermove. acquireRotateTooltip keeps the element hidden
    // until this call, so this is also the only place `display: block`
    // gets set on a re-acquired element — no stale-transform flicker.
    showTooltip(clientX, clientY, 0);

    // For single-element rotate, hand `applyRotate` the shape's
    // existing rotation so the cardinal soft-snap (and 15° shift snap)
    // target the *final absolute* rotation, not the delta. For multi
    // there's no group rotation, so the snap target is the gesture
    // delta itself.
    const snapStart = isMulti ? 0 : entries[0].startRotation;
    const onMove = (ev: MouseEvent) => {
      const cur = this.clientToLogical(ev.clientX, ev.clientY);
      const angle = Math.atan2(cur.y - pivotY, cur.x - pivotX);
      const next = applyRotate(snapStart, startAngle, angle, ev.shiftKey);
      liveDelta = next - snapStart;
      const { ghosts } = buildLiveState(liveDelta);
      this.paintGhostPreview(ghosts, handleElements);
      showTooltip(ev.clientX, ev.clientY, liveDelta);
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      this.releaseRotateTooltip();
      if (liveDelta === 0) {
        this.renderer.markDirty();
        this.render();
        this.repaintOverlay();
        return;
      }
      const { liveFrames } = buildLiveState(liveDelta);
      this.options.store.batch(() => {
        for (const e of entries) {
          const liveWorld = liveFrames.get(e.id);
          if (!liveWorld) continue;
          // Connectors are translated via endpoints, not their frame.
          // For multi-rotate, free endpoints rotate around the pivot;
          // attached endpoints stay anchored to their host (and the host
          // moves through its own commit path).
          if (e.original.type === 'connector') {
            this.commitConnectorRotation(
              startSlide.id,
              e.original,
              pivotX,
              pivotY,
              liveDelta,
            );
            continue;
          }
          const localFrame = fromWorldFrame(liveWorld, scope, startSlide);
          this.options.store.updateElementFrame(
            startSlide.id,
            e.id,
            localFrame,
          );
        }
      });
      this.renderer.markDirty();
      this.render();
      this.repaintOverlay();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  /**
   * Lazily create and attach the rotation-angle tooltip. Lives outside
   * the overlay's `innerHTML` so `renderOverlay` rebuilds don't wipe it
   * mid-drag. Hidden by default.
   */
  private rotateTooltipEl: HTMLDivElement | null = null;
  private acquireRotateTooltip(): HTMLDivElement {
    // Hand back the existing element as-is (still `display: none`) so
    // the caller can set the live `transform` and the visible `display`
    // together in one paint frame. Flipping `display: block` here would
    // paint the previous drag's last `transform` for one frame, which
    // shows up as a flicker at the old position before the first
    // `pointermove` reaches `showTooltip`.
    if (this.rotateTooltipEl) return this.rotateTooltipEl;
    const el = document.createElement('div');
    el.className = 'wfb-slides-rotate-tooltip';
    el.style.position = 'absolute';
    el.style.top = '0';
    el.style.left = '0';
    el.style.padding = '2px 6px';
    el.style.fontSize = '11px';
    el.style.lineHeight = '14px';
    el.style.fontFamily = 'system-ui, sans-serif';
    el.style.color = '#fff';
    el.style.background = 'rgba(0, 0, 0, 0.75)';
    el.style.borderRadius = '3px';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '1000';
    el.style.display = 'none';
    // Append to the overlay's parent so renderOverlay's innerHTML reset
    // can't remove it. The overlay is positioned over the canvas; its
    // parent is the same containing block, so absolute coordinates line up.
    const parent = this.options.overlay.parentElement ?? this.options.overlay;
    parent.appendChild(el);
    this.rotateTooltipEl = el;
    return el;
  }
  private releaseRotateTooltip(): void {
    if (this.rotateTooltipEl) this.rotateTooltipEl.style.display = 'none';
  }

  /**
   * Apply a multi-rotate delta to a connector by rotating its free
   * endpoints around the pivot. Attached endpoints stay where they are
   * — their host element handles its own rotation through the regular
   * commit path. Must run inside a store batch.
   */
  private commitConnectorRotation(
    slideId: string,
    connector: Element,
    pivotX: number,
    pivotY: number,
    delta: number,
  ): void {
    if (connector.type !== 'connector') return;
    const cosT = Math.cos(delta);
    const sinT = Math.sin(delta);
    for (const side of ['start', 'end'] as const) {
      const ep = side === 'start' ? connector.start : connector.end;
      if (ep.kind !== 'free') continue;
      const dx = ep.x - pivotX;
      const dy = ep.y - pivotY;
      const nx = pivotX + dx * cosT - dy * sinT;
      const ny = pivotY + dx * sinT + dy * cosT;
      this.options.store.updateConnectorEndpoint(slideId, connector.id, side, {
        kind: 'free',
        x: nx,
        y: ny,
      });
    }
  }

  private startResize(handle: ResizeHandle, clientX: number, clientY: number): void {
    const startSlide = this.currentSlide();
    if (!startSlide) return;
    const scope = this.selection.getScope();
    const selectedIds = this.selection.get();
    if (selectedIds.length > 1) {
      this.startMultiResize(handle, clientX, clientY, startSlide, scope, selectedIds);
      return;
    }
    const elementId = selectedIds[0];
    const startEl = findElement(startSlide.elements, elementId);
    if (!startEl) return;
    // Migrate legacy groups that pre-date the refSize field BEFORE the
    // drag begins, so the live preview also reflects proportional child
    // scaling (otherwise refSize would still be undefined while
    // paintGhostPreview is running, and only the post-commit render
    // would scale).
    if (startEl.type === 'group' && startEl.data.refSize === undefined) {
      const captured = { w: startEl.frame.w, h: startEl.frame.h };
      this.options.store.batch(() => {
        this.options.store.updateElementData(startSlide.id, elementId, {
          refSize: captured,
        });
      });
      // Patch the in-memory snapshot too. The migration batch writes to
      // the store, but `startEl` was captured before the batch and the
      // subsequent ghost paint (`paintGhostPreview([ghost], ...)`) builds
      // the ghost from this in-memory copy. Without this line, the first
      // frame of the drag preview would still render the children at the
      // pre-migration scale (= 1 against the new frame dims), which makes
      // the legacy migration invisible to the user mid-drag.
      startEl.data.refSize = captured;
    }
    // Resize operates in world space so the handles stay fixed in the
    // positions the user sees. Convert the stored local frame to world
    // for all delta math, then convert back at commit time.
    const startWorldFrame = toWorldFrame(startEl.frame, scope, startSlide);
    const start = this.clientToLogical(clientX, clientY);
    const live = { worldFrame: startWorldFrame };
    const otherFrames = collectSnapCandidates(
      startSlide,
      [...scope],
      new Set([elementId]),
    );

    const isTable = startEl.type === 'table';
    const onMove = (ev: MouseEvent) => {
      const cur = this.clientToLogical(ev.clientX, ev.clientY);
      const dx = cur.x - start.x;
      const dy = cur.y - start.y;
      const raw = resizeFrameWorld(startWorldFrame, handle, dx, dy, ev.shiftKey);
      // Skip equal-size snap while Shift is held — Shift means "preserve
      // aspect", which would fight with snapping to a peer's exact w/h.
      const matched = ev.shiftKey
        ? { x: raw.x, y: raw.y, w: raw.w, h: raw.h, guides: [] as SmartGuide[] }
        : matchSize({ x: raw.x, y: raw.y, w: raw.w, h: raw.h }, handle, otherFrames);
      live.worldFrame = {
        ...raw,
        x: matched.x, y: matched.y, w: matched.w, h: matched.h,
      };
      if (isTable) {
        // Deferred-resize: the committed table stays painted on the
        // canvas and a translucent ghost table — with cells scaled
        // proportionally — paints on top at the proposed frame. Same
        // GHOST_ALPHA channel as move, so the ghost reads as a
        // semi-transparent copy of the real shape rather than a
        // placeholder outline. Commit on pointerup applies the
        // scaling for real via updateElementFrame.
        this.paintTableResizeGhost(
          startEl as TableElement,
          live.worldFrame,
          scope,
          matched.guides,
        );
        return;
      }
      // Single non-table resize: paint a ghost of the element at its new
      // world frame on top of the committed slide. Handles render against
      // the ghost so the dragged handle stays under the cursor.
      const ghost: Element = { ...startEl, frame: live.worldFrame } as Element;
      this.paintGhostPreview([ghost], [ghost], matched.guides);
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      // Convert world frame back to scope-local before committing.
      const localFrame = fromWorldFrame(live.worldFrame, scope, startSlide);
      this.options.store.batch(() => {
        this.options.store.updateElementFrame(startSlide.id, elementId, localFrame);
        // For groups, bake the resize delta into the children so the
        // renderer no longer applies scale(sx, sy) when drawing them.
        // Without this, non-uniform group resize distorts text glyphs
        // and any fixed-size content. Google Slides / PowerPoint
        // resize behaviour matches: text never squishes inside a
        // resized group.
        if (startEl.type === 'group') {
          this.options.store.bakeGroupResize(startSlide.id, elementId);
        }
      });
      this.renderer.markDirty();
      this.render();
      // Clear lingering equal-size dashed outlines from the last
      // paintGhostPreview guides arg. Mirrors the move-drag onUp at ~line 2568.
      this.repaintOverlay();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  private startMultiResize(
    handle: ResizeHandle,
    clientX: number,
    clientY: number,
    startSlide: Slide,
    scope: readonly string[],
    selectedIds: readonly string[],
  ): void {
    // Migrate any legacy groups in the selection so refSize is set
    // before the first ghost paint. Without this, a group whose
    // refSize is undefined would render with scaleX/scaleY = 1 in the
    // ghost (since the renderer falls back to `refSize?.w ?? w` and
    // would equal w/h), making the children look static while the
    // group's frame stretches.
    const groupsToMigrate: { id: string; refSize: { w: number; h: number } }[] = [];
    for (const id of selectedIds) {
      const el = findElement(startSlide.elements, id);
      if (el && el.type === 'group' && el.data.refSize === undefined) {
        groupsToMigrate.push({
          id,
          refSize: { w: el.frame.w, h: el.frame.h },
        });
      }
    }
    if (groupsToMigrate.length > 0) {
      this.options.store.batch(() => {
        for (const { id, refSize } of groupsToMigrate) {
          this.options.store.updateElementData(startSlide.id, id, { refSize });
        }
      });
      // Patch the in-memory copies so the ghost snapshots below pick up
      // the migrated refSize for the first frame of the live preview.
      for (const { id, refSize } of groupsToMigrate) {
        const el = findElement(startSlide.elements, id);
        if (el && el.type === 'group') el.data.refSize = refSize;
      }
    }

    // Build immutable snapshots in world space. Group `worldFrame`
    // uses worldTightFrame so the bbox matches the overlay handles.
    const snapshots: ElementSnapshot[] = [];
    for (const id of selectedIds) {
      const el = findElement(startSlide.elements, id);
      if (!el) continue;
      const displayLocal =
        el.type === 'group' ? worldTightFrame(el).worldFrame : el.frame;
      const worldFrame = toWorldFrame(displayLocal, scope, startSlide);
      if (el.type === 'connector') {
        snapshots.push({
          kind: 'connector',
          id,
          worldFrame,
          start: el.start,
          end:   el.end,
        });
      } else {
        snapshots.push({ kind: 'frame', id, worldFrame });
      }
    }
    if (snapshots.length < 2) return;
    const rawBbox = combinedBoundingBox(snapshots.map((s) => s.worldFrame));
    if (!rawBbox) return;
    const startBbox: Frame = { ...rawBbox, rotation: 0 };

    const start = this.clientToLogical(clientX, clientY);
    const selectedSet = new Set(selectedIds);
    const otherFrames = collectSnapCandidates(startSlide, [...scope], selectedSet);
    const live = {
      result: {
        newBbox: startBbox,
        frames: new Map<string, Frame>(),
        connectorEndpoints: new Map<string, { start: Endpoint; end: Endpoint }>(),
      } as MultiResizeResult,
    };

    const onMove = (ev: MouseEvent): void => {
      const cur = this.clientToLogical(ev.clientX, ev.clientY);
      const dx = cur.x - start.x;
      const dy = cur.y - start.y;
      const raw = resizeMultiFrames(
        { scope, startBbox, snapshots },
        handle,
        dx,
        dy,
        ev.shiftKey,
      );
      let result = raw;
      let guides: SmartGuide[] = [];
      if (!ev.shiftKey) {
        const matched = matchSize(
          { x: raw.newBbox.x, y: raw.newBbox.y, w: raw.newBbox.w, h: raw.newBbox.h },
          handle,
          otherFrames,
        );
        guides = matched.guides;
        if (
          matched.w !== raw.newBbox.w ||
          matched.h !== raw.newBbox.h ||
          matched.x !== raw.newBbox.x ||
          matched.y !== raw.newBbox.y
        ) {
          // Translate the matched bbox back to the dx/dy that produced it.
          // For 'e' / 's' handles: dx/dy is the size delta. For 'w' / 'n':
          // dx/dy is the edge offset (resizeFrame does `left = start.x + dx`
          // for 'w' and `top = start.y + dy` for 'n'), so the sign is the
          // signed displacement of the moving edge, NOT the size delta.
          const matchedDx =
            handle.includes('e') ? matched.w - startBbox.w
            : handle.includes('w') ? matched.x - startBbox.x
            : 0;
          const matchedDy =
            handle.includes('s') ? matched.h - startBbox.h
            : handle.includes('n') ? matched.y - startBbox.y
            : 0;
          result = resizeMultiFrames(
            { scope, startBbox, snapshots },
            handle,
            matchedDx,
            matchedDy,
            false,
          );
        }
      }
      live.result = result;
      this.paintMultiResizeLive(snapshots, result, startSlide, guides);
    };
    const onUp = (): void => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      const { frames, connectorEndpoints } = live.result;
      // Skip the batch entirely when no `pointermove` produced any frame
      // updates — click-and-release on a handle would otherwise create an
      // empty undo step. The initial `live.result` holds empty Maps, so a
      // genuinely no-op gesture sees `frames.size === 0` here. (Move-drag
      // takes the same shortcut, see ~line 4406.)
      if (frames.size === 0 && connectorEndpoints.size === 0) {
        this.repaintOverlay();
        return;
      }
      this.options.store.batch(() => {
        for (const snap of snapshots) {
          const wf = frames.get(snap.id);
          if (!wf) continue;
          // Connector frames are always derived from their endpoints and
          // cannot be patched via updateElementFrame (which throws for
          // connectors). Free-endpoint connectors are committed via the
          // connectorEndpoints loop below; fully-attached connectors have
          // their frame auto-recomputed by the store when their hosts move.
          if (snap.kind === 'connector') continue;
          this.options.store.updateElementFrame(
            startSlide.id,
            snap.id,
            fromWorldFrame(wf, scope, startSlide),
          );
        }
        for (const [id, eps] of connectorEndpoints) {
          this.options.store.updateConnectorEndpoint(startSlide.id, id, 'start', eps.start);
          this.options.store.updateConnectorEndpoint(startSlide.id, id, 'end',   eps.end);
        }
      });
      this.renderer.markDirty();
      this.render();
      this.repaintOverlay();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  private paintMultiResizeLive(
    snapshots: readonly ElementSnapshot[],
    result: MultiResizeResult,
    startSlide: Slide,
    guides: readonly SmartGuide[],
  ): void {
    // Build ghost Elements: each selected element with its frame
    // replaced by the new world frame (and, for connectors, its
    // endpoints replaced by the new endpoints).
    const ghosts: Element[] = [];
    for (const snap of snapshots) {
      const wf = result.frames.get(snap.id);
      if (!wf) continue;
      const el = findElement(startSlide.elements, snap.id);
      if (!el) continue;
      if (el.type === 'connector') {
        const eps = result.connectorEndpoints.get(snap.id);
        ghosts.push({
          ...el,
          frame: wf,
          start: eps ? eps.start : el.start,
          end:   eps ? eps.end   : el.end,
        } as Element);
      } else {
        ghosts.push({ ...el, frame: wf } as Element);
      }
    }
    this.paintGhostPreview(ghosts, ghosts, guides);
  }
}

export function initialize(options: SlidesEditorOptions): SlidesEditor {
  const editor = new SlidesEditorImpl(options);
  editor.render();
  // Paint the overlay once on mount so deck-wide chrome (permanent
  // guides) is visible before any user interaction. Selection is empty
  // at this point so the only overlay output is the guides themselves.
  editor.markDirty();
  return editor;
}

/**
 * Returns `true` when the given selection can be grouped:
 *   - at least 2 elements are selected,
 *   - all selected elements share the same parent in the element tree,
 *   - none carries a `placeholderRef` (layout placeholder — not groupable).
 */
function canGroup(selectedIds: string[], slide: { elements: Element[] }): boolean {
  if (selectedIds.length < 2) return false;
  // Determine parent key for each element. '' means slide root; any other
  // string is the parent group's id.
  const parentKeyOf = (id: string): string | undefined => {
    const path = findElementPath(slide.elements, id);
    if (!path) return undefined;
    return path.length === 1 ? '' : path[path.length - 2].id;
  };
  const firstKey = parentKeyOf(selectedIds[0]);
  if (firstKey === undefined) return false;
  // All must share the same parent and carry no placeholderRef.
  for (const id of selectedIds) {
    if (parentKeyOf(id) !== firstKey) return false;
    // Check placeholderRef: find the element itself.
    const path = findElementPath(slide.elements, id);
    if (!path) return false;
    const el = path[path.length - 1];
    if (el.placeholderRef != null) return false;
  }
  return true;
}

/**
 * Returns `true` when the selection is exactly one group element that can be ungrouped.
 */
function canUngroup(selectedIds: string[], slide: { elements: Element[] }): boolean {
  if (selectedIds.length !== 1) return false;
  const path = findElementPath(slide.elements, selectedIds[0]);
  return path?.[path.length - 1]?.type === 'group';
}

/**
 * Find an element anywhere in the element tree and return it.
 * Returns `undefined` when not found (unlike `requireElement` which throws).
 */
/**
 * Sum the first `n` entries of `arr` (i.e. cumulative width / height
 * up to but excluding column / row `n`). Returns 0 when `n <= 0`.
 * Helper for `startTableEdgeResize` — its clamp + commit math needs
 * prefix sums of the original-at-pointerdown column / row sizes to
 * convert a proposed boundary position back into per-cell sizes.
 */
function sumPrefix(arr: readonly number[], n: number): number {
  let s = 0;
  for (let i = 0; i < n && i < arr.length; i++) s += arr[i];
  return s;
}

const CROP_HANDLE_KINDS: ReadonlySet<string> = new Set([
  'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w',
]);

/** Narrow a `HandleKind` to the 8 crop/resize directions. */
function isCropHandle(handle: string): handle is CropHandle {
  return CROP_HANDLE_KINDS.has(handle);
}

/** Rotation basis of a frame: world centre + cos/sin of its rotation. */
function frameRotationBasis(frame: Frame): {
  center: { x: number; y: number };
  cos: number;
  sin: number;
} {
  return {
    center: { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 },
    cos: Math.cos(frame.rotation),
    sin: Math.sin(frame.rotation),
  };
}

function findElement(elements: readonly Element[], id: string): Element | undefined {
  for (const el of elements) {
    if (el.id === id) return el;
    if (el.type === 'group') {
      const found = findElement(el.data.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Axis-aligned point-in-rect predicate. Edge-inclusive (`<=` on both
 * sides) so a click landing exactly on the inset boundary still counts
 * as "inside" — consistent with the rest of the editor's hit-test
 * helpers and matches how `getTextRegionRect` paints the region.
 */
function isPointInRect(
  px: number, py: number,
  rect: { x: number; y: number; w: number; h: number },
): boolean {
  return (
    px >= rect.x && px <= rect.x + rect.w &&
    py >= rect.y && py <= rect.y + rect.h
  );
}

/**
 * Rebuild a slide's element tree with the target shape's
 * `data.adjustments` overridden. Used by the adjustment-drag live
 * preview so a grouped shape's renderer sees the in-flight values
 * without mutating the store. Non-matching elements are aliased.
 */
function replaceShapeAdjustments(
  elements: readonly Element[],
  targetId: string,
  adjustments: number[],
): Element[] {
  const out: Element[] = [];
  for (const el of elements) {
    if (el.id === targetId && el.type === 'shape') {
      out.push({ ...el, data: { ...el.data, adjustments } });
      continue;
    }
    if (el.type === 'group') {
      out.push({
        ...el,
        data: {
          ...el.data,
          children: replaceShapeAdjustments(
            el.data.children,
            targetId,
            adjustments,
          ),
        },
      });
      continue;
    }
    out.push(el);
  }
  return out;
}

/**
 * Rebuild a slide's element tree with the in-edit element masked: a
 * text element keeps its box decorations (fill + border) but has its
 * text body cleared (and `placeholderRef` dropped so the ghost hint
 * doesn't show behind the active editor), a shape element keeps its
 * fill/stroke but has `data.text` stripped so the renderer doesn't
 * paint the body that the in-place text-box editor now owns. For a
 * table being edited at the cell level, only the targeted cell's
 * `body.blocks` is cleared — the rest of the table (fills, borders,
 * other cells' content) keeps painting. Groups are walked recursively
 * so the mask applies regardless of nesting depth. Shallow clones
 * only; block arrays are aliased.
 *
 * `liveHeight` (when non-null) overrides the edited text element's frame
 * height so the box fill/border tracks an auto-growing editor live;
 * callers pass it only for grow-eligible text edits.
 */
export function maskEditingElement(
  elements: readonly Element[],
  editingId: string,
  cellCoords: { row: number; col: number } | null,
  liveHeight: number | null = null,
): Element[] {
  const out: Element[] = [];
  for (const el of elements) {
    if (el.id === editingId) {
      if (el.type === 'shape') {
        const { text: _omit, ...rest } = el.data;
        out.push({ ...el, data: rest } as typeof el);
      } else if (el.type === 'table' && cellCoords !== null) {
        out.push(maskTableCellBody(el, cellCoords));
      } else if (el.type === 'text') {
        // Keep the box fill + border painting under the overlay editor,
        // but clear the text body so it isn't double-painted (once from
        // `drawText`, once from the editor's own `paintLayout`). Drop
        // `placeholderRef` too: with empty blocks the renderer would
        // otherwise paint the placeholder ghost hint behind the active
        // editor. Grow the frame to the live editor height when supplied
        // so the box decoration tracks an auto-growing box.
        const frame =
          liveHeight !== null
            ? { ...el.frame, h: Math.max(MIN_TEXT_BOX_H, liveHeight) }
            : el.frame;
        out.push({
          ...el,
          frame,
          placeholderRef: undefined,
          data: { ...el.data, blocks: [] },
        });
      }
      continue;
    }
    if (el.type === 'group') {
      out.push({
        ...el,
        data: {
          ...el.data,
          children: maskEditingElement(
            el.data.children,
            editingId,
            cellCoords,
            liveHeight,
          ),
        },
      });
      continue;
    }
    out.push(el);
  }
  return out;
}

/**
 * Clone a TableElement with the editing cell's body.blocks cleared so
 * the canvas underlay doesn't double-paint the text the in-place
 * editor is rendering. Cell style (fill, border, padding, vAlign) and
 * span markers are preserved verbatim — only the inline content
 * vanishes. Shallow clones at every level; sibling cells and other
 * rows alias through unchanged.
 */
function maskTableCellBody(
  table: TableElement,
  cell: { row: number; col: number },
): TableElement {
  const targetRow = table.data.rows[cell.row];
  if (!targetRow) return table;
  const targetCell = targetRow.cells[cell.col];
  if (!targetCell) return table;
  const nextCells = targetRow.cells.slice();
  nextCells[cell.col] = {
    ...targetCell,
    body: { ...targetCell.body, blocks: [] },
  };
  const nextRows = table.data.rows.slice();
  nextRows[cell.row] = { ...targetRow, cells: nextCells };
  return {
    ...table,
    data: { ...table.data, rows: nextRows },
  };
}

/**
 * Resolved inputs for a single text-edit session. Both TextElement and
 * ShapeElement-with-text take the same docs text-box mount path; this
 * descriptor papers over their per-kind differences:
 *
 * - **TextElement** — blocks live at `data.blocks`; the editor frame
 *   is the element frame; `autofit`/`verticalAnchor` come straight off
 *   `data`; on commit the frame may auto-grow to fit content.
 * - **ShapeElement** — blocks live at `data.text?.blocks` (seeded to
 *   one empty paragraph on first entry); the editor frame is the
 *   element frame inset by `SHAPE_TEXT_PADDING` so editing aligns
 *   pixel-for-pixel with the committed paint; `autofit` defaults to
 *   `'none'` (the shape frame is user-sized and does NOT auto-grow);
 *   `verticalAnchor` defaults to `'middle'` to match PowerPoint /
 *   Google Slides behavior.
 */
type EditTarget = {
  kind: 'text' | 'shape' | 'cell';
  blocks: Block[];
  autofit?: AutofitMode;
  verticalAnchor?: VerticalAnchorMode;
  editFrame: Frame;
  /** Set when `kind === 'cell'` so `onCommit` can route to withTableCellBody. */
  cell?: { row: number; col: number };
};

function buildEditTarget(element: TextElement | ShapeElement): EditTarget {
  if (element.type === 'text') {
    return {
      kind: 'text',
      blocks: element.data.blocks,
      autofit: element.data.autofit,
      verticalAnchor: element.data.verticalAnchor,
      editFrame: element.frame,
    };
  }
  const body = element.data.text;
  const innerFrame: Frame = {
    x: element.frame.x + SHAPE_TEXT_PADDING.x,
    y: element.frame.y + SHAPE_TEXT_PADDING.y,
    w: Math.max(0, element.frame.w - 2 * SHAPE_TEXT_PADDING.x),
    h: Math.max(0, element.frame.h - 2 * SHAPE_TEXT_PADDING.y),
    rotation: element.frame.rotation,
  };
  return {
    kind: 'shape',
    blocks: body?.blocks ?? [makeDefaultSlidesTextBlock()],
    autofit: body?.autofit ?? 'none',
    verticalAnchor: body?.verticalAnchor ?? 'middle',
    editFrame: innerFrame,
  };
}

/**
 * Build an EditTarget for a single cell inside a TableElement.
 *
 * `worldFrame` is the table's frame in world (slide-logical) coords —
 * already composed through any ancestor group transform by
 * `buildElementWorldLookup`. The cell's editFrame is the cell's inner
 * rect (column / row offset within the table, minus cell padding)
 * translated into world coords.
 *
 * Caller MUST resolve `(row, col)` to the merge ANCHOR via
 * `tableCellAtPoint` before calling — covered cells (gridSpan/rowSpan
 * === 0) have no body to edit and `withTableCellBody` will throw.
 *
 * Rotation: P1/P3 supports non-rotated tables only. Rotated tables
 * would need cell-center-relative re-rotation (the cell's center is
 * NOT the table's center), so this helper returns `null` when
 * `worldFrame.rotation !== 0`. Cell editing on rotated tables is
 * deferred; the dblclick path simply does nothing in that case.
 */
function buildCellEditTarget(
  table: TableElement,
  row: number,
  col: number,
  worldFrame: Frame,
  fontScale: number,
): EditTarget | null {
  if (worldFrame.rotation !== 0) return null;
  const cellRow = table.data.rows[row];
  const cell = cellRow?.cells[col];
  if (!cell) return null;
  if (cell.gridSpan === 0 || cell.rowSpan === 0) return null;

  const layout = computeTableLayout(table.data, { fontScale });
  const gridSpan = Math.min(
    Math.max(cell.gridSpan ?? 1, 1),
    table.data.columnWidths.length - col,
  );
  const rowSpan = Math.min(
    Math.max(cell.rowSpan ?? 1, 1),
    table.data.rows.length - row,
  );
  const x0 = layout.colX[col];
  const x1 = layout.colX[col + gridSpan];
  const y0 = layout.rowY[row];
  const y1 = layout.rowY[row + rowSpan];
  const pad = cellPadding(cell);

  const innerFrame: Frame = {
    x: worldFrame.x + x0 + pad.left,
    y: worldFrame.y + y0 + pad.top,
    w: Math.max(0, x1 - x0 - pad.left - pad.right),
    h: Math.max(0, y1 - y0 - pad.top - pad.bottom),
    rotation: 0,
  };

  return {
    kind: 'cell',
    blocks: cell.body.blocks.length > 0 ? cell.body.blocks : [makeDefaultSlidesTextBlock()],
    // Cell content never shrinks (the row auto-grows instead — see
    // CR#5 / slides-tables.md). 'none' mirrors what paintCellContents
    // forwards to paintTextBody at render time.
    autofit: 'none',
    verticalAnchor:
      cell.body.verticalAnchor ?? cell.style.verticalAlign ?? 'top',
    editFrame: innerFrame,
    cell: { row, col },
  };
}

function cellPadding(cell: TableCell): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  const p = cell.style.padding;
  return {
    top: p?.top ?? DEFAULT_CELL_PADDING.top,
    right: p?.right ?? DEFAULT_CELL_PADDING.right,
    bottom: p?.bottom ?? DEFAULT_CELL_PADDING.bottom,
    left: p?.left ?? DEFAULT_CELL_PADDING.left,
  };
}

/**
 * Given a hit result and the current selection scope, return the element id
 * that would be targeted at the scope level, or `null` if the hit is outside
 * the scope. This mirrors the logic inside `Selection.click` / `pickAtScope`
 * without mutating any state — used by `onPointerDown` to check whether the
 * pointer landed on an already-selected element before calling `Selection.click`.
 */
function pickScopeId(
  hit: { ancestorPath: readonly string[] },
  scope: readonly string[],
): string | null {
  if (scope.length === 0) {
    return hit.ancestorPath[0] ?? null;
  }
  for (let i = 0; i < scope.length; i++) {
    if (hit.ancestorPath[i] !== scope[i]) return null;
  }
  return hit.ancestorPath[scope.length] ?? null;
}
