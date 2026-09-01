import {
  type SlidesStore,
  type Viewport,
  type Point,
  type Slide,
  type SlidesDocument,
  renderThumbnail,
} from '@wafflebase/slides';
import {
  sceneBounds, fitScene, miniToWorld, viewportRectInMini, type MiniFit,
} from './minimap-geometry';

const MINI_W = 200;
const MINI_H = 150;
const PAD = 80; // world-px breathing room around the scene bounds

export interface BoardMinimapDeps {
  store: SlidesStore;
  getHostSize: () => { w: number; h: number };
  onNavigate: (worldCenter: Point) => void;
  dpr: number;
  initialVisible?: boolean;
}

export interface BoardMinimap {
  element: HTMLElement;
  repaintScene(): void;
  repaintViewport(vp: Viewport): void;
  dispose(): void;
}

/**
 * Bottom-right minimap overlay for the board. Vanilla DOM (mounted by
 * board-view alongside the main canvas). Scene snapshot via
 * `renderThumbnail` with a fitted viewport (no slide-rect background);
 * viewport rectangle + drag-to-pan via the pure minimap geometry.
 */
export function createBoardMinimap(deps: BoardMinimapDeps): BoardMinimap {
  const { store, getHostSize, onNavigate, dpr } = deps;
  let visible = deps.initialVisible ?? true;

  const root = document.createElement('div');
  root.style.cssText = [
    'position:absolute', 'right:12px', 'bottom:12px', 'z-index:5',
    'display:flex', 'flex-direction:column', 'align-items:flex-end', 'gap:4px',
  ].join(';');

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.setAttribute('aria-label', 'Toggle minimap');
  toggle.style.cssText = 'font:12px system-ui;padding:2px 6px;border-radius:4px;background:rgba(0,0,0,.6);color:#fff;border:0;cursor:pointer';

  const panel = document.createElement('div');
  panel.style.cssText = [
    `width:${MINI_W}px`, `height:${MINI_H}px`,
    'border-radius:6px', 'overflow:hidden',
    'box-shadow:0 2px 8px rgba(0,0,0,.25)',
    'background:rgba(127,127,127,.12)', 'backdrop-filter:blur(2px)',
  ].join(';');

  const canvas = document.createElement('canvas');
  // Chrome, not content: it sits inside the board container, so without this
  // the template gallery's capture would composite a picture-in-picture of the
  // minimap into the bottom-right of every board thumbnail
  // (packages/frontend/src/lib/thumbnail-capture.ts).
  canvas.dataset.canvasChrome = 'true';
  canvas.width = Math.round(MINI_W * dpr);
  canvas.height = Math.round(MINI_H * dpr);
  canvas.style.width = `${MINI_W}px`;
  canvas.style.height = `${MINI_H}px`;
  canvas.style.display = 'block';
  canvas.style.cursor = 'pointer';
  panel.appendChild(canvas);

  root.appendChild(toggle);
  root.appendChild(panel);

  const ctx = canvas.getContext('2d');
  // Offscreen cache of the last scene paint so repaintViewport (called
  // every pan/zoom frame) blits instead of re-reading the whole store.
  const snapshot = document.createElement('canvas');
  snapshot.width = canvas.width;
  snapshot.height = canvas.height;
  const snapCtx = snapshot.getContext('2d');

  let lastFit: MiniFit | null = null;
  let lastVp: Viewport = { panX: 0, panY: 0, zoom: 1 };
  // Set in dispose(); guards the async `onAssetLoad` repaint path (and the
  // rAF callback) from touching torn-down canvas/store state after teardown.
  let disposed = false;

  const applyVisibility = () => {
    panel.style.display = visible ? 'block' : 'none';
    toggle.textContent = visible ? 'Map ▾' : 'Map ▸';
  };

  const paintScene = () => {
    if (disposed || !snapCtx) return;
    const doc = store.read() as SlidesDocument;
    const slide = doc.slides[0] as Slide;
    const frames = slide.elements.map((e) => e.frame);
    snapCtx.setTransform(1, 0, 0, 1, 0, 0);
    snapCtx.clearRect(0, 0, snapshot.width, snapshot.height);
    const bounds = sceneBounds(frames, PAD);
    if (!bounds) {
      lastFit = null;
      blit();
      return;
    }
    lastFit = fitScene(bounds, { w: MINI_W, h: MINI_H });
    renderThumbnail(snapCtx, slide, doc, {
      hostWidth: MINI_W,
      hostHeight: MINI_H,
      dpr,
      viewport: { zoom: lastFit.scale, panX: lastFit.offsetX, panY: lastFit.offsetY },
      cull: false,
    }, () => scheduleScene());
    blit();
  };

  const blit = () => {
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(snapshot, 0, 0);
    // viewport rectangle (device px)
    if (lastFit) {
      const r = viewportRectInMini(lastVp, getHostSize(), lastFit);
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.strokeStyle = '#2b7fff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.restore();
    }
  };

  // rAF-coalesced scene repaint.
  let sceneRaf = 0;
  const scheduleScene = () => {
    // `renderThumbnail` registers this as its `onAssetLoad`, and the global
    // image cache fires those callbacks after the initial paint — possibly
    // after `dispose()` has torn down the canvas/store. Bail once disposed so
    // a late image load can't schedule a paint against a detached context.
    if (disposed || sceneRaf) return;
    sceneRaf = requestAnimationFrame(() => {
      sceneRaf = 0;
      paintScene();
    });
  };

  // --- drag-to-navigate ---
  let dragging = false;
  const navigateFromEvent = (e: PointerEvent) => {
    if (!lastFit) return;
    const rect = canvas.getBoundingClientRect();
    const world = miniToWorld(lastFit, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    onNavigate(world);
  };
  const onPointerDown = (e: PointerEvent) => {
    dragging = true;
    // `setPointerCapture` can throw (e.g. InvalidPointerId); guard it like
    // the `releasePointerCapture` below so a throw can't escape the handler
    // and strand `dragging = true` without capture.
    try { canvas.setPointerCapture(e.pointerId); } catch { /* noop */ }
    navigateFromEvent(e);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (dragging) navigateFromEvent(e);
  };
  const onPointerUp = (e: PointerEvent) => {
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };
  const onToggle = () => {
    visible = !visible;
    applyVisibility();
    if (visible) scheduleScene();
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  toggle.addEventListener('click', onToggle);

  applyVisibility();

  return {
    element: root,
    repaintScene: () => { if (visible) scheduleScene(); },
    repaintViewport: (vp: Viewport) => {
      lastVp = vp;
      if (visible) blit();
    },
    dispose: () => {
      disposed = true;
      if (sceneRaf) cancelAnimationFrame(sceneRaf);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      toggle.removeEventListener('click', onToggle);
      root.remove();
    },
  };
}
