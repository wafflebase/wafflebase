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
