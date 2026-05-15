import type { Element, Frame, ShapeKind } from '../../model/element';
import { combinedBoundingBox, containsPoint } from '../../model/frame';
import { SLIDE_HEIGHT, SLIDE_WIDTH, type Slide } from '../../model/presentation';
import type { SlidesStore } from '../../store/store';
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
import {
  buildConnectorInit,
  finalizeInsert as finalizeConnectorInsert,
  type ConnectorInsertVariant,
} from './interactions/insert-connector';
import { buildKeyRules } from './interactions/keyboard';
import { selectAt } from './interactions/select';
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
import { Selection } from './selection';
import { snapDelta, type SnapGuide } from './snap';
import { mountSlidesTextBox, type SlidesTextBoxEditor } from './text-box-editor';

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
   * text uses a single-click insert at fixed size, no preview needed.
   */
  private hoverPreview: { kind: ShapeKind; x: number; y: number } | null = null;
  /** rAF handle so rapid mousemoves coalesce into one paint per frame. */
  private hoverRenderRaf: number | null = null;
  /** Suppress hover ghost during an active drag-to-size insert. */
  private insertDragging = false;
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

  constructor(options: SlidesEditorOptions) {
    this.options = options;
    const ctx = options.canvas.getContext('2d');
    if (!ctx) throw new Error('SlidesEditor: canvas has no 2D context');
    this.renderer = new SlideRenderer(ctx, options);
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
    });
    this.attachInteractions();
  }

  private requestRender(): void {
    this.renderer.markDirty();
    this.render();
    this.repaintOverlay();
  }

  private repaintOverlay(): void {
    const slide = this.currentSlide();
    if (!slide) {
      renderOverlay(this.options.overlay, [], {
        scale: this.scale(),
        slideWidth: SLIDE_WIDTH,
        slideHeight: SLIDE_HEIGHT,
      });
      this.reattachEditingTextBox();
      return;
    }
    // Suppress selection handles for the element currently in edit
    // mode — the text-box editor takes over the visual frame, and
    // overlapping handles would intercept clicks meant for the editor.
    const selected = slide.elements.filter(
      (e) => this.selection.has(e.id) && e.id !== this.editingElementId,
    );
    renderOverlay(this.options.overlay, selected, {
      scale: this.scale(),
      slideWidth: SLIDE_WIDTH,
      slideHeight: SLIDE_HEIGHT,
    });
    // renderOverlay clears `overlay.innerHTML` on every call, which
    // would also unmount the text-box container. Re-append it after
    // the overlay rebuild so the editor stays visible.
    this.reattachEditingTextBox();
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
    if (!slide) return;
    // Hide the element currently in edit mode from the slide canvas —
    // the text-box editor's own canvas is layered on top of the same
    // frame, so leaving the element in the slide pass would double-paint
    // the text (one copy from `drawText`, one from the editor's
    // `paintLayout`).
    if (this.editingElementId !== null) {
      const editingId = this.editingElementId;
      const visible = {
        ...slide,
        elements: slide.elements.filter((e) => e.id !== editingId),
      };
      this.renderer.forceRender(visible, doc);
      return;
    }
    this.renderer.render(slide, doc);
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

  /**
   * Collect frames for currently-selected elements that still exist on
   * the given slide. Defends against ids that were removed remotely
   * between selection and the toolbar action.
   */
  private collectSelectedFrames(slide: { elements: Element[] }): Map<string, Frame> {
    const selectedIds = new Set(this.selection.get());
    const result = new Map<string, Frame>();
    for (const el of slide.elements) {
      if (selectedIds.has(el.id)) result.set(el.id, el.frame);
    }
    return result;
  }

  /**
   * Commit a set of frame updates in a single store.batch so undo/redo
   * treats them atomically, then mark dirty + render. Empty `updates`
   * is a no-op (skips the empty batch).
   */
  private applyFrameUpdates(slideId: string, updates: ReadonlyMap<string, Frame>): void {
    if (updates.size === 0) return;
    this.options.store.batch(() => {
      for (const [id, frame] of updates) {
        this.options.store.updateElementFrame(slideId, id, frame);
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

  markDirty(): void {
    this.renderer.markDirty();
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
    for (const { target, type, handler } of this.listeners) {
      target.removeEventListener(type, handler as EventListener);
    }
    this.listeners.length = 0;
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
    this.on(this.options.canvas, 'mousedown', onMouseDown);
    this.on(this.options.overlay, 'mousedown', onMouseDown);
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
    const onMove = (e: Event) => this.onInsertHoverMove(e as MouseEvent);
    const onLeave = () => this.onInsertHoverLeave();
    this.on(this.options.canvas, 'mousemove', onMove);
    this.on(this.options.canvas, 'mouseleave', onLeave);
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
  }

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    this.lastContextX = e.clientX;
    this.lastContextY = e.clientY;
    const slide = this.currentSlide();
    if (!slide) return;
    const { x, y } = this.clientToLogical(e.clientX, e.clientY);
    const hit = topmostUnderPoint(slide, x, y);
    const items = hit !== null
      ? this.elementContextItems(slide.id, hit)
      : this.canvasContextItems(x, y);
    showContextMenu(document.body, items, e.clientX, e.clientY);
  }

  private elementContextItems(
    slideId: string,
    elementId: string,
  ): ContextMenuItem[] {
    // Ensure the right-clicked element is selected — matches user
    // expectation that the action targets what they clicked on.
    if (!this.selection.has(elementId)) this.selection.set([elementId]);

    return [
      { label: 'Copy',  run: () => this.dispatchKey('c', { meta: true }) },
      { label: 'Cut',   run: () => this.dispatchKey('x', { meta: true }) },
      { label: 'Paste', run: () => this.dispatchKey('v', { meta: true }) },
      { label: '---', run: () => undefined },
      { label: 'Duplicate', run: () => this.dispatchKey('d', { meta: true }) },
      { label: 'Delete',    run: () => {
        this.options.store.batch(() =>
          this.options.store.removeElements(slideId, [...this.selection.get()]),
        );
        this.selection.clear();
        this.requestRender();
      } },
      { label: '---', run: () => undefined },
      { label: 'Bring forward',  run: () => this.dispatchKey('ArrowUp',   { meta: true }) },
      { label: 'Send backward',  run: () => this.dispatchKey('ArrowDown', { meta: true }) },
      { label: 'Bring to front', run: () => this.dispatchKey('ArrowUp',   { meta: true, shift: true }) },
      { label: 'Send to back',   run: () => this.dispatchKey('ArrowDown', { meta: true, shift: true }) },
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

    // Hit-test against an element first.
    const hit = topmostUnderPoint(slide, x, y);
    if (hit !== null) {
      const mods = { shift: e.shiftKey };
      const next = selectAt(slide, x, y, mods, this.selection.get());
      this.selection.set(next);
      // Begin drag on the (possibly newly-)selected elements unless the
      // element was just removed by shift-toggle.
      if (this.selection.has(hit)) {
        this.startDrag(e.clientX, e.clientY);
      }
      return;
    }

    // Empty canvas — start a lasso unless shift is held (which would be
    // an additive no-op per the spec).
    if (e.shiftKey) {
      return;
    }
    this.startLasso(e.clientX, e.clientY);
  }

  private onDoubleClick(e: MouseEvent): void {
    // Double-click on a text element enters edit mode. Clicks on
    // non-text elements are ignored (shape/image have no inline
    // editing in v1).
    const slide = this.currentSlide();
    if (!slide) return;
    const { x, y } = this.clientToLogical(e.clientX, e.clientY);
    const hit = topmostUnderPoint(slide, x, y);
    if (hit === null) return;
    const element = slide.elements.find((el) => el.id === hit);
    if (!element || element.type !== 'text') return;
    e.preventDefault();
    e.stopPropagation();
    this.enterEditMode(slide.id, element.id);
  }

  private enterEditMode(slideId: string, elementId: string): void {
    // If we're already editing some other text-box, commit it first so
    // the text in flight is not lost when focus moves.
    if (this.editingElementId !== null) {
      this.exitEditMode('commit');
    }
    const slide = this.options.store.read().slides.find((s) => s.id === slideId);
    if (!slide) return;
    const element = slide.elements.find((e) => e.id === elementId);
    if (!element || element.type !== 'text') return;

    // Make sure the selection is on the editing element so the rest of
    // the editor (toolbar etc.) reflects the active target.
    this.selection.set([elementId]);
    this.editingElementId = elementId;

    const blocks = element.data.blocks;
    // Escape sets `cancelled` first, THEN the docs editor routes the
    // blur cascade through the onCommit branch below. The flag tells
    // onCommit to skip the store write so the user's in-flight edits
    // are discarded — matching the Word / Google Docs convention. The
    // editor's source of truth (Yorkie) is only ever touched on
    // commit, so "discard" is just "don't write" — no rollback needed.
    let cancelled = false;
    const tb = this.mountTextBox({
      overlay: this.options.overlay,
      frame: element.frame,
      scale: this.scale(),
      blocks,
      onLinkRequest: this.options.onLinkRequest,
      onCommit: (next) => {
        // Persist via withTextElement and exit edit mode. We snapshot
        // the slide id at enter-time because the user could have
        // switched slides during editing — withTextElement only
        // resolves on the slide we actually edited.
        if (!cancelled) {
          try {
            this.options.store.batch(() => {
              this.options.store.withTextElement(slideId, elementId, () => next);
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
   * armed (text uses a single-click insert and has no useful ghost),
   * or while a drag-to-size insert is already in flight (the live
   * drag preview from `startInsert` takes over rendering).
   */
  private onInsertHoverMove(e: MouseEvent): void {
    const kind = this.insertKind;
    if (kind === null || kind === 'text') return;
    // Connector insert modes have no shape-style hover ghost: the
    // connection-points overlay (Task 13) handles their hover affordance,
    // and the live drag preview takes over after mousedown.
    if (isConnectorInsertKind(kind)) return;
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

  /** Cursor left the canvas — drop the ghost and repaint cleanly. */
  private onInsertHoverLeave(): void {
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
    this.renderer.forceRender(slide, this.options.store.read(), ghost);
  }

  private startInsert(clientX: number, clientY: number): void {
    const kind = this.insertKind;
    if (kind === null) return;
    const slide = this.currentSlide();
    if (!slide) return;
    const start = this.clientToLogical(clientX, clientY);

    if (kind === 'text') {
      // Single-click insert.
      const init = buildInsertElement('text', start, start);
      this.options.store.batch(() => {
        const id = this.options.store.addElement(slide.id, init);
        this.selection.set([id]);
      });
      this.setInsertMode(null);
      this.renderer.markDirty();
      this.render();
      return;
    }

    if (isConnectorInsertKind(kind)) {
      this.startConnectorInsert(kind, slide, start);
      return;
    }

    // Drag-to-size for shapes. Mark insertDragging so the hover-ghost
    // listener stops repainting; the drag preview below owns the
    // canvas until mouseup. The preview is rendered through the same
    // `forceRender(slide, doc, ghost)` channel as the hover ghost so
    // the in-progress shape stays semi-transparent — the user can see
    // any underlying content while sizing, and the commit on mouseup
    // is the moment the shape goes opaque.
    this.insertDragging = true;
    this.hoverPreview = null;
    let endPoint = start;
    let cancelled = false;
    const onMove = (ev: MouseEvent) => {
      endPoint = this.clientToLogical(ev.clientX, ev.clientY);
      const init = buildInsertElement(kind, start, endPoint);
      const ghost = { ...init, id: '__preview__' } as Element;
      this.renderer.forceRender(slide, this.options.store.read(), ghost);
    };
    const cleanup = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
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
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('keydown', onKey, true);
  }

  /**
   * Drag-to-place flow for connectors. Mirrors `startInsert`'s shape
   * branch: live ghost preview during the drag (rendered via the same
   * `forceRender(slide, doc, ghost)` channel), commit on mouseup,
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
    const onMove = (ev: MouseEvent) => {
      endPoint = this.clientToLogical(ev.clientX, ev.clientY);
      const init = buildConnectorInit(variant, start, endPoint, slide.elements);
      const ghost = { ...init, id: '__preview__' } as Element;
      this.renderer.forceRender(slide, this.options.store.read(), ghost);
    };
    const cleanup = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keydown', onKey, true);
      this.insertDragging = false;
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
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
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
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
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
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  private startDrag(clientX: number, clientY: number): void {
    const startSlide = this.currentSlide();
    if (!startSlide) return;
    const selectedIds = new Set(this.selection.get());
    const originalFrames = new Map<string, Frame>();
    for (const el of startSlide.elements) {
      if (selectedIds.has(el.id)) originalFrames.set(el.id, { ...el.frame });
    }
    if (originalFrames.size === 0) return;

    const start = this.clientToLogical(clientX, clientY);
    const otherFrames = startSlide.elements
      .filter((e) => !selectedIds.has(e.id))
      .map((e) => e.frame);

    // Track dragged frames in memory; commit once at mouseup.
    const live = new Map(originalFrames);

    const onMove = (ev: MouseEvent) => {
      const cur = this.clientToLogical(ev.clientX, ev.clientY);
      const rawDx = cur.x - start.x;
      const rawDy = cur.y - start.y;
      const bbox = combinedBoundingBox(Array.from(originalFrames.values()))!;
      const { dx, dy, guides } = snapDelta(bbox, rawDx, rawDy, otherFrames, { w: SLIDE_WIDTH, h: SLIDE_HEIGHT });

      for (const [id, base] of originalFrames) {
        live.set(id, { ...base, x: base.x + dx, y: base.y + dy });
      }
      // Repaint canvas + overlay with the live frames; we DO NOT touch
      // the store yet. `guides` flow through to the overlay so magenta
      // alignment lines render alongside the selection handles.
      this.paintLive(live, guides);
    };
    const onUp = (_ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      // Commit one batch with the final frames.
      const slideId = startSlide.id;
      this.options.store.batch(() => {
        for (const [id, frame] of live) {
          this.options.store.updateElementFrame(slideId, id, frame);
        }
      });
      this.renderer.markDirty();
      this.render();
      // `render()` repaints only the canvas — without an explicit overlay
      // refresh, the magenta guide nodes from the last `paintLive` would
      // persist after mouseup. `repaintOverlay()` rebuilds the overlay
      // with `selected` and no `guides`, clearing them.
      this.repaintOverlay();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  private paintLive(live: Map<string, Frame>, guides: readonly SnapGuide[] = []): void {
    // Render a synthesised slide where the selected elements use their
    // live frames. We bypass the store so each mousemove is one paint,
    // not one Yorkie op.
    const slide = this.currentSlide();
    if (!slide) return;
    const synthetic = {
      ...slide,
      elements: slide.elements.map((el) =>
        live.has(el.id) ? { ...el, frame: live.get(el.id)! } : el,
      ),
    };
    this.renderer.forceRender(synthetic, this.options.store.read());
    // Repaint overlay against the live frames so handles follow.
    const selected = synthetic.elements.filter((e) => this.selection.has(e.id));
    renderOverlay(this.options.overlay, selected, {
      scale: this.scale(),
      slideWidth: SLIDE_WIDTH,
      slideHeight: SLIDE_HEIGHT,
      guides,
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

  private handleAtClient(clientX: number, clientY: number): HandleKind | null {
    const rect = this.options.overlay.getBoundingClientRect();
    return handleHitTest(
      this.options.overlay,
      clientX - rect.left,
      clientY - rect.top,
    );
  }

  private onPointerDownHandle(handle: HandleKind, clientX: number, clientY: number): void {
    if (handle === 'rotate') {
      this.startRotate(clientX, clientY);
      return;
    }
    if (handle.startsWith('adjust-')) {
      const handleIndex = parseInt(handle.slice('adjust-'.length), 10);
      this.startAdjustmentDrag(handleIndex, clientX, clientY);
      return;
    }
    this.startResize(handle as ResizeHandle, clientX, clientY);
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
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
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
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
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
    });
  }

  private startRotate(clientX: number, clientY: number): void {
    const startSlide = this.currentSlide();
    if (!startSlide) return;
    const selectedIds = this.selection.get();
    if (selectedIds.length !== 1) return; // single-element only in v1
    const elementId = selectedIds[0];
    const startEl = startSlide.elements.find((e) => e.id === elementId);
    if (!startEl) return;
    const startRotation = startEl.frame.rotation;
    const cx = startEl.frame.x + startEl.frame.w / 2;
    const cy = startEl.frame.y + startEl.frame.h / 2;
    const start = this.clientToLogical(clientX, clientY);
    const startAngle = Math.atan2(start.y - cy, start.x - cx);
    let liveRotation = startRotation;

    const onMove = (ev: MouseEvent) => {
      const cur = this.clientToLogical(ev.clientX, ev.clientY);
      const angle = Math.atan2(cur.y - cy, cur.x - cx);
      liveRotation = applyRotate(startRotation, startAngle, angle, ev.shiftKey);
      const liveFrame: Frame = { ...startEl.frame, rotation: liveRotation };
      this.paintLive(new Map([[elementId, liveFrame]]));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      this.options.store.batch(() => {
        this.options.store.updateElementFrame(startSlide.id, elementId, { rotation: liveRotation });
      });
      this.renderer.markDirty();
      this.render();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  private startResize(handle: ResizeHandle, clientX: number, clientY: number): void {
    const startSlide = this.currentSlide();
    if (!startSlide) return;
    const selectedIds = this.selection.get();
    if (selectedIds.length !== 1) return; // multi-resize is a v2 polish item
    const elementId = selectedIds[0];
    const startEl = startSlide.elements.find((e) => e.id === elementId);
    if (!startEl) return;
    const startFrame = { ...startEl.frame };
    const start = this.clientToLogical(clientX, clientY);
    const live = { frame: startFrame };

    const onMove = (ev: MouseEvent) => {
      const cur = this.clientToLogical(ev.clientX, ev.clientY);
      const dx = cur.x - start.x;
      const dy = cur.y - start.y;
      live.frame = resizeFrameWorld(startFrame, handle, dx, dy, ev.shiftKey);
      const livMap = new Map<string, Frame>([[elementId, live.frame]]);
      this.paintLive(livMap);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      this.options.store.batch(() => {
        this.options.store.updateElementFrame(startSlide.id, elementId, live.frame);
      });
      this.renderer.markDirty();
      this.render();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
}

export function initialize(options: SlidesEditorOptions): SlidesEditor {
  const editor = new SlidesEditorImpl(options);
  editor.render();
  return editor;
}

function topmostUnderPoint(slide: { elements: { id: string; frame: Frame }[] }, x: number, y: number): string | null {
  for (let i = slide.elements.length - 1; i >= 0; i--) {
    if (containsPoint(slide.elements[i].frame, x, y)) {
      return slide.elements[i].id;
    }
  }
  return null;
}
