import { SLIDE_WIDTH } from '../../model/presentation';
import type { SlidesStore } from '../../store/store';
import { SlideRenderer, type SlideRendererOptions } from '../canvas/slide-renderer';
import { renderOverlay } from './overlay';
import { Selection } from './selection';

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
}

export function initialize(options: SlidesEditorOptions): SlidesEditor {
  const editor = new SlidesEditorImpl(options);
  editor.render();
  return editor;
}
