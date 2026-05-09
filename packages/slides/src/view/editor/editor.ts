import type { Element, Frame, ShapeKind } from '../../model/element';
import { combinedBoundingBox, containsPoint } from '../../model/frame';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../model/presentation';
import type { SlidesStore } from '../../store/store';
import { SlideRenderer, type SlideRendererOptions } from '../canvas/slide-renderer';
import { showContextMenu, type ContextMenuItem } from './context-menu';
import { handleHitTest, type HandleKind } from './hit-test';
import { buildInsertElement } from './interactions/insert';
import { buildKeyRules } from './interactions/keyboard';
import { selectAt } from './interactions/select';
import { normalizeRect, selectInRect } from './interactions/lasso';
import { resizeFrameWorld, type ResizeHandle } from './interactions/resize';
import { applyRotate } from './interactions/rotate';
import { runKeyRules, type KeyRule } from './keymap';
import { showLayoutPicker } from './layout-picker';
import { renderOverlay } from './overlay';
import { Selection } from './selection';
import { snapDelta } from './snap';
import { mountSlidesTextBox, type SlidesTextBoxEditor } from './text-box-editor';

export type InsertKind = ShapeKind | 'text';

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
      requestRender: () => this.requestRender(),
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
      renderOverlay(this.options.overlay, [], { scale: this.scale() });
      this.reattachEditingTextBox();
      return;
    }
    // Suppress selection handles for the element currently in edit
    // mode — the text-box editor takes over the visual frame, and
    // overlapping handles would intercept clicks meant for the editor.
    const selected = slide.elements.filter(
      (e) => this.selection.has(e.id) && e.id !== this.editingElementId,
    );
    renderOverlay(this.options.overlay, selected, { scale: this.scale() });
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

  setInsertMode(kind: InsertKind | null): void {
    if (this.insertKind === kind) return;
    this.insertKind = kind;
    // T7 wires this to a cursor change + canvas pointerdown handler.
    for (const cb of this.insertModeListeners) cb();
  }

  getInsertMode(): InsertKind | null {
    return this.insertKind;
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

  private insertAt(kind: InsertKind, x: number, y: number): void {
    const slide = this.currentSlide();
    if (!slide) return;
    // Default-size insert at the click point. Text uses its own default
    // box per buildInsertElement; for shapes pass an end point that
    // produces a reasonable default rectangle.
    const init = buildInsertElement(kind, { x, y }, { x: x + 200, y: y + 100 });
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

    // Drag-to-size for shapes.
    let endPoint = start;
    const onMove = (ev: MouseEvent) => {
      endPoint = this.clientToLogical(ev.clientX, ev.clientY);
      // Live preview: paint the in-progress shape over the slide.
      const init = buildInsertElement(kind, start, endPoint);
      const synthetic = {
        ...slide,
        elements: [...slide.elements, { ...init, id: '__preview__' } as Element],
      };
      this.renderer.forceRender(synthetic, this.options.store.read());
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const init = buildInsertElement(kind, start, endPoint);
      if (init.frame.w < 4 && init.frame.h < 4) {
        // No real drag — drop a default-sized shape.
        init.frame = { x: start.x, y: start.y, w: 200, h: 100, rotation: 0 };
      }
      this.options.store.batch(() => {
        const id = this.options.store.addElement(slide.id, init);
        this.selection.set([id]);
      });
      this.setInsertMode(null);
      this.renderer.markDirty();
      this.render();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
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
      const { dx, dy } = snapDelta(bbox, rawDx, rawDy, otherFrames, { w: SLIDE_WIDTH, h: SLIDE_HEIGHT });

      for (const [id, base] of originalFrames) {
        live.set(id, { ...base, x: base.x + dx, y: base.y + dy });
      }
      // Repaint canvas + overlay with the live frames; we DO NOT touch
      // the store yet.
      this.paintLive(live);
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
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  private paintLive(live: Map<string, Frame>): void {
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
    renderOverlay(this.options.overlay, selected, { scale: this.scale() });
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
    this.startResize(handle, clientX, clientY);
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
