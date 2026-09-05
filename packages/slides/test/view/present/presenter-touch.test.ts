// @vitest-environment jsdom
import '../../../src/view/canvas/test-canvas-env';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemSlidesStore } from '../../../src/store/memory';
import type { SlidesDocument } from '../../../src/model/presentation';
import { startPresenter } from '../../../src/view/present/presenter';

/**
 * Click-to-advance already worked under a finger. Every way BACK was a
 * key, so a deck presented from a tablet could only go forwards.
 */

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

/**
 * A container with a known width, so tap-zone maths is deterministic —
 * jsdom lays everything out at zero.
 */
function makeContainer(width = 900): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  el.getBoundingClientRect = (): DOMRect => ({
    left: 0,
    top: 0,
    width,
    height: 600,
    right: width,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  return el;
}

const touch = (
  type: string,
  x: number,
  extra: PointerEventInit = {},
): PointerEvent =>
  new PointerEvent(type, {
    clientX: x,
    clientY: 300,
    pointerId: 1,
    pointerType: 'touch',
    isPrimary: true,
    bubbles: true,
    ...extra,
  });

/**
 * Drive one finger down → up. `timeStamp` is not settable on a
 * constructed PointerEvent in jsdom (it reads 0), which is what every
 * gesture here wants anyway: an instant, deliberate swipe.
 */
function gesture(el: HTMLElement, fromX: number, toX: number): void {
  el.dispatchEvent(touch('pointerdown', fromX));
  el.dispatchEvent(touch('pointerup', toX));
}

beforeEach(() => {
  document.body.innerHTML = '';
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (HTMLElement.prototype as unknown as { requestFullscreen: () => Promise<void> })
    .requestFullscreen = vi.fn().mockResolvedValue(undefined);
});

describe('presenter touch navigation', () => {
  it('advances on a leftward swipe', () => {
    const { doc, ids } = makeDoc();
    const container = makeContainer();
    const presenter = startPresenter({
      container,
      doc,
      startSlideId: ids[0],
      onExit: vi.fn(),
    });
    try {
      gesture(container, 700, 200);
      expect(presenter.getCurrentSlideId()).toBe(ids[1]);
    } finally {
      presenter.dispose();
    }
  });

  it('goes back on a rightward swipe', () => {
    const { doc, ids } = makeDoc();
    const container = makeContainer();
    const presenter = startPresenter({
      container,
      doc,
      startSlideId: ids[2],
      onExit: vi.fn(),
    });
    try {
      gesture(container, 200, 700);
      expect(presenter.getCurrentSlideId()).toBe(ids[1]);
    } finally {
      presenter.dispose();
    }
  });

  it('ignores a swipe shorter than the threshold', () => {
    const { doc, ids } = makeDoc();
    const container = makeContainer();
    const presenter = startPresenter({
      container,
      doc,
      startSlideId: ids[1],
      onExit: vi.fn(),
    });
    try {
      // 20px is a slipped finger, not a swipe — and it is not a tap
      // either, so nothing should move.
      gesture(container, 500, 480);
      expect(presenter.getCurrentSlideId()).toBe(ids[1]);
    } finally {
      presenter.dispose();
    }
  });

  it('advances on a tap in the forward zone', () => {
    const { doc, ids } = makeDoc();
    const container = makeContainer();
    const presenter = startPresenter({
      container,
      doc,
      startSlideId: ids[0],
      onExit: vi.fn(),
    });
    try {
      gesture(container, 700, 700);
      expect(presenter.getCurrentSlideId()).toBe(ids[1]);
    } finally {
      presenter.dispose();
    }
  });

  it('goes back on a tap in the left third', () => {
    const { doc, ids } = makeDoc();
    const container = makeContainer();
    const presenter = startPresenter({
      container,
      doc,
      startSlideId: ids[2],
      onExit: vi.fn(),
    });
    try {
      gesture(container, 100, 100);
      expect(presenter.getCurrentSlideId()).toBe(ids[1]);
    } finally {
      presenter.dispose();
    }
  });

  it('does not double-advance when the synthetic click follows', () => {
    const { doc, ids } = makeDoc();
    const container = makeContainer();
    const presenter = startPresenter({
      container,
      doc,
      startSlideId: ids[0],
      onExit: vi.fn(),
    });
    try {
      gesture(container, 700, 700);
      // The browser emits this after every touch that was not
      // prevented; the canvas listener must not act on it as well.
      const canvas = container.querySelector('canvas')!;
      canvas.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(presenter.getCurrentSlideId()).toBe(ids[1]);
    } finally {
      presenter.dispose();
    }
  });

  it('leaves mouse click-to-advance working anywhere', () => {
    // The tap zones are touch-only: a mouse has arrow keys, and turning
    // the left third of the screen into "go back" would break the
    // long-standing click-anywhere behaviour.
    const { doc, ids } = makeDoc();
    const container = makeContainer();
    const presenter = startPresenter({
      container,
      doc,
      startSlideId: ids[1],
      onExit: vi.fn(),
    });
    try {
      const canvas = container.querySelector('canvas')!;
      canvas.dispatchEvent(
        new MouseEvent('click', { clientX: 50, bubbles: true }),
      );
      expect(presenter.getCurrentSlideId()).toBe(ids[2]);
    } finally {
      presenter.dispose();
    }
  });

  it('exits from the end screen on a tap', () => {
    const { doc, ids } = makeDoc();
    const container = makeContainer();
    const onExit = vi.fn();
    const presenter = startPresenter({
      container,
      doc,
      startSlideId: ids[2],
      onExit,
    });
    try {
      gesture(container, 700, 700); // last slide → end screen
      expect(presenter.isAtEndScreen()).toBe(true);
      gesture(container, 700, 700);
      expect(onExit).toHaveBeenCalled();
    } finally {
      presenter.dispose();
    }
  });

  it('ignores a second finger mid-gesture', () => {
    // A pinch is not navigation; letting the second finger overwrite
    // the anchor would turn the release into an arbitrary swipe.
    const { doc, ids } = makeDoc();
    const container = makeContainer();
    const presenter = startPresenter({
      container,
      doc,
      startSlideId: ids[1],
      onExit: vi.fn(),
    });
    try {
      container.dispatchEvent(touch('pointerdown', 700, { pointerId: 1 }));
      container.dispatchEvent(
        touch('pointerdown', 100, { pointerId: 2, isPrimary: false }),
      );
      container.dispatchEvent(
        touch('pointerup', 100, { pointerId: 2, isPrimary: false }),
      );
      expect(presenter.getCurrentSlideId()).toBe(ids[1]);
    } finally {
      presenter.dispose();
    }
  });
});
