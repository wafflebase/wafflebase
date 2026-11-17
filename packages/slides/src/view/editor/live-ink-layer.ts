import type { Point } from './interactions/insert';
import { traceSmoothed } from './interactions/ink';

/**
 * One stroke being drawn right now — not yet in the document.
 *
 * Everything is resolved for painting: `color` is a CSS colour (alpha
 * included, so a highlighter overlaps itself without darkening at the
 * joins), `width` is in world units, `points` are world points.
 */
export interface LiveStroke {
  points: readonly Point[];
  color: string;
  width: number;
  /** `'round'` caps and joins (ink); absent ⇒ butt caps, round joins. */
  cap?: 'round';
}

export interface LiveInkLayerHost {
  /** The editor's scene canvas; the layer sits exactly over it. */
  canvas: HTMLCanvasElement;
  /** World → canvas-local CSS px. */
  worldToCanvas(p: Point): Point;
  /** World units → CSS px (the current zoom / fit scale). */
  scale(): number;
  dpr(): number;
}

/**
 * A transparent canvas stacked directly above the scene canvas that
 * paints strokes still being drawn.
 *
 * Why a layer of its own: the old scribble preview rebuilt the whole
 * freeform element and re-rendered the entire scene (`store.read()` +
 * `forceRender`) on every pointer move, O(n²) per stroke on a scene that
 * can hold a whole board. This layer redraws only the live strokes, at
 * most once per animation frame, and the scene is repainted once — on
 * commit.
 *
 * Strokes are keyed so more than one can be live at once. The editor
 * owns the `'local'` key; a later presence layer can show peers' strokes
 * in progress with `set(peerKey, …)` without touching the capture loop.
 */
export class LiveInkLayer {
  private el: HTMLCanvasElement | null = null;
  private strokes = new Map<string, LiveStroke>();
  private raf: number | null = null;

  constructor(private readonly host: LiveInkLayerHost) {}

  /** Show, replace (`stroke`) or remove (`null`) the stroke under `key`. */
  set(key: string, stroke: LiveStroke | null): void {
    if (stroke === null) this.strokes.delete(key);
    else this.strokes.set(key, stroke);
    this.schedule();
  }

  /** Remove every live stroke and blank the layer now (not next frame). */
  clear(): void {
    this.strokes.clear();
    this.cancel();
    this.draw();
  }

  /** Paint pending changes synchronously. */
  flush(): void {
    this.cancel();
    this.draw();
  }

  dispose(): void {
    this.cancel();
    this.strokes.clear();
    this.el?.remove();
    this.el = null;
  }

  private schedule(): void {
    if (this.raf !== null) return;
    if (typeof requestAnimationFrame !== 'function') {
      this.draw();
      return;
    }
    this.raf = requestAnimationFrame(() => {
      this.raf = null;
      this.draw();
    });
  }

  private cancel(): void {
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  }

  /**
   * Create the layer on first use and keep it aligned with the scene
   * canvas: same parent, same offset, same CSS and bitmap size. Inserted
   * right after the canvas so the selection overlay still paints above.
   */
  private ensure(): HTMLCanvasElement | null {
    const canvas = this.host.canvas;
    const parent = canvas.parentElement;
    if (!parent) return null;
    let el = this.el;
    if (el === null) {
      el = document.createElement('canvas');
      el.className = 'wfb-slides-live-ink';
      el.style.position = 'absolute';
      el.style.pointerEvents = 'none';
      this.el = el;
    }
    if (el.parentElement !== parent || el.previousElementSibling !== canvas) {
      canvas.insertAdjacentElement('afterend', el);
    }
    const cssW = canvas.clientWidth || parseFloat(canvas.style.width) || 0;
    const cssH = canvas.clientHeight || parseFloat(canvas.style.height) || 0;
    const dpr = this.host.dpr();
    el.style.left = `${canvas.offsetLeft}px`;
    el.style.top = `${canvas.offsetTop}px`;
    el.style.width = `${cssW}px`;
    el.style.height = `${cssH}px`;
    const bw = Math.round(cssW * dpr);
    const bh = Math.round(cssH * dpr);
    if (el.width !== bw) el.width = bw;
    if (el.height !== bh) el.height = bh;
    return el;
  }

  private draw(): void {
    if (this.strokes.size === 0 && this.el === null) return;
    const el = this.ensure();
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const dpr = this.host.dpr();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scale = this.host.scale();
    for (const stroke of this.strokes.values()) {
      if (stroke.points.length === 0) continue;
      ctx.beginPath();
      traceSmoothed(ctx, stroke.points, (p) => this.host.worldToCanvas(p));
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width * scale;
      ctx.lineJoin = 'round';
      ctx.lineCap = stroke.cap === 'round' ? 'round' : 'butt';
      ctx.stroke();
    }
  }
}
