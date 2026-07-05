import type { Slide, SlidesDocument } from '../../model/presentation';
import { SLIDE_WIDTH, deckSlideHeight } from '../../model/presentation';
import { SlideRenderer } from '../canvas/slide-renderer';
import { AnimationPlayer, buildParagraphCounts, compileTimeline, sampleTransition } from '../../anim';
import { flattenElements } from '../../model/group';

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
 * while preserving the deck's slide aspect (`SLIDE_WIDTH / deck height`;
 * 16:9 for a default deck, 4:3 for a 10"×7.5" import). Duplicated from
 * `packages/frontend/src/app/slides/slides-view.tsx` on purpose — the
 * slides package can't depend on the frontend, and the math is small.
 */
function computeFitSize(availWidth: number, availHeight: number, aspect: number): {
  width: number;
  height: number;
} {
  const widthFit = { width: availWidth, height: availWidth / aspect };
  if (widthFit.height <= availHeight) return widthFit;
  return { width: availHeight * aspect, height: availHeight };
}

export function startPresenter(options: PresenterOptions): Presenter {
  const { container } = options;
  // Fail-fast on an empty deck. The React shell's empty-deck guard
  // (slides-detail.tsx) is the host-side gate, but `startPresenter`
  // is public API — a future caller (CLI, test, embed) might bypass
  // it. Without this throw we'd index into an empty `slides` array
  // below and crash with an opaque `undefined.id`.
  if (options.doc.slides.length === 0) {
    throw new Error(
      'startPresenter: doc.slides must be non-empty. The host is ' +
        'responsible for guarding the empty-deck case before mounting.',
    );
  }
  // Per-deck logical height / aspect. Fixed for the deck's lifetime, so
  // capture once rather than re-reading meta on every fit/animation build.
  // Per-deck logical height / aspect. Mutable: a collaborator can change
  // the deck size mid-presentation, which arrives via `setDocument`.
  let slideH = deckSlideHeight(options.doc.meta);
  let slideAspect = SLIDE_WIDTH / slideH;
  // Validate startSlideId against the live doc. A peer can delete that
  // slide between the host computing the id and startPresenter
  // running; without this fallback, the presenter would mount on a
  // phantom id, paint() would no-op, and navigation would look broken.
  const resolvedStartId = options.doc.slides.some(
    (s) => s.id === options.startSlideId,
  )
    ? options.startSlideId
    : options.doc.slides[0].id;
  const state: PresenterState = {
    doc: options.doc,
    slides: options.doc.slides,
    currentSlideId: resolvedStartId,
    atEndScreen: false,
  };

  let disposed = false;
  let lastPaintKind: 'slide' | 'end' | null = null;

  // Animation state — one player per slide, built fresh on slide entry.
  let animPlayer: AnimationPlayer | null = null;
  let rafHandle: number | null = null;

  // Transition RAF handle — separate from the object-animation handle so
  // the two loops can be cancelled independently. Both must be cancelled
  // on dispose() and before any slide change.
  let transitionRafHandle: number | null = null;

  // Current CSS size of the canvas slot. Updated by applyFit() and read
  // by playTransition() to build offscreen SlideRenderers at the same
  // scale as the main renderer.
  let currentCssWidth = 0;
  let currentCssHeight = 0;

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
    const fit = computeFitSize(window.innerWidth, window.innerHeight, slideAspect);
    const cssWidth = Math.round(fit.width);
    const cssHeight = Math.round(fit.height);
    canvas.width = Math.round(fit.width * dpr);
    canvas.height = Math.round(fit.height * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    // Persist so playTransition() can build offscreen renderers at the
    // same scale without needing a scale accessor on SlideRenderer.
    currentCssWidth = cssWidth;
    currentCssHeight = cssHeight;
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
    // Paint with the player's resting state so entrance elements are hidden
    // until their step plays. This covers mount, prev, goToFirst/Last,
    // setDocument, and resize — all paths that call paint() directly.
    // Slides with no animation steps fall through to the normal render path so
    // existing render-spy tests and non-animated slides are unaffected.
    if (animPlayer && animPlayer.hasSteps) {
      renderer.forceRender(slide, state.doc, undefined, animPlayer.restingState());
    } else {
      renderer.render(slide, state.doc);
    }
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

  /**
   * Cancel the object-animation RAF loop. Safe to call when no loop is
   * running (handle is already null) or after dispose.
   */
  function cancelRaf(): void {
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
  }

  /**
   * Cancel any in-flight transition RAF loop. Safe to call when no
   * transition is running.
   */
  function cancelTransitionRaf(): void {
    if (transitionRafHandle !== null) {
      cancelAnimationFrame(transitionRafHandle);
      transitionRafHandle = null;
    }
  }

  /**
   * Play a cross-paint slide transition from `fromSlide` to `toSlide`
   * over `transition.durationMs` milliseconds. Each frame composites
   * pre-rendered offscreen bitmaps of the two slides onto the main canvas
   * using the CrossPaint values from `sampleTransition`. When the
   * animation completes, `onDone()` is called so the caller can settle
   * the new slide state and build its object-animation player.
   *
   * KEY INSIGHT: `sampleTransition` receives the CANVAS PIXEL size (not
   * logical slide size) so the dx/dy offsets are already in device pixels
   * and `drawImage` composites at the identity transform — no scale
   * conversion needed.
   */
  function playTransition(
    fromSlide: Slide,
    toSlide: Slide,
    transition: import('../../model/presentation').SlideTransition,
    onDone: () => void,
  ): void {
    // Build offscreen canvases the same pixel size as the main canvas.
    const pw = canvas.width;
    const ph = canvas.height;

    const offA = document.createElement('canvas');
    offA.width = pw;
    offA.height = ph;
    const ctxA = offA.getContext('2d')!;

    const offB = document.createElement('canvas');
    offB.width = pw;
    offB.height = ph;
    const ctxB = offB.getContext('2d')!;

    // Render outgoing and incoming slides to offscreen canvases once.
    // Use the same CSS dimensions (hostWidth/Height) as the main renderer
    // so text and element sizes match exactly.
    const offOpts = { hostWidth: currentCssWidth, hostHeight: currentCssHeight, dpr };
    const rendA = new SlideRenderer(ctxA, offOpts);
    rendA.forceRender(fromSlide, state.doc);
    const rendB = new SlideRenderer(ctxB, offOpts);
    rendB.forceRender(toSlide, state.doc);

    const startMs = performance.now();
    const durationMs = transition.durationMs > 0 ? transition.durationMs : 1;

    function transitionFrame(): void {
      if (disposed) {
        transitionRafHandle = null;
        return;
      }
      const elapsed = performance.now() - startMs;
      const progress = Math.min(1, elapsed / durationMs);

      const cp = sampleTransition(transition, progress, { w: pw, h: ph });

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, pw, ph);

      // Draw outgoing slide.
      ctx.globalAlpha = cp.prevAlpha;
      ctx.drawImage(offA, cp.prevDx, cp.prevDy);

      // Draw incoming slide with optional clip region.
      ctx.save();
      if (cp.clipNext) {
        ctx.beginPath();
        ctx.rect(cp.clipNext.x, cp.clipNext.y, cp.clipNext.w, cp.clipNext.h);
        ctx.clip();
      }
      ctx.globalAlpha = cp.nextAlpha;
      ctx.drawImage(offB, cp.nextDx, cp.nextDy);
      ctx.restore();

      ctx.globalAlpha = 1;

      if (progress < 1) {
        transitionRafHandle = requestAnimationFrame(transitionFrame);
      } else {
        transitionRafHandle = null;
        onDone();
      }
    }

    transitionRafHandle = requestAnimationFrame(transitionFrame);
  }

  /**
   * Build an AnimationPlayer for the given slide and bind it to the
   * renderer's forceRender so each tick repaints with animStates.
   */
  function buildPlayerFor(slide: Slide): AnimationPlayer {
    const existingElementIds = new Set(flattenElements(slide.elements).map((e) => e.id));
    const paragraphCounts = buildParagraphCounts(slide);
    const steps = compileTimeline(slide, { existingElementIds, paragraphCounts });
    return new AnimationPlayer(
      steps,
      { w: SLIDE_WIDTH, h: slideH },
      (states) => {
        if (disposed) return;
        renderer.forceRender(slide, state.doc, undefined, states);
        lastPaintKind = 'slide';
      },
    );
  }

  /**
   * Start the RAF loop that ticks the current player until the current
   * step finishes. Called whenever advance() returns true (a step was
   * started). The loop stops as soon as `animPlayer.isAnimating` becomes
   * false (i.e. the step's duration elapses and tick() sets playing=false).
   * This prevents idle spinning between steps and after the last step —
   * the next advance() call restarts a fresh loop via this function.
   */
  function startRafLoop(): void {
    cancelRaf();
    function frame(): void {
      if (disposed || animPlayer === null) {
        rafHandle = null;
        return;
      }
      animPlayer.tick(performance.now());
      if (animPlayer.isAnimating) {
        // Step still in progress — keep ticking.
        rafHandle = requestAnimationFrame(frame);
      } else {
        // Step has settled — stop the loop until next advance().
        rafHandle = null;
      }
    }
    rafHandle = requestAnimationFrame(frame);
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

    // If the current slide has a player, try to consume an animation step
    // first. advance() returns true if a step was consumed (we stay on
    // this slide and let the RAF loop play it). advance() returns false
    // when there are no more steps — fall through to slide navigation.
    if (animPlayer !== null) {
      const consumed = animPlayer.advance();
      if (consumed) {
        startRafLoop();
        return;
      }
    }

    // No more animation steps — advance to the next slide.
    if (idx < state.slides.length - 1) {
      const fromSlide = state.slides[idx];
      const nextSlide = state.slides[idx + 1];
      state.currentSlideId = nextSlide.id;
      cancelRaf();
      cancelTransitionRaf();
      animPlayer = null;

      const t = nextSlide.transition;
      if (t && t.type !== 'none' && t.durationMs > 0) {
        // Play the cross-paint transition, then settle on the new slide
        // and arm its object-animation player.
        playTransition(fromSlide, nextSlide, t, () => {
          if (disposed) return;
          animPlayer = buildPlayerFor(nextSlide);
          paint();
        });
      } else {
        // No transition — instant cut (original behavior).
        animPlayer = buildPlayerFor(nextSlide);
        paint();
      }
    } else {
      state.atEndScreen = true;
      state.currentSlideId = null;
      cancelRaf();
      cancelTransitionRaf();
      animPlayer = null;
      paint();
    }
  }

  function prev(): void {
    if (disposed) return;
    cancelRaf();
    cancelTransitionRaf();
    if (state.atEndScreen) {
      state.atEndScreen = false;
      const targetSlide = state.slides[state.slides.length - 1];
      state.currentSlideId = targetSlide.id;
      // Going backward: build the player but don't auto-play animations.
      // The slide is painted in its static final state. The player is
      // ready so a subsequent next() can advance its steps normally
      // (though going back and then forward is an unusual path).
      animPlayer = buildPlayerFor(targetSlide);
      paint();
      return;
    }
    const idx = indexOfCurrent();
    if (idx < 0) return;
    const targetIdx = Math.max(0, idx - 1);
    const targetSlide = state.slides[targetIdx];
    state.currentSlideId = targetSlide.id;
    // Build player for the target slide in its initial state (not yet
    // played). Going backward does NOT replay forward animations — we
    // simply render the slide statically. If the user presses next from
    // here, they'll advance through steps in order.
    animPlayer = buildPlayerFor(targetSlide);
    paint();
  }

  function goToFirst(): void {
    if (disposed) return;
    if (state.slides.length === 0) return;
    cancelRaf();
    cancelTransitionRaf();
    const targetSlide = state.slides[0];
    state.currentSlideId = targetSlide.id;
    state.atEndScreen = false;
    animPlayer = buildPlayerFor(targetSlide);
    paint();
  }

  function goToLast(): void {
    if (disposed) return;
    if (state.slides.length === 0) return;
    cancelRaf();
    cancelTransitionRaf();
    const targetSlide = state.slides[state.slides.length - 1];
    state.currentSlideId = targetSlide.id;
    state.atEndScreen = false;
    animPlayer = buildPlayerFor(targetSlide);
    paint();
  }

  function setDocument(doc: SlidesDocument): void {
    if (disposed) return;
    // Capture the old index BEFORE rebinding — the reindex fallback
    // for a deleted current slide needs the position the user was on
    // in the previous snapshot.
    const oldSlides = state.slides;
    const oldIndex =
      state.currentSlideId === null
        ? -1
        : oldSlides.findIndex((s) => s.id === state.currentSlideId);

    state.doc = doc;
    state.slides = doc.slides;

    // Empty deck → hand control back to the shell; it surfaces a
    // toast and unmounts. Checked first so subsequent branches never
    // index into an empty array.
    if (state.slides.length === 0) {
      options.onExit();
      return;
    }

    // A collaborator may have changed the deck's size. Recompute the fit
    // aspect and re-fit the canvas so the letterbox matches the slides the
    // renderer now paints (which already read the new `doc.meta`).
    const newH = deckSlideHeight(doc.meta);
    if (newH !== slideH) {
      slideH = newH;
      slideAspect = SLIDE_WIDTH / slideH;
      applyFit(); // resizes the canvas + rebuilds the renderer, then paints
    }

    // End-screen survives any structural change short of emptying the
    // deck — the presentation is still "over". paint() re-paints the
    // end-screen with no slide lookup, so this is safe regardless of
    // what was removed.
    if (state.atEndScreen) {
      paint();
      return;
    }

    // Same id still present — fast path. Avoids the reindex round-trip
    // and prevents a spurious currentSlideId change on the common case
    // of a theme or element edit on a slide that wasn't deleted.
    const stillThere =
      state.currentSlideId !== null &&
      state.slides.some((s) => s.id === state.currentSlideId);
    if (stillThere) {
      // Rebuild the player for the current slide since its elements may
      // have changed (theme/element edits can affect animation targets).
      // Cancel any in-flight RAF (including transition) first to avoid a
      // stale-player tick or stale transition onDone firing.
      cancelRaf();
      cancelTransitionRaf();
      const currentSlide = state.slides.find((s) => s.id === state.currentSlideId)!;
      animPlayer = buildPlayerFor(currentSlide);
      paint();
      return;
    }

    // Current slide is gone — fall back to the slide at the old
    // index, clamped to the new tail. `oldIndex` is guaranteed >= 0
    // here because `stillThere` was false and a null currentSlideId
    // only occurs in the end-screen branch handled above.
    const targetIndex = Math.min(
      Math.max(0, oldIndex),
      state.slides.length - 1,
    );
    state.currentSlideId = state.slides[targetIndex].id;
    cancelRaf();
    cancelTransitionRaf();
    const fallbackSlide = state.slides[targetIndex];
    animPlayer = buildPlayerFor(fallbackSlide);
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
  if (container.requestFullscreen) {
    void container.requestFullscreen().then(() => {
      if (disposed) {
        // We tore down before the browser entered fullscreen. Reverse
        // it — without this, the page sits in fullscreen with no canvas,
        // no listeners, no way out except the browser's native Esc.
        document.exitFullscreen?.().catch(() => { /* already exited */ });
        return;
      }
      enteredFullscreen = true;
    }).catch(() => {
      if (disposed) return;
      mountMode = 'overlay';
      applyOverlayStyles();
    });
  } else {
    // Environment lacks the Fullscreen API entirely (some embed
    // contexts, very old browsers). Optional-chaining only protects
    // the call itself — calling `.then` on the resulting `undefined`
    // would throw TypeError. Feature-detect explicitly and skip
    // directly to overlay mode.
    mountMode = 'overlay';
    applyOverlayStyles();
  }

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

    // Cancel any in-flight animation RAF before cleaning up other
    // resources. The disposed flag guards in frame() and transitionFrame()
    // ensure no further ticks fire even if cancelAnimationFrame races.
    cancelRaf();
    cancelTransitionRaf();
    animPlayer = null;

    // Detach the fullscreenchange listener FIRST so the
    // exitFullscreen() call below can't loop back into our handler
    // → onExit → caller dispose → infinite recursion.
    document.removeEventListener('fullscreenchange', onFullscreenChange);

    // Capture-phase listener: the options object is part of the
    // listener identity for removal. Without { capture: true } here
    // removeEventListener is a silent no-op and the listener leaks.
    document.removeEventListener('keydown', onKeyDown, { capture: true });
    canvas.removeEventListener('click', onCanvasClick);
    container.removeEventListener('mousemove', onMouseMove);

    if (cursorHideTimer !== null) clearTimeout(cursorHideTimer);
    resizeObserver?.disconnect();

    // Exit fullscreen only if WE put the page there. exitFullscreen()
    // throws when not currently in fullscreen, so the identity check
    // plus try/catch guards against both browser-initiated exits and
    // dispose-after-exit races.
    if (enteredFullscreen && document.fullscreenElement === container) {
      try {
        void document.exitFullscreen();
      } catch {
        /* already exited */
      }
    }

    canvas.remove();
    container.style.cssText = prevCssText;
  }

  // Seed the initial paint after all closures are set up.
  // Also build the animation player for the starting slide so the first
  // next() is already wired up. The starting slide is always a real slide
  // (the empty-deck guard above ensures this).
  const startSlide = state.slides.find((s) => s.id === state.currentSlideId);
  if (startSlide) {
    animPlayer = buildPlayerFor(startSlide);
  }
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
      getAnimPlayer: () => animPlayer,
      getTransitionRafHandle: () => transitionRafHandle,
    },
  });

  return presenter;
}
