import type { Slide, SlidesDocument } from '../../model/presentation';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../model/presentation';
import { SlideRenderer } from '../canvas/slide-renderer';

/**
 * Options for `startPresenter`. The presenter mounts a canvas inside
 * `container`, listens for input, and tears everything down on
 * `dispose`. v1 is local-only — no Yorkie presence broadcast.
 */
export interface PresenterOptions {
  container: HTMLElement;
  doc: SlidesDocument;
  startSlideId: string;
  onExit: () => void;
}

/**
 * Public handle returned by `startPresenter`. The methods exposed
 * here are the only ones safe to call from the React shell. Internal
 * navigation methods (`next` / `prev` / `goToFirst` / `goToLast`)
 * are not part of the public surface — they're driven by the
 * presenter's own input handlers in later tasks.
 */
export interface Presenter {
  setDocument(doc: SlidesDocument): void;
  getCurrentSlideId(): string | null;
  isAtEndScreen(): boolean;
  dispose(): void;
}

interface PresenterState {
  doc: SlidesDocument;
  slides: readonly Slide[];
  /** `null` only when `atEndScreen` is true. */
  currentSlideId: string | null;
  atEndScreen: boolean;
}

const SLIDE_ASPECT = SLIDE_WIDTH / SLIDE_HEIGHT;

/** End-screen font size as a fraction of the host canvas height. */
const END_SCREEN_FONT_RATIO = 0.04;
/** User-visible end-screen copy. Single source for any future i18n pass. */
const END_SCREEN_TEXT = 'End of slideshow — click or press Esc to exit';
/** Milliseconds of mousemove inactivity before the cursor is hidden. */
const CURSOR_HIDE_DELAY_MS = 3_000;
/** z-index for the overlay fallback when fullscreen is unavailable. */
const OVERLAY_Z_INDEX = 9999;

/**
 * Pick the largest box that fits inside `availWidth × availHeight`
 * while preserving the 16:9 slide aspect. Duplicated from
 * `packages/frontend/src/app/slides/slides-view.tsx` on purpose — the
 * slides package can't depend on the frontend, and the math is small.
 */
function computeFitSize(availWidth: number, availHeight: number): {
  width: number;
  height: number;
} {
  const widthFit = { width: availWidth, height: availWidth / SLIDE_ASPECT };
  if (widthFit.height <= availHeight) return widthFit;
  return { width: availHeight * SLIDE_ASPECT, height: availHeight };
}

export function startPresenter(options: PresenterOptions): Presenter {
  const { container } = options;
  const state: PresenterState = {
    doc: options.doc,
    slides: options.doc.slides,
    currentSlideId: options.startSlideId,
    atEndScreen: false,
  };

  let disposed = false;
  let lastPaintKind: 'slide' | 'end' | null = null;

  // Remember the container's inline styles so Task 6's dispose() can
  // restore them — the React shell hands us a host element it expects
  // to look unchanged once presentation ends.
  const prevCssText = container.style.cssText;

  // Letterbox layout: black backdrop, center the canvas inside the
  // container so non-16:9 viewports show black bars rather than
  // stretching the slide.
  container.style.background = '#000';
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.style.justifyContent = 'center';

  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  const dpr = window.devicePixelRatio || 1;

  // SlideRenderer is bound to specific host dimensions, so it's
  // rebuilt whenever the fit size changes. The constructor is cheap
  // and ResizeObserver only fires on real size changes — not per
  // frame — so re-instantiating here is fine.
  let renderer = new SlideRenderer(ctx, {
    hostWidth: 0,
    hostHeight: 0,
    dpr,
  });

  function applyFit(): void {
    const fit = computeFitSize(window.innerWidth, window.innerHeight);
    const cssWidth = Math.round(fit.width);
    const cssHeight = Math.round(fit.height);
    canvas.width = Math.round(fit.width * dpr);
    canvas.height = Math.round(fit.height * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    renderer = new SlideRenderer(ctx, {
      hostWidth: cssWidth,
      hostHeight: cssHeight,
      dpr,
    });
    renderer.markDirty();
    paint();
  }

  // observe documentElement as a viewport proxy — it works pre-fullscreen and post-overlay-fallback alike
  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => applyFit());
    resizeObserver.observe(document.documentElement);
  }

  function paint(): void {
    if (disposed) return;
    if (state.atEndScreen) {
      paintEndScreen();
      return;
    }
    const slide = state.slides.find((s) => s.id === state.currentSlideId);
    if (!slide) return;
    // SlideRenderer's dirty flag is per-slide-state, so it would skip
    // the repaint after a slide switch without an explicit markDirty.
    renderer.markDirty();
    renderer.render(slide, state.doc);
    lastPaintKind = 'slide';
  }

  function paintEndScreen(): void {
    const hostWidth = canvas.width / dpr;
    const hostHeight = canvas.height / dpr;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, hostWidth, hostHeight);
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.round(hostHeight * END_SCREEN_FONT_RATIO)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(END_SCREEN_TEXT, hostWidth / 2, hostHeight / 2);
    ctx.restore();
    lastPaintKind = 'end';
  }

  function indexOfCurrent(): number {
    if (state.currentSlideId === null) return -1;
    return state.slides.findIndex((s) => s.id === state.currentSlideId);
  }

  function next(): void {
    if (disposed) return;
    if (state.atEndScreen) return;
    const idx = indexOfCurrent();
    if (idx < 0) return;
    if (idx < state.slides.length - 1) {
      state.currentSlideId = state.slides[idx + 1].id;
    } else {
      state.atEndScreen = true;
      state.currentSlideId = null;
    }
    paint();
  }

  function prev(): void {
    if (disposed) return;
    if (state.atEndScreen) {
      state.atEndScreen = false;
      state.currentSlideId = state.slides[state.slides.length - 1].id;
      paint();
      return;
    }
    const idx = indexOfCurrent();
    if (idx < 0) return;
    const targetIdx = Math.max(0, idx - 1);
    state.currentSlideId = state.slides[targetIdx].id;
    paint();
  }

  function goToFirst(): void {
    if (disposed) return;
    if (state.slides.length === 0) return;
    state.currentSlideId = state.slides[0].id;
    state.atEndScreen = false;
    paint();
  }

  function goToLast(): void {
    if (disposed) return;
    if (state.slides.length === 0) return;
    state.currentSlideId = state.slides[state.slides.length - 1].id;
    state.atEndScreen = false;
    paint();
  }

  function setDocument(doc: SlidesDocument): void {
    if (disposed) return;
    // Task 5 will flesh this out with deletion / reindex logic.
    state.doc = doc;
    state.slides = doc.slides;
    paint();
  }

  function getCurrentSlideId(): string | null {
    return state.currentSlideId;
  }

  function isAtEndScreen(): boolean {
    return state.atEndScreen;
  }

  // Keyboard mapping: each entry corresponds to an `event.key` value
  // that the presenter consumes. Anything not in this map is still
  // swallowed (see `onKeyDown`) so editor shortcuts can't fire under
  // the presenter — e.g. Cmd+Z must not undo the live deck.
  const keyActions = new Map<string, () => void>([
    ['ArrowRight', next],
    [' ', next],
    ['PageDown', next],
    ['n', next],
    ['N', next],
    ['ArrowLeft', prev],
    ['PageUp', prev],
    ['Backspace', prev],
    ['p', prev],
    ['P', prev],
    ['Home', goToFirst],
    ['End', goToLast],
    ['Escape', () => options.onExit()],
  ]);

  function onKeyDown(ev: KeyboardEvent): void {
    if (disposed) return;
    // Capture-phase + stopImmediatePropagation means editor key rules
    // never see these events while the presenter is mounted.
    ev.stopImmediatePropagation();
    ev.preventDefault();
    const action = keyActions.get(ev.key);
    if (action) action();
  }
  document.addEventListener('keydown', onKeyDown, { capture: true });

  function onCanvasClick(): void {
    if (disposed) return;
    if (state.atEndScreen) {
      options.onExit();
      return;
    }
    next();
  }
  canvas.addEventListener('click', onCanvasClick);

  // Cursor auto-hide: any `mousemove` restores the cursor and re-arms
  // a single setTimeout. While the timer is dormant we set
  // `cursor: 'none'` directly on the container so the canvas (which
  // doesn't have its own cursor style) inherits it.
  let cursorHideTimer: ReturnType<typeof setTimeout> | null = null;
  function armCursorHide(): void {
    if (cursorHideTimer !== null) clearTimeout(cursorHideTimer);
    cursorHideTimer = setTimeout(() => {
      if (disposed) return;
      container.style.cursor = 'none';
    }, CURSOR_HIDE_DELAY_MS);
  }
  function onMouseMove(): void {
    if (disposed) return;
    container.style.cursor = '';
    armCursorHide();
  }
  container.addEventListener('mousemove', onMouseMove);
  armCursorHide();

  // Fullscreen + overlay fallback. `requestFullscreen` returns a
  // Promise that rejects on iframe-sandbox / permission-denied. We
  // discard the Promise with `void` — the side effects (entering
  // fullscreen, or applying overlay on rejection) are sufficient. The
  // optional-call handles environments that lack the API entirely.
  //
  // `mountMode` drives overlay-vs-fullscreen styling for dispose() in
  // Task 6. `enteredFullscreen` is a separate axis describing whether
  // the browser-level fullscreen bridge is armed — it only flips true
  // inside the `.then` of our own requestFullscreen, so a stray
  // `fullscreenchange` before our Promise resolves, or one triggered
  // by a sibling element exiting fullscreen, cannot misfire onExit.
  let mountMode: 'fullscreen' | 'overlay' = 'fullscreen';
  let enteredFullscreen = false;
  function applyOverlayStyles(): void {
    container.style.position = 'fixed';
    container.style.top = '0';
    container.style.left = '0';
    container.style.right = '0';
    container.style.bottom = '0';
    container.style.zIndex = String(OVERLAY_Z_INDEX);
  }
  void container.requestFullscreen?.().then(() => {
    if (disposed) return;
    enteredFullscreen = true;
  }).catch(() => {
    if (disposed) return;
    mountMode = 'overlay';
    applyOverlayStyles();
  });

  // Bridge the browser's own Esc (which exits fullscreen without
  // firing our keydown handler) back to options.onExit. We gate on
  // `enteredFullscreen` so events before our own requestFullscreen
  // resolves are ignored, and on identity (`fullscreenElement ===
  // container`) so a sibling element transitioning in or out of
  // fullscreen does not exit the presenter. If our container is no
  // longer the fullscreen element — whether the user left fullscreen
  // entirely or some other element took over — the presenter is no
  // longer driving fullscreen, so exit cleanly.
  function onFullscreenChange(): void {
    if (disposed) return;
    if (!enteredFullscreen) return;
    if (document.fullscreenElement === container) return;
    enteredFullscreen = false;
    options.onExit();
  }
  document.addEventListener('fullscreenchange', onFullscreenChange);

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    // Task 6 will tear down canvas, listeners (`onKeyDown` /
    // `onCanvasClick` are held in closure above), fullscreen, etc.
    // The `disposed` flag short-circuits all handlers so leaving the
    // listeners installed until then is safe.
  }

  // Seed the initial paint after all closures are set up.
  applyFit();

  const presenter: Presenter = {
    setDocument,
    getCurrentSlideId,
    isAtEndScreen,
    dispose,
  };

  // Internal-only handle so unit tests can exercise navigation
  // without going through DOM events. Not part of the public type;
  // not enumerable. Later tasks (input wiring, remote-change tests)
  // still want to drive navigation directly, so this stays.
  //
  // Also exposes:
  //   - `getCanvas` so tests can inspect the mounted element.
  //   - `getLastPaintKind` so tests can verify which paint branch ran
  //     without depending on jsdom's stubbed canvas pixel state.
  //   - `getResources` for Task 6's dispose teardown verification.
  Object.defineProperty(presenter, '__test', {
    enumerable: false,
    value: {
      next,
      prev,
      goToFirst,
      goToLast,
      getCanvas: () => canvas,
      getLastPaintKind: () => lastPaintKind,
      getResources: () => ({ canvas, ctx, prevCssText, resizeObserver, mountMode }),
    },
  });

  return presenter;
}
