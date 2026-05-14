// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemSlidesStore } from '../../store/memory';
import type { SlidesDocument } from '../../model/presentation';
import { startPresenter, type Presenter } from './presenter';

interface TestHandle {
  next: () => void;
  prev: () => void;
  goToFirst: () => void;
  goToLast: () => void;
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
});
