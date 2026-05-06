import type { Frame } from '../../model/element';
import { combinedBoundingBox, containsPoint } from '../../model/frame';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../model/presentation';
import type { SlidesStore } from '../../store/store';
import { SlideRenderer, type SlideRendererOptions } from '../canvas/slide-renderer';
import { handleHitTest } from './hit-test';
import { selectAt } from './interactions/select';
import { normalizeRect, selectInRect } from './interactions/lasso';
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
    this.on(this.options.canvas, 'mousedown', (e) => this.onPointerDown(e as MouseEvent));
  }

  private onPointerDown(e: MouseEvent): void {
    if (this.insertKind !== null) return;             // T7 owns insert mousedown
    if (this.handleAtClient(e.clientX, e.clientY) !== null) return; // T5/T6 own resize/rotate

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

  private handleAtClient(clientX: number, clientY: number): string | null {
    const rect = this.options.overlay.getBoundingClientRect();
    return handleHitTest(
      this.options.overlay,
      clientX - rect.left,
      clientY - rect.top,
    );
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
