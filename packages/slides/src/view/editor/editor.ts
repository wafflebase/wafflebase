import type {
  AutofitMode,
  Element,
  Frame,
  ShapeKind,
  Stroke,
  ShapeElement,
  TextElement,
  VerticalAnchorMode,
} from '../../model/element';
import type { Block } from '@wafflebase/docs';
import { DEFAULT_BLOCK_STYLE } from '@wafflebase/docs';
import { SHAPE_TEXT_PADDING } from '../canvas/shape-renderer';
import type { ThemeColor } from '../../model/theme';
import type { ConnectorElement } from '../../model/connector';
import { combinedBoundingBox, containsPoint } from '../../model/frame';
import { DEFAULT_HIT_TOLERANCE, type HitTestCtx } from './element-hit';
import { SLIDE_HEIGHT, SLIDE_WIDTH, type Slide } from '../../model/presentation';
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
import { handleHitTest, type HandleKind } from './hit-test';
import {
  buildInsertElement,
  type ShapeOrTextInsertKind,
} from './interactions/insert';
import { dragEndpoint } from './interactions/connector-endpoint-drag';
import { commitTranslate } from './interactions/drag';
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
import { resizeFrameWorld, type ResizeHandle } from './interactions/resize';
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
import { smartGuides, type SmartGuide } from './smart-guides';
import { collectSnapCandidates } from './snap-candidates';
import { toWorldFrame, fromWorldFrame, groupOverlayFrames } from './frame-space';
import { mountSlidesTextBox, type SlidesTextBoxEditor } from './text-box-editor';
import { getActiveTheme } from '../canvas/render-context';
import { makeColorResolver } from '../canvas/text-renderer';
import {
  buildElementWorldLookup,
  findElementPath,
  worldTightFrame,
} from '../../model/group';

/**
 * Connector insert-mode keys exposed by `setInsertMode`. Distinct from
 * `ShapeKind` because connectors live outside the shape registry — they
 * have endpoint-attached endpoints and their own renderer / interaction
 * pipeline. The toolbar passes one of these values; the editor's
 * `startInsert` branches on the `'connector:'` prefix to route into the
 * connector drag flow.
 */
export type ConnectorInsertKind = 'connector:line' | 'connector:arrow';

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
  return kind === 'connector:line' || kind === 'connector:arrow';
}

/** Map a connector insert-mode key to its `ConnectorInsertVariant`. */
function connectorVariant(kind: ConnectorInsertKind): ConnectorInsertVariant {
  return kind === 'connector:arrow' ? 'arrow' : 'line';
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
  /** rAF handle so rapid mousemoves coalesce into one paint per frame. */
  private hoverRenderRaf: number | null = null;
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
  private editingTextBox: SlidesTextBoxEditor | null = null;
  /**
   * Latest content height (logical px) reported by the active text-box
   * editor via onContentHeightChange. Null when not editing or when the
   * editor has not reported yet. Read at commit to fit the frame height.
   */
  private lastEditingContentHeight: number | null = null;
  /** Listeners for text-editing state changes (enter + exit). */
  private textEditingListeners = new Set<() => void>();
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
      this.renderer.markDirty();
      this.repaintOverlay();
    });
    this.keyRules = buildKeyRules({
      store: this.options.store,
      selection: this.selection,
      currentSlideId: () => this.getCurrentSlideId(),
      setCurrentSlide: (id: string) => this.setCurrentSlide(id),
      enterEditMode: (slideId: string, elementId: string) =>
        this.enterEditMode(slideId, elementId),
      requestRender: () => this.requestRender(),
      onStartPresentation: this.options.onStartPresentation,
      onShowShortcutsHelp: this.options.onShowShortcutsHelp,
      getInsertMode: () => this.getInsertMode(),
      setInsertMode: (kind) => this.setInsertMode(kind),
      group: () => this.group(),
      ungroup: () => this.ungroup(),
      isPaintingFormat: () => this.isPaintingFormat(),
      cancelFormatPaint: () => this.cancelFormatPaint(),
    });
    // Read-only mounts (viewer-role share links) skip every pointer +
    // keyboard binding. The renderer still paints, including remote
    // peer edits, but the user cannot mutate. The editor's
    // programmatic surface (`setCurrentSlide`, `markDirty`, etc.) keeps
    // working so the host shell can drive navigation.
    if (!options.readOnly) {
      this.attachInteractions();
    }
  }

  private requestRender(): void {
    this.renderer.markDirty();
    this.render();
    this.repaintOverlay();
  }

  private repaintOverlay(): void {
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
    renderOverlay(this.options.overlay, selected, {
      scale: this.scale(),
      slideWidth: SLIDE_WIDTH,
      slideHeight: SLIDE_HEIGHT,
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
    // body gets stripped. Cloning is structural-only (no deep block
    // copy) so this stays cheap on every frame.
    if (this.editingElementId !== null) {
      const editingId = this.editingElementId;
      const visible = {
        ...slide,
        elements: slide.elements
          .map((e) => {
            if (e.id !== editingId) return e;
            if (e.type === 'shape') {
              const { text: _omit, ...rest } = e.data;
              return { ...e, data: rest } as typeof e;
            }
            return null;
          })
          .filter((e): e is Element => e !== null),
      };
      this.renderer.forceRender(visible, doc);
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
    const hit = hitTestSlide(slide, x, y, this.hitOptions());
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

  detach(): void {
    this.disposed = true;
    if (this.editingTextBox !== null) {
      this.editingTextBox.detach();
      this.editingTextBox = null;
      this.editingElementId = null;
    }
    // A pending hover-ghost rAF would otherwise fire after teardown
    // and paint into a detached canvas. Cancel it and drop the
    // preview state so a remount starts clean.
    if (this.hoverRenderRaf !== null) {
      cancelAnimationFrame(this.hoverRenderRaf);
      this.hoverRenderRaf = null;
    }
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
    const hitResult = hitTestSlide(slide, x, y, this.hitOptions());
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
    if (selectedIds.length === 1 && slide) {
      const el = slide.elements.find((e) => e.id === selectedIds[0]);
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
      { label: '---', run: () => undefined },
      { label: 'Bring forward',  run: () => this.dispatchKey('ArrowUp',   { meta: true }) },
      { label: 'Send backward',  run: () => this.dispatchKey('ArrowDown', { meta: true }) },
      { label: 'Bring to front', run: () => this.dispatchKey('ArrowUp',   { meta: true, shift: true }) },
      { label: 'Send to back',   run: () => this.dispatchKey('ArrowDown', { meta: true, shift: true }) },
    ];
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
    const hitResult = hitTestSlide(slide, x, y, this.hitOptions());
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
      if (!mods.shift && scopeId !== null && this.selection.has(scopeId)) {
        this.startDrag(e.clientX, e.clientY);
        return;
      }
      const beforeScope = this.selection.getScope();
      this.selection.click(hitResult, mods);
      const afterScope = this.selection.getScope();
      this.refitPoppedScope(beforeScope, afterScope, slide.id);
      // Begin drag on the (possibly newly-)selected elements unless the
      // element was just removed by shift-toggle.
      if (this.selection.get().length > 0) {
        this.startDrag(e.clientX, e.clientY);
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
    const slide = this.currentSlide();
    if (!slide) return;
    const { x, y } = this.clientToLogical(e.clientX, e.clientY);
    const hitResult = hitTestSlide(slide, x, y, this.hitOptions());
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
    if (!el || (el.type !== 'text' && el.type !== 'shape')) return;
    e.preventDefault();
    e.stopPropagation();
    this.enterEditMode(slide.id, el.id);
  }

  private enterEditMode(slideId: string, elementId: string): void {
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
    const element = slide.elements.find((e) => e.id === elementId);
    if (!element || (element.type !== 'text' && element.type !== 'shape')) {
      return;
    }

    // Build a small descriptor that papers over the difference between
    // editing a TextElement (text in `data.blocks`, frame auto-grows to
    // fit content) and a ShapeElement (text in `data.text.blocks`,
    // frame is user-sized and does NOT auto-grow into the text). All
    // the wiring below works off `target` so the two kinds stay aligned.
    const target = buildEditTarget(element);

    // Frame height at entry; the committed fit only writes when the
    // content height differs from this (text-element only; shapes skip
    // the post-commit frame fit). Reset the per-edit tracker so a stale
    // height from a previous edit can't leak into this commit.
    const enterFrameH = element.frame.h;
    this.lastEditingContentHeight = null;

    // Make sure the selection is on the editing element so the rest of
    // the editor (toolbar etc.) reflects the active target.
    this.selection.set([elementId]);
    this.editingElementId = elementId;
    // Drop any stale hover-move cursor; once text-edit owns the box,
    // the next pointermove path early-returns without touching cursor.
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
      // Shapes keep the editor canvas at the inner-frame height so the
      // middle vertical anchor in the editor agrees with the renderer's
      // middle anchor inside the original frame. Without this the docs
      // editor would shrink the canvas to text height and anchor at
      // originY=0, producing a visible jump between edit and committed
      // positions. Text elements keep the default auto-grow behavior.
      growMode: target.kind === 'shape' ? 'never' : 'auto',
      // Mirror the slide canvas offset so in-place editing keeps the
      // caret and text glyphs aligned with the committed render.
      verticalAnchor: target.verticalAnchor,
      colorResolver: makeColorResolver(getActiveTheme(doc)),
      onLinkRequest: this.options.onLinkRequest,
      onContentHeightChange: (h: number): void => {
        this.lastEditingContentHeight = h;
      },
      onCommit: (next) => {
        // Persist via the kind-appropriate bridge and exit edit mode.
        // We snapshot the slide id at enter-time because the user could
        // have switched slides during editing.
        if (!cancelled) {
          try {
            this.options.store.batch(() => {
              if (target.kind === 'text') {
                this.options.store.withTextElement(slideId, elementId, () => next);
                // Fit the frame height to the content in the SAME batch
                // as the text write — one undo entry, no per-keystroke
                // churn. Shapes keep their authored frame; skip the fit.
                const h = this.lastEditingContentHeight;
                if (h !== null) {
                  const targetH = Math.max(MIN_TEXT_BOX_H, h);
                  if (targetH !== enterFrameH) {
                    this.options.store.updateElementFrame(slideId, elementId, { h: targetH });
                  }
                }
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

  private finishEditMode(): void {
    const tb = this.editingTextBox;
    this.editingTextBox = null;
    this.editingElementId = null;
    this.lastEditingContentHeight = null;
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
    if (kind === null || kind === 'text') return;
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
    if (this.insertKind !== null) return;
    if (this.editingElementId !== null) return;
    if (this.handleAtClient(e.clientX, e.clientY) !== null) return;

    let desired = '';
    if (this.isPointerOverSelected(e.clientX, e.clientY)) {
      desired = 'move';
    } else {
      const { x, y } = this.clientToLogical(e.clientX, e.clientY);
      const guide = hitTestGuide(this.options.store.read().guides, { x, y });
      if (guide !== null) {
        desired = guide.axis === 'x' ? 'col-resize' : 'row-resize';
      }
    }
    if (this.lastHoverCursor === desired) return;
    this.lastHoverCursor = desired;
    this.options.canvas.style.cursor = desired;
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

  private startDrag(clientX: number, clientY: number): void {
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

    const onMove = (ev: MouseEvent) => {
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
      const guides: (SnapGuide | SmartGuide)[] = [...snapped.guides, ...smart.guides];
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

      this.paintMoveGhost(ghosts, handleElements, guides);
    };
    const onUp = (_ev: MouseEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
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
      // Clear lingering snap-guide nodes from the last `paintMoveGhost`.
      this.repaintOverlay();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  /**
   * Scope-aware live paint. `worldFrames` holds the current world-space
   * frames for each selected element id (regardless of scope depth).
   *
   * The canvas renderer gets a synthetic slide whose element tree has
   * LOCAL frames updated in-place (via `patchElementFrames`) so that
   * groups render their children correctly during the drag preview.
   *
   * The overlay gets elements with their WORLD frames so that selection
   * handles appear at the positions the user actually sees, not at the
   * raw stored (group-local) positions.
   *
   * Connectors are a special case: their `frame` is derived from
   * world-coord endpoints, so patching the frame doesn't move the
   * rendered line. The line therefore stays at its pre-drag position
   * while the user is dragging — the overlay handles still translate
   * to the live frame so the user has visible feedback that the
   * connector will move on commit.
   */
  private paintLiveScoped(
    worldFrames: Map<string, Frame>,
    scope: readonly string[],
    guides: readonly SnapGuide[] = [],
  ): void {
    const slide = this.currentSlide();
    if (!slide) return;

    // Build a map of id → local frame for the canvas renderer.
    const localFrames = new Map<string, Frame>();
    for (const [id, worldFrame] of worldFrames) {
      localFrames.set(id, fromWorldFrame(worldFrame, scope, slide));
    }

    const synthetic = {
      ...slide,
      elements: patchElementFrames(slide.elements, localFrames),
    };
    this.renderer.forceRender(synthetic, this.options.store.read());

    // Build pseudo-elements with world frames for the overlay so handles
    // are placed at the correct visual positions.
    const selectedWorldElements = Array.from(worldFrames.entries()).map(([id, wf]) => {
      const el = findElement(slide.elements, id);
      if (!el) return null;
      return { ...el, frame: wf } as Element;
    }).filter((e): e is Element => e !== null);

    renderOverlay(this.options.overlay, selectedWorldElements, {
      scale: this.scale(),
      slideWidth: SLIDE_WIDTH,
      slideHeight: SLIDE_HEIGHT,
      guides,
      allElements: synthetic.elements,
      connectorAffordance: this.connectorAffordance(),
      permanentGuides: this.options.store.read().guides,
      pendingGuide: this.pendingGuide,
    });
  }

  /**
   * Drag-move preview: paint the slide unchanged + a translucent ghost
   * of each selected element at its dragged position. Overlay handles
   * render against the **original** frames so they stay anchored to the
   * starting position (the user reads the ghost as "where it will land"
   * and the handles as "where it started").
   *
   * Connectors are excluded from `ghosts` for v1; they keep rendering
   * at their original endpoints during the drag preview. On commit, the
   * connector's normal endpoint-lookup path re-routes them.
   */
  private paintMoveGhost(
    ghosts: readonly Element[],
    selectedOriginals: readonly Element[],
    guides: readonly (SnapGuide | SmartGuide)[] = [],
  ): void {
    const slide = this.currentSlide();
    if (!slide) return;
    this.renderer.forceRender(slide, this.options.store.read(), ghosts);
    renderOverlay(this.options.overlay, selectedOriginals, {
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

  private currentSlide() {
    const id = this.currentId;
    if (!id) return undefined;
    return this.options.store.read().slides.find((s) => s.id === id);
  }

  private clientToLogical(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.options.canvas.getBoundingClientRect();
    const scale = this.scale();
    return {
      x: (clientX - rect.left) / scale,
      y: (clientY - rect.top) / scale,
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
    const startEl = startSlide.elements.find((e) => e.id === elementId);
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

  private paintLiveAdjustments(elementId: string, adjustments: number[]): void {
    // Render a synthetic slide where the target shape's data has the live
    // adjustments applied. Mirrors paintLive but overrides element data
    // instead of frame, using the same forceRender pattern.
    const slide = this.currentSlide();
    if (!slide) return;
    const synthetic = {
      ...slide,
      elements: slide.elements.map((el) => {
        if (el.id !== elementId || el.type !== 'shape') return el;
        return { ...el, data: { ...el.data, adjustments } };
      }),
    };
    this.renderer.forceRender(synthetic, this.options.store.read());
    // Repaint overlay so adjustment handles follow the live shape.
    const selected = synthetic.elements.filter((e) => this.selection.has(e.id));
    renderOverlay(this.options.overlay, selected, {
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
    const showTooltip = (clientPx: number, clientPy: number, delta: number) => {
      const rect = this.options.overlay.getBoundingClientRect();
      const localX = clientPx - rect.left;
      const localY = clientPy - rect.top;
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

    const onMove = (ev: MouseEvent) => {
      const cur = this.clientToLogical(ev.clientX, ev.clientY);
      const angle = Math.atan2(cur.y - pivotY, cur.x - pivotX);
      liveDelta = applyRotate(0, startAngle, angle, ev.shiftKey);
      const { ghosts } = buildLiveState(liveDelta);
      this.paintMoveGhost(ghosts, handleElements);
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
    if (this.rotateTooltipEl) {
      this.rotateTooltipEl.style.display = 'block';
      return this.rotateTooltipEl;
    }
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
    if (selectedIds.length !== 1) return; // multi-resize is a v2 polish item
    const elementId = selectedIds[0];
    const startEl = findElement(startSlide.elements, elementId);
    if (!startEl) return;
    // Migrate legacy groups that pre-date the refSize field BEFORE the
    // drag begins, so the live preview also reflects proportional child
    // scaling (otherwise refSize would still be undefined while paintLive
    // is running, and only the post-commit render would scale).
    if (startEl.type === 'group' && startEl.data.refSize === undefined) {
      const captured = { w: startEl.frame.w, h: startEl.frame.h };
      this.options.store.batch(() => {
        this.options.store.updateElementData(startSlide.id, elementId, {
          refSize: captured,
        });
      });
    }
    // Resize operates in world space so the handles stay fixed in the
    // positions the user sees. Convert the stored local frame to world
    // for all delta math, then convert back at commit time.
    const startWorldFrame = toWorldFrame(startEl.frame, scope, startSlide);
    const start = this.clientToLogical(clientX, clientY);
    const live = { worldFrame: startWorldFrame };

    const onMove = (ev: MouseEvent) => {
      const cur = this.clientToLogical(ev.clientX, ev.clientY);
      const dx = cur.x - start.x;
      const dy = cur.y - start.y;
      live.worldFrame = resizeFrameWorld(startWorldFrame, handle, dx, dy, ev.shiftKey);
      const livMap = new Map<string, Frame>([[elementId, live.worldFrame]]);
      this.paintLiveScoped(livMap, scope);
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      // Convert world frame back to scope-local before committing.
      const localFrame = fromWorldFrame(live.worldFrame, scope, startSlide);
      this.options.store.batch(() => {
        this.options.store.updateElementFrame(startSlide.id, elementId, localFrame);
      });
      this.renderer.markDirty();
      this.render();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
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
 * Recursively patch `elements` so that any element whose id appears in
 * `frames` gets its frame replaced. Returns a shallow copy of the array
 * (and a shallow copy of any group whose children were patched).
 *
 * WHY: `paintLive` builds a synthetic slide for the canvas renderer.
 * The canvas renderer handles group hierarchies natively (Task 5), so
 * we must update frames at the correct depth rather than just patching
 * the top-level array. Without this, dragging a drilled-in child would
 * show no movement on the canvas during the drag preview.
 */
function patchElementFrames(
  elements: readonly Element[],
  frames: ReadonlyMap<string, Frame>,
): Element[] {
  return elements.map((el) => {
    if (frames.has(el.id)) {
      return { ...el, frame: frames.get(el.id)! };
    }
    if (el.type === 'group') {
      const patched = patchElementFrames(el.data.children, frames);
      // Only re-create the group object when something inside actually changed
      // (reference equality check on the first changed child is sufficient
      // because `patchElementFrames` always returns new arrays when patching).
      const changed = patched.some((c, i) => c !== el.data.children[i]);
      if (changed) {
        return { ...el, data: { ...el.data, children: patched } };
      }
    }
    return el;
  });
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
  kind: 'text' | 'shape';
  blocks: Block[];
  autofit?: AutofitMode;
  verticalAnchor?: VerticalAnchorMode;
  editFrame: Frame;
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
    blocks: body?.blocks ?? [emptyShapeTextBlock()],
    autofit: body?.autofit ?? 'none',
    verticalAnchor: body?.verticalAnchor ?? 'middle',
    editFrame: innerFrame,
  };
}

/**
 * Seed block for a shape whose `data.text` is absent at edit-entry.
 * Mirrors the seed `buildInsertElement` writes for a fresh text element
 * — fully-populated `style` so `computeLayout` reads non-undefined
 * `marginTop` / `marginBottom`, and an inline bound to the deck's
 * `text` color role so newly-typed runs inherit the theme (matches
 * `interactions/insert.ts`'s text-element seed exactly).
 */
function emptyShapeTextBlock(): Block {
  return {
    id: 'placeholder',
    type: 'paragraph',
    inlines: [{ text: '', style: { color: SHAPE_TEXT_SEED_COLOR } }],
    style: { ...DEFAULT_BLOCK_STYLE },
  } as Block;
}

const SHAPE_TEXT_SEED_COLOR = { kind: 'role' as const, role: 'text' as const };

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
