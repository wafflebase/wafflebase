// @vitest-environment jsdom
import '../canvas/test-canvas-env';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
