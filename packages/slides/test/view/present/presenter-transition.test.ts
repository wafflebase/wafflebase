// @vitest-environment jsdom
import '../../../src/view/canvas/test-canvas-env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemSlidesStore } from '../../../src/store/memory';
import type { SlidesDocument } from '../../../src/model/presentation';
import { startPresenter, type Presenter } from '../../../src/view/present/presenter';
import { AnimationPlayer } from '../../../src/anim';

// ---------------------------------------------------------------------------
// Test handle types
// ---------------------------------------------------------------------------

interface TestHandle {
  next: () => void;
  prev: () => void;
  goToFirst: () => void;
  goToLast: () => void;
  getCanvas: () => HTMLCanvasElement;
  getLastPaintKind: () => 'slide' | 'end' | null;
  getAnimPlayer: () => AnimationPlayer | null;
  getTransitionRafHandle: () => number | null;
}

function testApi(presenter: Presenter): TestHandle {
  return (presenter as unknown as { __test: TestHandle }).__test;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

/**
 * Build a 2-slide deck where slide B has a fade transition.
 * Returns { doc, aId, bId }.
 */
function makeDocWithFadeTransition(): {
  doc: SlidesDocument;
  aId: string;
  bId: string;
} {
  const store = new MemSlidesStore();
  let aId = '';
  let bId = '';

  store.batch(() => {
    aId = store.addSlide('blank');
    bId = store.addSlide('blank');
    store.setSlideTransition(bId, { type: 'fade', durationMs: 400 });
  });

  return { doc: store.read(), aId, bId };
}

/**
 * Build a 3-slide deck with NO transitions on any slide.
 */
function makeDocNoTransitions(): {
  doc: SlidesDocument;
  ids: [string, string, string];
} {
  const store = new MemSlidesStore();
  let aId = '';
  let bId = '';
  let cId = '';
  store.batch(() => {
    aId = store.addSlide('blank');
    bId = store.addSlide('blank');
    cId = store.addSlide('blank');
  });
  return { doc: store.read(), ids: [aId, bId, cId] };
}

/**
 * Build a 2-slide deck where slide B has a 'none' typed transition
 * (should instant-cut, not animate).
 */
function makeDocWithNoneTransition(): {
  doc: SlidesDocument;
  aId: string;
  bId: string;
} {
  const store = new MemSlidesStore();
  let aId = '';
  let bId = '';

  store.batch(() => {
    aId = store.addSlide('blank');
    bId = store.addSlide('blank');
    store.setSlideTransition(bId, { type: 'none', durationMs: 400 });
  });

  return { doc: store.read(), aId, bId };
}

// ---------------------------------------------------------------------------
// Global test environment setup
// ---------------------------------------------------------------------------

// Track drawImage calls across tests.
let drawImageCallCount = 0;

beforeEach(() => {
  document.body.innerHTML = '';
  drawImageCallCount = 0;

  // jsdom lacks ResizeObserver.
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  // Make requestFullscreen resolve cleanly inside jsdom.
  (
    HTMLElement.prototype as unknown as { requestFullscreen: () => Promise<void> }
  ).requestFullscreen = vi.fn().mockResolvedValue(undefined);

  // Stub requestAnimationFrame / cancelAnimationFrame so we control
  // the RAF loop without relying on jsdom's fake timer infrastructure.
  // Each frame callback is stored; tests flush them manually.
  const pending: Array<FrameRequestCallback> = [];
  let handleCounter = 0;
  // Map from handle → index in pending (for selective cancel support).
  const handleToIndex = new Map<number, number>();

  vi.stubGlobal(
    'requestAnimationFrame',
    (cb: FrameRequestCallback): number => {
      handleCounter += 1;
      handleToIndex.set(handleCounter, pending.length);
      pending.push(cb);
      return handleCounter;
    },
  );
  vi.stubGlobal('cancelAnimationFrame', (_handle: number) => {
    // Clear ALL pending frames (same approach as presenter-anim.test.ts).
    pending.length = 0;
    handleToIndex.clear();
  });

  // Expose flush helpers on globalThis.
  (
    globalThis as unknown as {
      __flushRaf: (nowMs?: number) => void;
      __pendingRaf: FrameRequestCallback[];
    }
  ).__pendingRaf = pending;
  (
    globalThis as unknown as { __flushRaf: (nowMs?: number) => void }
  ).__flushRaf = (nowMs = 500) => {
    const callbacks = [...pending];
    pending.length = 0;
    handleToIndex.clear();
    for (const cb of callbacks) cb(nowMs);
  };

  // performance.now() — start at 0 so elapsed = nowMs in first flush.
  let nowValue = 0;
  vi.stubGlobal('performance', {
    now: () => nowValue,
  });
  // Expose setter for tests that want to advance time.
  (globalThis as unknown as { __setNow: (v: number) => void }).__setNow = (v: number) => {
    nowValue = v;
  };

  // Patch HTMLCanvasElement.prototype.getContext to spy on drawImage.
  // The test-canvas-env shim already installs a fake ctx; we extend it here
  // to record drawImage calls so tests can assert the transition path ran.
  const originalGetCtx = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function patchedGetContext(
    this: HTMLCanvasElement,
    contextId: string,
    ...rest: unknown[]
  ): unknown {
    const base = (originalGetCtx as (this: HTMLCanvasElement, ...a: unknown[]) => unknown).call(
      this,
      contextId,
      ...rest,
    );
    if (contextId === '2d' && base && typeof base === 'object') {
      const baseCtx = base as Record<string, unknown>;
      const origDrawImage = baseCtx['drawImage'];
      baseCtx['drawImage'] = (...args: unknown[]) => {
        drawImageCallCount += 1;
        if (typeof origDrawImage === 'function') {
          return (origDrawImage as (...a: unknown[]) => unknown)(...args);
        }
      };
    }
    return base;
  } as HTMLCanvasElement['getContext'];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function flushRaf(nowMs?: number): void {
  if (nowMs !== undefined) {
    (globalThis as unknown as { __setNow: (v: number) => void }).__setNow(nowMs);
  }
  (
    globalThis as unknown as { __flushRaf: (nowMs?: number) => void }
  ).__flushRaf(nowMs);
}

// ---------------------------------------------------------------------------
// Suite 1: Transition playback — fade transition
// ---------------------------------------------------------------------------

describe('presenter — slide transition playback (fade)', () => {
  it('advancing to a slide WITH a fade transition kicks the transition RAF before settling', () => {
    const { doc, aId } = makeDocWithFadeTransition();
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: aId,
      onExit: vi.fn(),
    });
    try {
      // Before next(): state is on slide A, no transition RAF.
      expect(presenter.getCurrentSlideId()).toBe(aId);

      // Trigger slide advance (slide A has no animations so next() goes straight to B).
      testApi(presenter).next();

      // Since slide B has a transition, the presenter queues the transition RAF
      // but the slide id is already updated to B.
      expect(presenter.isAtEndScreen()).toBe(false);

      // A transition RAF frame should be pending (transition is in flight).
      const pendingAfterNext = (
        globalThis as unknown as { __pendingRaf: FrameRequestCallback[] }
      ).__pendingRaf.length;
      expect(pendingAfterNext).toBeGreaterThan(0);
    } finally {
      presenter.dispose();
    }
  });

  it('after advancing to a slide with fade transition, getCurrentSlideId is already the new slide', () => {
    const { doc, aId, bId } = makeDocWithFadeTransition();
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: aId,
      onExit: vi.fn(),
    });
    try {
      testApi(presenter).next();
      // The state updates eagerly before the transition plays.
      expect(presenter.getCurrentSlideId()).toBe(bId);
    } finally {
      presenter.dispose();
    }
  });

  it('mid-transition: animPlayer is null (not yet armed) and transition RAF is in flight', () => {
    const { doc, aId } = makeDocWithFadeTransition();
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: aId,
      onExit: vi.fn(),
    });
    try {
      testApi(presenter).next();

      // While transition RAF is pending (before flushing), animPlayer should
      // be null because it's only built in the onDone callback.
      expect(testApi(presenter).getAnimPlayer()).toBeNull();

      // And transitionRafHandle should be non-null (transition is in flight).
      expect(testApi(presenter).getTransitionRafHandle()).not.toBeNull();
    } finally {
      presenter.dispose();
    }
  });

  it('flushing transition frames to completion arms the object-animation player', () => {
    const { doc, aId } = makeDocWithFadeTransition();
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: aId,
      onExit: vi.fn(),
    });
    try {
      testApi(presenter).next();

      // Flush frames with time beyond durationMs (400ms) to complete the transition.
      // We flush multiple times to cover re-queued frames.
      flushRaf(500); // elapsed = 500 > 400ms → progress = 1 → onDone fires
      // After completion, the transition RAF handle should be cleared.
      expect(testApi(presenter).getTransitionRafHandle()).toBeNull();

      // And the object-animation player should be armed.
      expect(testApi(presenter).getAnimPlayer()).not.toBeNull();
    } finally {
      presenter.dispose();
    }
  });

  it('transition frames invoke drawImage on the main canvas ctx (cross-paint ran)', () => {
    const { doc, aId } = makeDocWithFadeTransition();
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: aId,
      onExit: vi.fn(),
    });
    try {
      testApi(presenter).next();

      const drawImageBefore = drawImageCallCount;
      // Flush one frame at mid-transition (t=200ms out of 400ms → progress=0.5).
      flushRaf(200);

      // The transition frame should have called drawImage at least twice
      // (once for outgoing, once for incoming slide bitmap).
      expect(drawImageCallCount).toBeGreaterThan(drawImageBefore);
    } finally {
      presenter.dispose();
    }
  });

  it('dispose() during in-flight transition cancels the transition RAF', () => {
    const { doc, aId } = makeDocWithFadeTransition();
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: aId,
      onExit: vi.fn(),
    });

    testApi(presenter).next(); // kicks transition RAF

    const pendingBeforeDispose = (
      globalThis as unknown as { __pendingRaf: FrameRequestCallback[] }
    ).__pendingRaf.length;
    expect(pendingBeforeDispose).toBeGreaterThan(0);

    presenter.dispose();

    const pendingAfterDispose = (
      globalThis as unknown as { __pendingRaf: FrameRequestCallback[] }
    ).__pendingRaf.length;
    expect(pendingAfterDispose).toBe(0);
  });

  it('flushing transition frames after dispose() does not throw or call onDone', () => {
    const { doc, aId } = makeDocWithFadeTransition();
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: aId,
      onExit: vi.fn(),
    });

    testApi(presenter).next();
    // Dispose before any RAF frame fires.
    presenter.dispose();

    // Flushing should not throw (disposed guard protects transitionFrame).
    // (The pending list was cleared by cancelAnimationFrame on dispose.)
    expect(() => flushRaf(500)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Regression — decks with no transitions behave exactly as before
// ---------------------------------------------------------------------------

describe('presenter — no-transition deck regression', () => {
  it('next() advances the slide instantly (no transition RAF pending)', () => {
    const { doc, ids } = makeDocNoTransitions();
    const [aId, bId] = ids;
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: aId,
      onExit: vi.fn(),
    });
    try {
      testApi(presenter).next();
      expect(presenter.getCurrentSlideId()).toBe(bId);
      // No transition RAF should be pending — instant cut.
      expect(testApi(presenter).getTransitionRafHandle()).toBeNull();
    } finally {
      presenter.dispose();
    }
  });

  it('animPlayer is immediately armed after instant-cut next()', () => {
    const { doc, ids } = makeDocNoTransitions();
    const [aId] = ids;
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: aId,
      onExit: vi.fn(),
    });
    try {
      testApi(presenter).next();
      // Instant cut: player is built synchronously.
      expect(testApi(presenter).getAnimPlayer()).not.toBeNull();
    } finally {
      presenter.dispose();
    }
  });

  it('next() from the last slide goes to end-screen with no transition RAF', () => {
    const { doc, ids } = makeDocNoTransitions();
    const [, , cId] = ids;
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: cId,
      onExit: vi.fn(),
    });
    try {
      testApi(presenter).next();
      expect(presenter.isAtEndScreen()).toBe(true);
      expect(testApi(presenter).getTransitionRafHandle()).toBeNull();
    } finally {
      presenter.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 3: 'none' transition type — instant cut even with durationMs > 0
// ---------------------------------------------------------------------------

describe("presenter — transition type 'none' instant cut", () => {
  it("type:'none' transition is treated as instant cut (no RAF queued)", () => {
    const { doc, aId, bId } = makeDocWithNoneTransition();
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: aId,
      onExit: vi.fn(),
    });
    try {
      testApi(presenter).next();
      expect(presenter.getCurrentSlideId()).toBe(bId);
      // Transition RAF should NOT be running for 'none' type.
      expect(testApi(presenter).getTransitionRafHandle()).toBeNull();
      // Player should be armed immediately.
      expect(testApi(presenter).getAnimPlayer()).not.toBeNull();
    } finally {
      presenter.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 4: Regression — navigating away during an in-flight transition must
// cancel the transition so its onDone callback never fires for the wrong slide.
// ---------------------------------------------------------------------------

describe('presenter — cancel in-flight transition on back/jump navigation', () => {
  it('prev() during in-flight transition cancels the transition RAF', () => {
    const { doc, aId } = makeDocWithFadeTransition();
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: aId,
      onExit: vi.fn(),
    });
    try {
      // Advance from slide A to slide B — transition RAF goes in-flight.
      testApi(presenter).next();
      expect(testApi(presenter).getTransitionRafHandle()).not.toBeNull();

      // Navigate back BEFORE the transition completes.
      testApi(presenter).prev();

      // The transition RAF must have been cancelled.
      expect(testApi(presenter).getTransitionRafHandle()).toBeNull();
    } finally {
      presenter.dispose();
    }
  });

  it('goToFirst() during in-flight transition cancels the transition RAF', () => {
    const { doc, aId } = makeDocWithFadeTransition();
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: aId,
      onExit: vi.fn(),
    });
    try {
      testApi(presenter).next(); // transition A→B in flight
      expect(testApi(presenter).getTransitionRafHandle()).not.toBeNull();

      testApi(presenter).goToFirst();

      expect(testApi(presenter).getTransitionRafHandle()).toBeNull();
    } finally {
      presenter.dispose();
    }
  });

  it('prev() during in-flight transition: presenter ends on the slide prev() navigated to (not the transition target)', () => {
    const { doc, aId } = makeDocWithFadeTransition();
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: aId,
      onExit: vi.fn(),
    });
    try {
      // next() updates currentSlideId to bId eagerly AND starts transition RAF.
      testApi(presenter).next();
      // prev() should bring us back to aId and cancel the transition.
      testApi(presenter).prev();

      // After prev(), the presenter must be on slide A.
      expect(presenter.getCurrentSlideId()).toBe(aId);

      // Flush any remaining RAF frames (the transition was cancelled so
      // no callbacks should be pending, but drive the clock to be sure).
      flushRaf(600); // well past the 400ms transition duration

      // Still on slide A — the stale onDone did NOT fire to arm slide B.
      expect(presenter.getCurrentSlideId()).toBe(aId);
    } finally {
      presenter.dispose();
    }
  });

  it('stale transition onDone does NOT arm an animPlayer for slide B after prev()', () => {
    const { doc, aId, bId } = makeDocWithFadeTransition();
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: aId,
      onExit: vi.fn(),
    });
    try {
      testApi(presenter).next(); // starts transition A→B
      testApi(presenter).prev(); // cancels transition; moves back to A

      // Capture the animPlayer immediately after prev() (built for slide A).
      const playerAfterPrev = testApi(presenter).getAnimPlayer();
      expect(playerAfterPrev).not.toBeNull();

      // Flush frames well past durationMs — the stale transition onDone must
      // NOT run because cancelAnimationFrame cleared the pending queue.
      flushRaf(600);

      // animPlayer must still be the one for slide A, not replaced by a
      // buildPlayerFor(bId) call from a stale onDone.
      const playerAfterFlush = testApi(presenter).getAnimPlayer();

      // The presenter stays on slide A and has not been overwritten.
      expect(presenter.getCurrentSlideId()).toBe(aId);
      // The animPlayer identity must be the same object (not replaced by B's player).
      expect(playerAfterFlush).toBe(playerAfterPrev);

      // Also verify bId is never the current slide.
      expect(presenter.getCurrentSlideId()).not.toBe(bId);
    } finally {
      presenter.dispose();
    }
  });

  it('goToFirst() during in-flight transition: presenter ends on first slide and transition onDone does not fire', () => {
    const { doc, aId } = makeDocWithFadeTransition();
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: aId,
      onExit: vi.fn(),
    });
    try {
      testApi(presenter).next(); // transition A→B in flight
      testApi(presenter).goToFirst(); // cancel + jump to slide A

      const playerAfterJump = testApi(presenter).getAnimPlayer();
      expect(playerAfterJump).not.toBeNull();

      // Flush past the transition duration.
      flushRaf(600);

      // Must still be on slide A; stale onDone must not have overwritten state.
      expect(presenter.getCurrentSlideId()).toBe(aId);
      expect(testApi(presenter).getAnimPlayer()).toBe(playerAfterJump);
    } finally {
      presenter.dispose();
    }
  });
});
