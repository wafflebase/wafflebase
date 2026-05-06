import type { Element, Frame } from '../../model/element';
import { combinedBoundingBox, containsPoint } from '../../model/frame';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../model/presentation';
import type { SlidesStore } from '../../store/store';
import { SlideRenderer, type SlideRendererOptions } from '../canvas/slide-renderer';
import { handleHitTest, type HandleKind } from './hit-test';
import { buildInsertElement } from './interactions/insert';
import { selectAt } from './interactions/select';
import { normalizeRect, selectInRect } from './interactions/lasso';
import { resizeFrame, type ResizeHandle } from './interactions/resize';
import { applyRotate } from './interactions/rotate';
import { renderOverlay } from './overlay';
import { Selection } from './selection';
import { snapDelta } from './snap';

export type InsertKind = 'rect' | 'ellipse' | 'line' | 'arrow' | 'text';

export interface SlidesEditorOptions extends SlideRendererOptions {
  canvas: HTMLCanvasElement;
  overlay: HTMLDivElement;
  store: SlidesStore;
}

export interface SlidesEditor {
  render(): void;
  getSelection(): readonly string[];
  onSelectionChange(cb: () => void): () => void;
  setInsertMode(kind: InsertKind | null): void;
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

  constructor(private options: SlidesEditorOptions) {
    const ctx = options.canvas.getContext('2d');
    if (!ctx) throw new Error('SlidesEditor: canvas has no 2D context');
    this.renderer = new SlideRenderer(ctx, options);
    this.selection.subscribe(() => {
      this.renderer.markDirty();
      this.repaintOverlay();
    });
    this.attachInteractions();
  }

  private repaintOverlay(): void {
    const slide = this.options.store.read().slides[0];
    if (!slide) {
      renderOverlay(this.options.overlay, [], { scale: this.scale() });
      return;
    }
    const selected = slide.elements.filter((e) => this.selection.has(e.id));
    renderOverlay(this.options.overlay, selected, { scale: this.scale() });
  }

  private scale(): number {
    return this.options.hostWidth / SLIDE_WIDTH;
  }

  render(): void {
    if (this.disposed) return;
    const slide = this.options.store.read().slides[0];
    if (!slide) return;
    this.renderer.render(slide);
  }

  getSelection(): readonly string[] {
    return this.selection.get();
  }

  onSelectionChange(cb: () => void): () => void {
    return this.selection.subscribe(cb);
  }

  setInsertMode(kind: InsertKind | null): void {
    this.insertKind = kind;
    // T7 wires this to a cursor change + canvas pointerdown handler.
  }

  detach(): void {
    this.disposed = true;
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
  }

  private onPointerDown(e: MouseEvent): void {
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
      this.renderer.forceRender(synthetic);
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
    this.renderer.forceRender(synthetic);
    // Repaint overlay against the live frames so handles follow.
    const selected = synthetic.elements.filter((e) => this.selection.has(e.id));
    renderOverlay(this.options.overlay, selected, { scale: this.scale() });
  }

  private currentSlide() {
    return this.options.store.read().slides[0];
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
      live.frame = resizeFrame(startFrame, handle, dx, dy, ev.shiftKey);
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
