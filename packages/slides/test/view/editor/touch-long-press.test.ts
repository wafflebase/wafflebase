// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { MemSlidesStore } from '../../../src/store/memory';
import { initialize, type SlidesEditor } from '../../../src/view/editor/editor';
import { dismiss } from '../../../src/view/editor/context-menu';
import { LONG_PRESS_DELAY_MS } from '../../../src/view/editor/interactions/drag';

/**
 * A finger has no second button, so the editor times a held press
 * itself rather than waiting for `contextmenu` — which iOS withholds
 * wherever `-webkit-touch-callout: none` is set, and the mobile slides
 * shell sets it deliberately.
 */

let editor: SlidesEditor | null = null;

function mount(): {
  canvas: HTMLCanvasElement;
  elementId: string;
  store: MemSlidesStore;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);
  const store = new MemSlidesStore();
  store.batch(() => store.addSlide('blank'));
  let elementId = '';
  store.batch(() => {
    const sid = store.read().slides[0].id;
    elementId = store.addElement(sid, {
      type: 'shape',
      frame: { x: 0, y: 0, w: 200, h: 200, rotation: 0 },
      data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
    });
  });
  editor = initialize({
    canvas,
    overlay,
    store,
    hostWidth: 1920,
    hostHeight: 1080,
    dpr: 1,
  });
  return { canvas, elementId, store };
}

const touch = (
  type: string,
  x: number,
  y: number,
  extra: PointerEventInit = {},
) =>
  new PointerEvent(type, {
    clientX: x,
    clientY: y,
    pointerType: 'touch',
    isPrimary: true,
    bubbles: true,
    ...extra,
  });

const menu = () => document.body.querySelector('.wfb-slides-context-menu');

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
});

afterEach(() => {
  dismiss();
  editor?.detach();
  editor = null;
  vi.useRealTimers();
});

describe('touch long-press → context menu', () => {
  it('opens the menu after a press held still', () => {
    const { canvas } = mount();
    canvas.dispatchEvent(touch('pointerdown', 50, 50));
    expect(menu()).toBeNull();
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS);
    expect(menu()).toBeTruthy();
  });

  it('offers the element menu when the press is on an element', () => {
    const { canvas } = mount();
    canvas.dispatchEvent(touch('pointerdown', 50, 50));
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS);
    const labels = [...document.body.querySelectorAll('li')].map(
      (li) => li.textContent ?? '',
    );
    expect(labels).toContain('Delete');
  });

  it('does not open when the press became a drag', () => {
    const { canvas } = mount();
    canvas.dispatchEvent(touch('pointerdown', 50, 50));
    document.dispatchEvent(touch('pointermove', 90, 50));
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS);
    expect(menu()).toBeNull();
  });

  it('tolerates the jitter of a finger holding still', () => {
    const { canvas } = mount();
    canvas.dispatchEvent(touch('pointerdown', 50, 50));
    document.dispatchEvent(touch('pointermove', 54, 52));
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS);
    expect(menu()).toBeTruthy();
  });

  it('does not open after the finger lifts', () => {
    const { canvas } = mount();
    canvas.dispatchEvent(touch('pointerdown', 50, 50));
    document.dispatchEvent(touch('pointerup', 50, 50));
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS);
    expect(menu()).toBeNull();
  });

  it('does not open when the platform cancels the pointer', () => {
    const { canvas } = mount();
    canvas.dispatchEvent(touch('pointerdown', 50, 50));
    document.dispatchEvent(touch('pointercancel', 50, 50));
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS);
    expect(menu()).toBeNull();
  });

  it('is not armed for a mouse press', () => {
    // A mouse has a right button; timing its left one would fire a menu
    // on every deliberate slow drag.
    const { canvas } = mount();
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        clientX: 50,
        clientY: 50,
        pointerType: 'mouse',
        isPrimary: true,
        bubbles: true,
      }),
    );
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS);
    expect(menu()).toBeNull();
  });

  it('does not fire after the editor is detached mid-press', () => {
    const { canvas } = mount();
    canvas.dispatchEvent(touch('pointerdown', 50, 50));
    editor?.detach();
    editor = null;
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS);
    expect(menu()).toBeNull();
  });
});

/**
 * The per-device threshold used to gate only the snap corrections,
 * never the commit — so raising it for touch changed when the grid
 * engaged and nothing else, and a tap still nudged what it landed on.
 */
describe('touch commit gating', () => {
  it('a fingertip tremor on an element commits nothing', () => {
    const { canvas, store } = mount();
    const before = { ...store.read().slides[0].elements[0].frame };
    // One press: it selects the element and arms the move drag in the
    // same gesture, which is what a tap on an unselected shape is.
    canvas.dispatchEvent(touch('pointerdown', 50, 50));
    document.dispatchEvent(touch('pointermove', 55, 53));
    document.dispatchEvent(touch('pointerup', 55, 53));
    const after = store.read().slides[0].elements[0].frame;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });

  it('a mouse tremor still commits, unchanged', () => {
    // A mouse reporting 1px of travel was moved 1px on purpose, and
    // slides has always committed that. The gate is touch-only.
    const { canvas, store } = mount();
    const before = { ...store.read().slides[0].elements[0].frame };
    const mouse = (type: string, x: number, y: number) =>
      new PointerEvent(type, {
        clientX: x,
        clientY: y,
        pointerType: 'mouse',
        isPrimary: true,
        bubbles: true,
      });
    canvas.dispatchEvent(mouse('pointerdown', 50, 50));
    document.dispatchEvent(mouse('pointermove', 51, 51));
    document.dispatchEvent(mouse('pointerup', 51, 51));
    const after = store.read().slides[0].elements[0].frame;
    expect(after.x).toBeGreaterThan(before.x);
  });

  it('a long press aborts the drag it fired on top of', () => {
    // "Hold, then drag" is a natural grab. Without the abort the menu
    // opens and the element keeps following the finger underneath it,
    // committing on release.
    const { canvas, store } = mount();
    const before = { ...store.read().slides[0].elements[0].frame };
    canvas.dispatchEvent(touch('pointerdown', 50, 50));
    document.dispatchEvent(touch('pointerup', 50, 50));
    canvas.dispatchEvent(touch('pointerdown', 50, 50));
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS);
    expect(menu()).toBeTruthy();
    // The gesture's listeners are gone, so these do nothing.
    document.dispatchEvent(touch('pointermove', 250, 50));
    document.dispatchEvent(touch('pointerup', 250, 50));
    const after = store.read().slides[0].elements[0].frame;
    expect(after.x).toBe(before.x);
  });

  it('a pointercancel abandons the drag instead of leaving it live', () => {
    // The platform taking a gesture away used to leave the document
    // listeners installed, so the next release anywhere committed a
    // translate the user had abandoned.
    const { canvas, store } = mount();
    const before = { ...store.read().slides[0].elements[0].frame };
    canvas.dispatchEvent(touch('pointerdown', 50, 50));
    document.dispatchEvent(touch('pointerup', 50, 50));
    canvas.dispatchEvent(touch('pointerdown', 50, 50));
    document.dispatchEvent(touch('pointermove', 200, 50));
    document.dispatchEvent(touch('pointercancel', 200, 50));
    document.dispatchEvent(touch('pointerup', 400, 50));
    const after = store.read().slides[0].elements[0].frame;
    expect(after.x).toBe(before.x);
  });

  it('is not armed on a selection handle', () => {
    // That press starts a resize — a gesture whose whole point is to
    // travel — and a menu is not what grabbing a handle asks for.
    const { canvas } = mount();
    canvas.dispatchEvent(touch('pointerdown', 50, 50));
    document.dispatchEvent(touch('pointerup', 50, 50));
    const handle = document.querySelector<HTMLElement>('[data-handle]');
    expect(handle).toBeTruthy();
    const rect = handle!.getBoundingClientRect();
    canvas.dispatchEvent(
      touch('pointerdown', rect.left + rect.width / 2, rect.top + rect.height / 2),
    );
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS);
    expect(menu()).toBeNull();
  });
});

describe('long-press exclusions', () => {
  it('is not armed over an alignment guide', () => {
    // That press starts a guide move, in the one loop this editor does
    // not own — `startGuideMove` discards its own cleanup — so a menu
    // opening over it could not call the move off.
    const { canvas, store } = mount();
    store.batch(() => store.addGuide('x', 480));
    // 480 logical → 480 client at hostWidth 1920 / SLIDE_WIDTH 1920.
    canvas.dispatchEvent(touch('pointerdown', 480, 300));
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS);
    expect(menu()).toBeNull();
  });
});

describe('multi-touch does not drive the first finger gesture', () => {
  const second = (type: string, x: number, y: number) =>
    new PointerEvent(type, {
      clientX: x,
      clientY: y,
      pointerId: 2,
      pointerType: 'touch',
      isPrimary: false,
      bubbles: true,
    });

  it("a second finger's move does not drag the selection", () => {
    // `onPointerDown`'s guard only stops a second finger STARTING a
    // gesture. Every drag loop listens on `document` without filtering
    // `pointerId`, so without the capture-phase drop the second finger
    // would move the first finger's selection.
    const { canvas, store } = mount();
    const before = { ...store.read().slides[0].elements[0].frame };
    canvas.dispatchEvent(touch('pointerdown', 50, 50, { pointerId: 1 }));
    document.dispatchEvent(second('pointermove', 400, 300));
    document.dispatchEvent(second('pointerup', 400, 300));
    const after = store.read().slides[0].elements[0].frame;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });

  it('the first finger still drives its own gesture', () => {
    const { canvas, store } = mount();
    const before = { ...store.read().slides[0].elements[0].frame };
    canvas.dispatchEvent(touch('pointerdown', 50, 50, { pointerId: 1 }));
    document.dispatchEvent(second('pointermove', 400, 300));
    document.dispatchEvent(touch('pointermove', 150, 50, { pointerId: 1 }));
    document.dispatchEvent(touch('pointerup', 150, 50, { pointerId: 1 }));
    const after = store.read().slides[0].elements[0].frame;
    expect(after.x).toBeGreaterThan(before.x);
  });

  it('leaves a mouse gesture alone', () => {
    // A mouse cannot produce a second pointer, so the guard must never
    // engage there — and synthetic mouse events carry no pointerId.
    const { canvas, store } = mount();
    const before = { ...store.read().slides[0].elements[0].frame };
    const mouse = (type: string, x: number, y: number) =>
      new PointerEvent(type, {
        clientX: x,
        clientY: y,
        pointerType: 'mouse',
        isPrimary: true,
        bubbles: true,
      });
    canvas.dispatchEvent(mouse('pointerdown', 50, 50));
    document.dispatchEvent(mouse('pointermove', 150, 50));
    document.dispatchEvent(mouse('pointerup', 150, 50));
    expect(store.read().slides[0].elements[0].frame.x).toBeGreaterThan(before.x);
  });
});

describe('a handle tap that never moves', () => {
  it('commits no resize and pushes no history entry', () => {
    // The resize commit reads the device off `pointermove`, so a press
    // that produces none had nothing to read: `commitsAsDrag(0,
    // undefined)` answers "not touch" and the unchanged frame was
    // written in a batch, costing a real undo step for a still tap.
    // Seeding the device from the pointerdown is what closes it.
    const { canvas, store } = mount();
    canvas.dispatchEvent(touch('pointerdown', 50, 50));
    document.dispatchEvent(touch('pointerup', 50, 50));
    const handle = document.querySelector<HTMLElement>('[data-handle]')!;
    const rect = handle.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const before = { ...store.read().slides[0].elements[0].frame };
    const commits = vi.fn();
    const off = store.onChange(commits);
    // Down and up on the handle with no move in between at all.
    canvas.dispatchEvent(touch('pointerdown', x, y));
    document.dispatchEvent(touch('pointerup', x, y));
    off();

    const after = store.read().slides[0].elements[0].frame;
    expect(after.w).toBe(before.w);
    expect(after.h).toBe(before.h);
    expect(commits).not.toHaveBeenCalled();
  });
});
