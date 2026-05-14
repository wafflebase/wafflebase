// @vitest-environment jsdom
import '../canvas/test-canvas-env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemSlidesStore } from '../../store/memory';
import type { SlidesDocument } from '../../model/presentation';
import { SlideRenderer } from '../canvas/slide-renderer';
import { startPresenter, type Presenter } from './presenter';

interface TestHandle {
  next: () => void;
  prev: () => void;
  goToFirst: () => void;
  goToLast: () => void;
  getCanvas: () => HTMLCanvasElement;
  getLastPaintKind: () => 'slide' | 'end' | null;
}

function testApi(presenter: Presenter): TestHandle {
  return (presenter as unknown as { __test: TestHandle }).__test;
}

function makeDoc(): { doc: SlidesDocument; ids: [string, string, string] } {
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

function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
  // jsdom lacks ResizeObserver.
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // Make requestFullscreen resolve cleanly inside jsdom.
  (HTMLElement.prototype as unknown as { requestFullscreen: () => Promise<void> })
    .requestFullscreen = vi.fn().mockResolvedValue(undefined);
});

describe('startPresenter — initial state', () => {
  it('starts at the requested slide id and not at end-screen', () => {
    const { doc, ids } = makeDoc();
    const [, bId] = ids;
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: bId,
      onExit: vi.fn(),
    });
    try {
      expect(presenter.getCurrentSlideId()).toBe(bId);
      expect(presenter.isAtEndScreen()).toBe(false);
    } finally {
      presenter.dispose();
    }
  });
});

describe('startPresenter — next()', () => {
  it('advances A → B', () => {
    const { doc, ids } = makeDoc();
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
      expect(presenter.isAtEndScreen()).toBe(false);
    } finally {
      presenter.dispose();
    }
  });

  it('next() from the last slide enters the end-screen', () => {
    const { doc, ids } = makeDoc();
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
      expect(presenter.getCurrentSlideId()).toBeNull();
    } finally {
      presenter.dispose();
    }
  });

  it('next() while at end-screen is a no-op (no auto-exit)', () => {
    const { doc, ids } = makeDoc();
    const [, , cId] = ids;
    const onExit = vi.fn();
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: cId,
      onExit,
    });
    try {
      testApi(presenter).next();
      expect(presenter.isAtEndScreen()).toBe(true);
      testApi(presenter).next();
      expect(presenter.isAtEndScreen()).toBe(true);
      expect(presenter.getCurrentSlideId()).toBeNull();
      expect(onExit).not.toHaveBeenCalled();
    } finally {
      presenter.dispose();
    }
  });
});

describe('startPresenter — prev()', () => {
  it('goes B → A', () => {
    const { doc, ids } = makeDoc();
    const [aId, bId] = ids;
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: bId,
      onExit: vi.fn(),
    });
    try {
      testApi(presenter).prev();
      expect(presenter.getCurrentSlideId()).toBe(aId);
    } finally {
      presenter.dispose();
    }
  });

  it('stays at A when already at the first slide', () => {
    const { doc, ids } = makeDoc();
    const [aId] = ids;
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: aId,
      onExit: vi.fn(),
    });
    try {
      testApi(presenter).prev();
      expect(presenter.getCurrentSlideId()).toBe(aId);
      expect(presenter.isAtEndScreen()).toBe(false);
    } finally {
      presenter.dispose();
    }
  });

  it('from end-screen returns to the last slide and clears the flag', () => {
    const { doc, ids } = makeDoc();
    const [, , cId] = ids;
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: cId,
      onExit: vi.fn(),
    });
    try {
      testApi(presenter).next(); // → end-screen
      expect(presenter.isAtEndScreen()).toBe(true);
      testApi(presenter).prev();
      expect(presenter.isAtEndScreen()).toBe(false);
      expect(presenter.getCurrentSlideId()).toBe(cId);
    } finally {
      presenter.dispose();
    }
  });
});

describe('startPresenter — goToFirst() / goToLast()', () => {
  it('goToFirst jumps to the first slide', () => {
    const { doc, ids } = makeDoc();
    const [aId, , cId] = ids;
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: cId,
      onExit: vi.fn(),
    });
    try {
      testApi(presenter).goToFirst();
      expect(presenter.getCurrentSlideId()).toBe(aId);
      expect(presenter.isAtEndScreen()).toBe(false);
    } finally {
      presenter.dispose();
    }
  });

  it('goToLast jumps to the last slide', () => {
    const { doc, ids } = makeDoc();
    const [aId, , cId] = ids;
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: aId,
      onExit: vi.fn(),
    });
    try {
      testApi(presenter).goToLast();
      expect(presenter.getCurrentSlideId()).toBe(cId);
      expect(presenter.isAtEndScreen()).toBe(false);
    } finally {
      presenter.dispose();
    }
  });

  it('goToFirst clears the end-screen flag', () => {
    const { doc, ids } = makeDoc();
    const [aId, , cId] = ids;
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: cId,
      onExit: vi.fn(),
    });
    try {
      testApi(presenter).next(); // → end-screen
      expect(presenter.isAtEndScreen()).toBe(true);
      testApi(presenter).goToFirst();
      expect(presenter.isAtEndScreen()).toBe(false);
      expect(presenter.getCurrentSlideId()).toBe(aId);
    } finally {
      presenter.dispose();
    }
  });

  it('goToLast clears the end-screen flag', () => {
    const { doc, ids } = makeDoc();
    const [, , cId] = ids;
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: cId,
      onExit: vi.fn(),
    });
    try {
      testApi(presenter).next(); // → end-screen
      expect(presenter.isAtEndScreen()).toBe(true);
      testApi(presenter).goToLast();
      expect(presenter.isAtEndScreen()).toBe(false);
      expect(presenter.getCurrentSlideId()).toBe(cId);
    } finally {
      presenter.dispose();
    }
  });
});

// jsdom's CanvasRenderingContext2D is a stub that doesn't actually
// commit pixels, so we verify the end-screen branch via a
// `lastPaintKind` side-effect exposed through `__test`. This tests
// intent (which branch ran) rather than rendered output, and avoids
// pulling in node-canvas for a single check.
describe('startPresenter — canvas mount and paint', () => {
  it('mounts a canvas into the container sized to dpr * fitted box', () => {
    const { doc, ids } = makeDoc();
    const [aId] = ids;
    const container = makeContainer();
    // jsdom defaults: window.innerWidth=1024, window.innerHeight=768.
    // 1024 / (16/9) = 576 < 768 → width-binding fit.
    expect(window.innerWidth).toBe(1024);
    expect(window.innerHeight).toBe(768);
    const dpr = window.devicePixelRatio || 1;
    const presenter = startPresenter({
      container,
      doc,
      startSlideId: aId,
      onExit: vi.fn(),
    });
    try {
      const canvas = container.querySelector('canvas');
      expect(canvas).not.toBeNull();
      const expectedCssWidth = Math.round(1024);
      const expectedCssHeight = Math.round(1024 / (16 / 9));
      expect(canvas!.width).toBe(Math.round(expectedCssWidth * dpr));
      expect(canvas!.height).toBe(Math.round(expectedCssHeight * dpr));
      expect(canvas!.style.width).toBe(`${expectedCssWidth}px`);
      expect(canvas!.style.height).toBe(`${expectedCssHeight}px`);
    } finally {
      presenter.dispose();
    }
  });

  it('letterbox styles applied to container on mount', () => {
    const { doc, ids } = makeDoc();
    const [aId] = ids;
    const container = makeContainer();
    const presenter = startPresenter({
      container,
      doc,
      startSlideId: aId,
      onExit: vi.fn(),
    });
    try {
      // Black backdrop + flex centering so the canvas sits inside a
      // letterbox when the viewport aspect differs from 16:9.
      expect(container.style.background).toBe('rgb(0, 0, 0)');
      expect(container.style.display).toBe('flex');
      expect(container.style.alignItems).toBe('center');
      expect(container.style.justifyContent).toBe('center');
    } finally {
      presenter.dispose();
    }
  });

  it('next() triggers a fresh SlideRenderer.render call', () => {
    const renderSpy = vi.spyOn(SlideRenderer.prototype, 'render');
    const { doc, ids } = makeDoc();
    const [aId, bId] = ids;
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: aId,
      onExit: vi.fn(),
    });
    try {
      const callsBefore = renderSpy.mock.calls.length;
      testApi(presenter).next();
      expect(renderSpy.mock.calls.length).toBe(callsBefore + 1);
      const lastCall = renderSpy.mock.calls[renderSpy.mock.calls.length - 1];
      expect((lastCall[0] as { id: string }).id).toBe(bId);
    } finally {
      presenter.dispose();
      renderSpy.mockRestore();
    }
  });

  it('end-screen state paints via the raw 2D context and does not call SlideRenderer.render', () => {
    const renderSpy = vi.spyOn(SlideRenderer.prototype, 'render');
    const { doc, ids } = makeDoc();
    const [, , cId] = ids;
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: cId,
      onExit: vi.fn(),
    });
    try {
      // Mount paint on slide C consumed one call; baseline from here.
      const callsBefore = renderSpy.mock.calls.length;
      testApi(presenter).next(); // → end-screen
      expect(presenter.isAtEndScreen()).toBe(true);
      expect(renderSpy.mock.calls.length).toBe(callsBefore);
      expect(testApi(presenter).getLastPaintKind()).toBe('end');
    } finally {
      presenter.dispose();
      renderSpy.mockRestore();
    }
  });
});

describe('startPresenter — dispose()', () => {
  it('is idempotent', () => {
    const { doc, ids } = makeDoc();
    const [aId] = ids;
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: aId,
      onExit: vi.fn(),
    });
    expect(() => {
      presenter.dispose();
      presenter.dispose();
    }).not.toThrow();
  });

  it('navigation after dispose() is a no-op', () => {
    const { doc, ids } = makeDoc();
    const [aId] = ids;
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: aId,
      onExit: vi.fn(),
    });
    presenter.dispose();
    const before = presenter.getCurrentSlideId();
    testApi(presenter).next();
    expect(presenter.getCurrentSlideId()).toBe(before);
    expect(presenter.isAtEndScreen()).toBe(false);
  });
});

describe('dispose — cleanup', () => {
  afterEach(() => {
    delete (document as unknown as { fullscreenElement?: unknown }).fullscreenElement;
  });

  it('removes the canvas from the container', () => {
    const { doc, ids } = makeDoc();
    const container = makeContainer();
    const presenter = startPresenter({
      container,
      doc,
      startSlideId: ids[0],
      onExit: vi.fn(),
    });
    expect(container.querySelector('canvas')).not.toBeNull();
    presenter.dispose();
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('restores container.style.cssText to its pre-mount snapshot', () => {
    const { doc, ids } = makeDoc();
    const container = makeContainer();
    // Set inline styles BEFORE mount so dispose() can restore them.
    container.style.background = 'red';
    container.style.padding = '10px';
    expect(container.style.background).toBe('red');
    const presenter = startPresenter({
      container,
      doc,
      startSlideId: ids[0],
      onExit: vi.fn(),
    });
    // Letterbox styles overwrote background while mounted.
    expect(container.style.background).toBe('rgb(0, 0, 0)');
    presenter.dispose();
    expect(container.style.background).toBe('red');
    expect(container.style.padding).toBe('10px');
  });

  it('removes the document keydown listener', () => {
    const { doc, ids } = makeDoc();
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: ids[0],
      onExit: vi.fn(),
    });
    expect(presenter.getCurrentSlideId()).toBe(ids[0]);
    presenter.dispose();
    // After dispose, ArrowRight on document must not change state.
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    expect(presenter.getCurrentSlideId()).toBe(ids[0]);
    expect(presenter.isAtEndScreen()).toBe(false);
  });

  it('removes the canvas click listener', () => {
    const { doc, ids } = makeDoc();
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: ids[0],
      onExit: vi.fn(),
    });
    const canvas = testApi(presenter).getCanvas();
    presenter.dispose();
    // The canvas reference is still around even after removal from
    // the DOM — dispatch a click and confirm no state change.
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(presenter.getCurrentSlideId()).toBe(ids[0]);
  });

  it('disconnects the ResizeObserver', () => {
    const observers: Array<{ disconnectCalled: boolean }> = [];
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      disconnectCalled = false;
      constructor() {
        observers.push(this);
      }
      observe() {}
      unobserve() {}
      disconnect() {
        this.disconnectCalled = true;
      }
    };
    const { doc, ids } = makeDoc();
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: ids[0],
      onExit: vi.fn(),
    });
    expect(observers.length).toBe(1);
    expect(observers[0].disconnectCalled).toBe(false);
    presenter.dispose();
    expect(observers[0].disconnectCalled).toBe(true);
  });

  it('clears the cursor-hide timeout', () => {
    vi.useFakeTimers();
    try {
      const { doc, ids } = makeDoc();
      const container = makeContainer();
      const presenter = startPresenter({
        container,
        doc,
        startSlideId: ids[0],
        onExit: vi.fn(),
      });
      // Dispose immediately, before the 3 s timer fires.
      presenter.dispose();
      vi.advanceTimersByTime(3_000);
      // The cursor should never have been set to 'none'; the inline
      // cssText was restored on dispose anyway, so the assertion is
      // simply that nothing flipped to 'none' afterwards.
      expect(container.style.cursor).not.toBe('none');
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes the fullscreenchange listener', async () => {
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => null,
    });
    const onExit = vi.fn();
    const { doc, ids } = makeDoc();
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: ids[0],
      onExit,
    });
    // Let enteredFullscreen flip true so the handler would otherwise
    // fire on a dispatched fullscreenchange.
    await Promise.resolve();
    await Promise.resolve();
    presenter.dispose();
    onExit.mockClear();
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(onExit).not.toHaveBeenCalled();
  });

  it('calls exitFullscreen when in fullscreen mode', async () => {
    const container = makeContainer();
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => container,
    });
    const exitSpy = vi.fn().mockResolvedValue(undefined);
    (document as unknown as { exitFullscreen: () => Promise<void> }).exitFullscreen = exitSpy;
    const { doc, ids } = makeDoc();
    const presenter = startPresenter({
      container,
      doc,
      startSlideId: ids[0],
      onExit: vi.fn(),
    });
    // Wait for the resolved requestFullscreen Promise to flip
    // enteredFullscreen true.
    await Promise.resolve();
    await Promise.resolve();
    presenter.dispose();
    expect(exitSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT call exitFullscreen when in overlay mode', async () => {
    (HTMLElement.prototype as unknown as { requestFullscreen: () => Promise<void> })
      .requestFullscreen = vi.fn().mockRejectedValue(new Error('denied'));
    const exitSpy = vi.fn().mockResolvedValue(undefined);
    (document as unknown as { exitFullscreen: () => Promise<void> }).exitFullscreen = exitSpy;
    const { doc, ids } = makeDoc();
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: ids[0],
      onExit: vi.fn(),
    });
    await Promise.resolve();
    await Promise.resolve();
    presenter.dispose();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('is idempotent: second dispose call is a no-op', () => {
    const { doc, ids } = makeDoc();
    const container = makeContainer();
    const presenter = startPresenter({
      container,
      doc,
      startSlideId: ids[0],
      onExit: vi.fn(),
    });
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    presenter.dispose();
    const callsAfterFirst = removeSpy.mock.calls.length;
    expect(() => presenter.dispose()).not.toThrow();
    // Second dispose returns early — no further removeEventListener
    // calls, canvas stays removed, container cssText stays restored.
    expect(removeSpy.mock.calls.length).toBe(callsAfterFirst);
    expect(container.querySelector('canvas')).toBeNull();
    removeSpy.mockRestore();
  });
});

interface KeyboardHandle {
  presenter: Presenter;
  ids: [string, string, string];
  onExit: ReturnType<typeof vi.fn>;
}

function mountAt(slideIdx: 0 | 1 | 2): KeyboardHandle {
  const { doc, ids } = makeDoc();
  const onExit = vi.fn();
  const presenter = startPresenter({
    container: makeContainer(),
    doc,
    startSlideId: ids[slideIdx],
    onExit,
  });
  return { presenter, ids, onExit };
}

function dispatchKey(key: string, extra: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
  document.dispatchEvent(ev);
  return ev;
}

describe('startPresenter — keyboard', () => {
  it('ArrowRight, Space, PageDown, n, N each advance to the next slide', () => {
    const keys = ['ArrowRight', ' ', 'PageDown', 'n', 'N'];
    for (const key of keys) {
      const { presenter, ids } = mountAt(0);
      try {
        dispatchKey(key);
        expect(presenter.getCurrentSlideId()).toBe(ids[1]);
        expect(presenter.isAtEndScreen()).toBe(false);
      } finally {
        presenter.dispose();
      }
    }
  });

  it('ArrowLeft, PageUp, Backspace, p, P each move to the previous slide', () => {
    const keys = ['ArrowLeft', 'PageUp', 'Backspace', 'p', 'P'];
    for (const key of keys) {
      const { presenter, ids } = mountAt(1);
      try {
        dispatchKey(key);
        expect(presenter.getCurrentSlideId()).toBe(ids[0]);
        expect(presenter.isAtEndScreen()).toBe(false);
      } finally {
        presenter.dispose();
      }
    }
  });

  it('Home jumps to the first slide; End jumps to the last', () => {
    {
      const { presenter, ids } = mountAt(2);
      try {
        dispatchKey('Home');
        expect(presenter.getCurrentSlideId()).toBe(ids[0]);
      } finally {
        presenter.dispose();
      }
    }
    {
      const { presenter, ids } = mountAt(0);
      try {
        dispatchKey('End');
        expect(presenter.getCurrentSlideId()).toBe(ids[2]);
      } finally {
        presenter.dispose();
      }
    }
  });

  it('Escape calls onExit (does not dispose)', () => {
    const { presenter, ids, onExit } = mountAt(0);
    try {
      dispatchKey('Escape');
      expect(onExit).toHaveBeenCalledOnce();
      // Presenter is NOT disposed — the caller decides. State queries
      // and navigation still work.
      expect(presenter.getCurrentSlideId()).toBe(ids[0]);
      testApi(presenter).next();
      expect(presenter.getCurrentSlideId()).toBe(ids[1]);
    } finally {
      presenter.dispose();
    }
  });

  it('next() past the last slide enters the end-screen via ArrowRight', () => {
    const { presenter, onExit } = mountAt(2);
    try {
      dispatchKey('ArrowRight');
      expect(presenter.isAtEndScreen()).toBe(true);
      // Pressing ArrowRight again at end-screen stays put; keyboard
      // does not trigger onExit from the end-screen — click does.
      dispatchKey('ArrowRight');
      expect(presenter.isAtEndScreen()).toBe(true);
      expect(onExit).not.toHaveBeenCalled();
    } finally {
      presenter.dispose();
    }
  });

  it('Cmd+Z (or any unhandled key) is swallowed: preventDefault + stopImmediatePropagation', () => {
    const { presenter } = mountAt(0);
    try {
      const ev = new KeyboardEvent('keydown', {
        key: 'z',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });
      const stopSpy = vi.spyOn(ev, 'stopImmediatePropagation');
      document.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
      expect(stopSpy).toHaveBeenCalledOnce();
    } finally {
      presenter.dispose();
    }
  });

  it('keydown listener is installed in capture phase', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const { doc, ids } = makeDoc();
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: ids[0],
      onExit: vi.fn(),
    });
    try {
      const keydownCall = addSpy.mock.calls.find(
        (args) => args[0] === 'keydown',
      );
      expect(keydownCall).toBeDefined();
      const options = keydownCall![2];
      expect(options).toBeDefined();
      // Accept either `true` or `{ capture: true }`.
      const captured =
        options === true ||
        (typeof options === 'object' && options !== null && (options as AddEventListenerOptions).capture === true);
      expect(captured).toBe(true);
    } finally {
      presenter.dispose();
      addSpy.mockRestore();
    }
  });
});

describe('startPresenter — click-to-advance', () => {
  it('click on canvas advances to the next slide', () => {
    const { presenter, ids } = mountAt(0);
    try {
      const canvas = testApi(presenter).getCanvas();
      canvas.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(presenter.getCurrentSlideId()).toBe(ids[1]);
    } finally {
      presenter.dispose();
    }
  });

  it('click on canvas while at end-screen invokes onExit', () => {
    const { presenter, onExit } = mountAt(2);
    try {
      testApi(presenter).next(); // → end-screen
      expect(presenter.isAtEndScreen()).toBe(true);
      expect(onExit).not.toHaveBeenCalled();
      const canvas = testApi(presenter).getCanvas();
      canvas.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(onExit).toHaveBeenCalledOnce();
    } finally {
      presenter.dispose();
    }
  });
});

describe('startPresenter — cursor auto-hide', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('hides the cursor after 3 s of no mousemove', () => {
    const { doc, ids } = makeDoc();
    const container = makeContainer();
    const presenter = startPresenter({
      container,
      doc,
      startSlideId: ids[0],
      onExit: vi.fn(),
    });
    try {
      // Initial timer is armed at mount; before the delay elapses
      // the cursor must still be its default (empty inline style).
      expect(container.style.cursor).toBe('');
      vi.advanceTimersByTime(3_000);
      expect(container.style.cursor).toBe('none');
    } finally {
      presenter.dispose();
    }
  });

  it('mousemove restores the cursor and re-arms the hide timer', () => {
    const { doc, ids } = makeDoc();
    const container = makeContainer();
    const presenter = startPresenter({
      container,
      doc,
      startSlideId: ids[0],
      onExit: vi.fn(),
    });
    try {
      vi.advanceTimersByTime(3_000);
      expect(container.style.cursor).toBe('none');

      container.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      expect(container.style.cursor).toBe('');

      vi.advanceTimersByTime(2_999);
      expect(container.style.cursor).toBe('');

      vi.advanceTimersByTime(1);
      expect(container.style.cursor).toBe('none');
    } finally {
      presenter.dispose();
    }
  });
});

describe('startPresenter — fullscreen', () => {
  afterEach(() => {
    // Some tests below stub `document.fullscreenElement` with a
    // configurable getter — clear it so later suites see jsdom's
    // default and don't inherit a stale stub.
    delete (document as unknown as { fullscreenElement?: unknown }).fullscreenElement;
  });

  it('calls container.requestFullscreen on mount', () => {
    const req = vi
      .spyOn(HTMLElement.prototype, 'requestFullscreen')
      .mockResolvedValue(undefined);
    const { doc, ids } = makeDoc();
    const container = makeContainer();
    const presenter = startPresenter({
      container,
      doc,
      startSlideId: ids[0],
      onExit: vi.fn(),
    });
    try {
      expect(req).toHaveBeenCalledTimes(1);
      // requestFullscreen is invoked on the container element.
      expect(req.mock.instances[0]).toBe(container);
    } finally {
      presenter.dispose();
      req.mockRestore();
    }
  });

  it('falls back to overlay styles when requestFullscreen rejects', async () => {
    (HTMLElement.prototype as unknown as { requestFullscreen: () => Promise<void> })
      .requestFullscreen = vi.fn().mockRejectedValue(new Error('denied'));
    const { doc, ids } = makeDoc();
    const container = makeContainer();
    const presenter = startPresenter({
      container,
      doc,
      startSlideId: ids[0],
      onExit: vi.fn(),
    });
    try {
      // The .catch handler runs on the microtask queue; flush once for
      // the resolved-promise hop, again for the .catch continuation.
      await Promise.resolve();
      await Promise.resolve();
      expect(container.style.position).toBe('fixed');
      expect(container.style.top).toBe('0px');
      expect(container.style.left).toBe('0px');
      expect(container.style.right).toBe('0px');
      expect(container.style.bottom).toBe('0px');
      expect(container.style.zIndex).toBe('9999');
    } finally {
      presenter.dispose();
    }
  });

  it('fullscreenchange to null triggers onExit when mounted in fullscreen', async () => {
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => null,
    });
    const onExit = vi.fn();
    const { doc, ids } = makeDoc();
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: ids[0],
      onExit,
    });
    try {
      // Wait for the resolved requestFullscreen Promise to settle so
      // `enteredFullscreen` flips to `true` inside the `.then`
      // continuation. Without this flush the handler would (correctly)
      // ignore the dispatched event.
      await Promise.resolve();
      await Promise.resolve();
      document.dispatchEvent(new Event('fullscreenchange'));
      expect(onExit).toHaveBeenCalledTimes(1);
    } finally {
      presenter.dispose();
    }
  });

  it('fullscreenchange does NOT trigger onExit in overlay mode', async () => {
    (HTMLElement.prototype as unknown as { requestFullscreen: () => Promise<void> })
      .requestFullscreen = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => null,
    });
    const onExit = vi.fn();
    const { doc, ids } = makeDoc();
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: ids[0],
      onExit,
    });
    try {
      // Settle the rejected Promise so mountMode flips to 'overlay'.
      // `enteredFullscreen` stays false since the `.then` never ran.
      await Promise.resolve();
      await Promise.resolve();
      document.dispatchEvent(new Event('fullscreenchange'));
      expect(onExit).not.toHaveBeenCalled();
    } finally {
      presenter.dispose();
    }
  });

  it('fullscreenchange before requestFullscreen resolves does NOT trigger onExit', async () => {
    // Pending forever — `enteredFullscreen` never flips to true. A
    // stray fullscreenchange (e.g. some other element on the page
    // exiting fullscreen while ours is still pending) must not be
    // mistaken for our own exit.
    (HTMLElement.prototype as unknown as { requestFullscreen: () => Promise<void> })
      .requestFullscreen = vi.fn().mockReturnValue(new Promise<void>(() => {}));
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => null,
    });
    const onExit = vi.fn();
    const { doc, ids } = makeDoc();
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: ids[0],
      onExit,
    });
    try {
      // Even after flushing, the pending Promise above never resolves,
      // so `enteredFullscreen` remains false.
      await Promise.resolve();
      await Promise.resolve();
      document.dispatchEvent(new Event('fullscreenchange'));
      expect(onExit).not.toHaveBeenCalled();
    } finally {
      presenter.dispose();
    }
  });

  it('fullscreenchange while our container is still the fullscreen element does NOT trigger onExit', async () => {
    // Identity check: our container IS the fullscreen element. A
    // fullscreenchange that leaves us as the fullscreen element (e.g.
    // dispatched spuriously, or paired with a sibling transition that
    // doesn't dethrone us) must not exit the presenter.
    const onExit = vi.fn();
    const { doc, ids } = makeDoc();
    const container = makeContainer();
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => container,
    });
    const presenter = startPresenter({
      container,
      doc,
      startSlideId: ids[0],
      onExit,
    });
    try {
      // Flush so `enteredFullscreen` becomes true via the resolved
      // requestFullscreen Promise from the global beforeEach.
      await Promise.resolve();
      await Promise.resolve();
      document.dispatchEvent(new Event('fullscreenchange'));
      expect(onExit).not.toHaveBeenCalled();
    } finally {
      presenter.dispose();
    }
  });
});

// Yorkie pushes store snapshots into the presenter via setDocument
// while the presentation runs. These tests cover the four real-world
// branches: unchanged deck (theme/element edits), current slide kept
// despite structural edits, current slide deleted with the original
// index either valid or out of bounds, and an empty deck triggering
// onExit. The atEndScreen flag must survive any structural change
// short of emptying the deck — the presentation is still "over".
describe('startPresenter — setDocument remote changes', () => {
  // Build a fresh 3-slide fixture and return a function that produces
  // a new SlidesDocument with the specified slide ids removed. Uses
  // MemSlidesStore so all mutations flow through the supported API.
  function makeDocWithRemovals(): {
    doc: SlidesDocument;
    ids: [string, string, string];
    store: MemSlidesStore;
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
    return { doc: store.read(), ids: [aId, bId, cId], store };
  }

  it('preserves currentSlideId and re-renders when the current slide still exists', () => {
    const renderSpy = vi.spyOn(SlideRenderer.prototype, 'render');
    const { doc, ids, store } = makeDocWithRemovals();
    const [, bId] = ids;
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: bId,
      onExit: vi.fn(),
    });
    try {
      const callsBefore = renderSpy.mock.calls.length;
      // Same deck snapshot, no structural change. Calls re-render.
      presenter.setDocument(store.read());
      expect(presenter.getCurrentSlideId()).toBe(bId);
      expect(presenter.isAtEndScreen()).toBe(false);
      expect(renderSpy.mock.calls.length).toBe(callsBefore + 1);
    } finally {
      presenter.dispose();
      renderSpy.mockRestore();
    }
  });

  it('jumps to the slide at the same index when the current slide is deleted', () => {
    const { doc, ids, store } = makeDocWithRemovals();
    const [, bId, cId] = ids;
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: bId,
      onExit: vi.fn(),
    });
    try {
      // Remove B → new array is [A, C]; index 1 is now C.
      store.batch(() => store.removeSlide(bId));
      presenter.setDocument(store.read());
      expect(presenter.getCurrentSlideId()).toBe(cId);
      expect(presenter.isAtEndScreen()).toBe(false);
    } finally {
      presenter.dispose();
    }
  });

  it('falls back to the last slide when the deleted current slide index is out of bounds', () => {
    const { doc, ids, store } = makeDocWithRemovals();
    const [aId, bId, cId] = ids;
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: cId,
      onExit: vi.fn(),
    });
    try {
      // Remove B and C → new array is [A]; index 2 is OOB → clamp to A.
      store.batch(() => {
        store.removeSlide(bId);
        store.removeSlide(cId);
      });
      presenter.setDocument(store.read());
      expect(presenter.getCurrentSlideId()).toBe(aId);
      expect(presenter.isAtEndScreen()).toBe(false);
    } finally {
      presenter.dispose();
    }
  });

  it('calls onExit when the deck becomes empty', () => {
    const { doc, ids, store } = makeDocWithRemovals();
    const [aId, bId, cId] = ids;
    const onExit = vi.fn();
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: aId,
      onExit,
    });
    try {
      store.batch(() => {
        store.removeSlide(aId);
        store.removeSlide(bId);
        store.removeSlide(cId);
      });
      presenter.setDocument(store.read());
      expect(onExit).toHaveBeenCalledOnce();
    } finally {
      presenter.dispose();
    }
  });

  it('preserves end-screen state when the deck is unchanged', () => {
    const { doc, ids, store } = makeDocWithRemovals();
    const [, , cId] = ids;
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: cId,
      onExit: vi.fn(),
    });
    try {
      testApi(presenter).next(); // → end-screen
      expect(presenter.isAtEndScreen()).toBe(true);
      presenter.setDocument(store.read());
      expect(presenter.isAtEndScreen()).toBe(true);
      expect(presenter.getCurrentSlideId()).toBeNull();
    } finally {
      presenter.dispose();
    }
  });

  it('preserves end-screen state even when slides shrink below the original tail', () => {
    const { doc, ids, store } = makeDocWithRemovals();
    const [, bId, cId] = ids;
    const presenter = startPresenter({
      container: makeContainer(),
      doc,
      startSlideId: cId,
      onExit: vi.fn(),
    });
    try {
      testApi(presenter).next(); // → end-screen
      expect(presenter.isAtEndScreen()).toBe(true);
      // Shrink the deck (C and B removed); only A remains. The
      // presentation is still "over" — the end-screen survives.
      store.batch(() => {
        store.removeSlide(bId);
        store.removeSlide(cId);
      });
      presenter.setDocument(store.read());
      expect(presenter.isAtEndScreen()).toBe(true);
      expect(presenter.getCurrentSlideId()).toBeNull();
    } finally {
      presenter.dispose();
    }
  });
});
