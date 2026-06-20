// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { MemSlidesStore } from '../../../src/store/memory';
import { initialize } from '../../../src/view/editor/editor';

// ---------------------------------------------------------------------------
// Global RAF stub setup (mirrors presenter-anim.test.ts pattern)
// ---------------------------------------------------------------------------

beforeEach(() => {
  document.body.innerHTML = '';

  const pending: Array<FrameRequestCallback> = [];
  vi.stubGlobal(
    'requestAnimationFrame',
    (cb: FrameRequestCallback): number => {
      pending.push(cb);
      return pending.length;
    },
  );
  vi.stubGlobal('cancelAnimationFrame', (_handle: number) => {
    // For these tests, cancel clears all pending frames (single-editor
    // per test, so the effect is correct).
    pending.length = 0;
  });

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
    for (const cb of callbacks) cb(nowMs);
  };

  vi.stubGlobal('performance', { now: () => 500 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFixture() {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  const overlay = document.createElement('div');
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);
  const store = new MemSlidesStore();
  return { canvas, overlay, store };
}

function flushRaf(nowMs = 500): void {
  (
    globalThis as unknown as { __flushRaf: (nowMs?: number) => void }
  ).__flushRaf(nowMs);
}

// ---------------------------------------------------------------------------
// Fixtures — slide with two onClick animations
// ---------------------------------------------------------------------------

function makeSlideWithAnimations(store: MemSlidesStore): {
  slideId: string;
  elemId: string;
} {
  let slideId = '';
  let elemId = '';
  store.batch(() => {
    slideId = store.addSlide('blank');
    elemId = store.addElement(slideId, {
      type: 'shape',
      frame: { x: 100, y: 100, w: 200, h: 200, rotation: 0 },
      data: { kind: 'rect' },
    });
    store.addAnimation(slideId, {
      id: 'anim-1',
      category: 'entrance',
      effect: 'appear',
      start: 'onClick',
      durationMs: 200,
      elementId: elemId,
    });
    store.addAnimation(slideId, {
      id: 'anim-2',
      category: 'entrance',
      effect: 'fadeIn',
      start: 'onClick',
      durationMs: 200,
      elementId: elemId,
    });
  });
  return { slideId, elemId };
}

// ---------------------------------------------------------------------------
// Suite 1: previewAnimations on a slide with animations
// ---------------------------------------------------------------------------

describe('editor.previewAnimations — slide with animations', () => {
  it('does not throw and schedules a RAF frame', () => {
    const { canvas, overlay, store } = makeFixture();
    const { slideId } = makeSlideWithAnimations(store);
    const editor = initialize({
      canvas,
      overlay,
      store,
      hostWidth: 960,
      hostHeight: 540,
      dpr: 1,
    });
    editor.setCurrentSlide(slideId);

    const rafSpy = vi.fn((cb: FrameRequestCallback): number => {
      (
        globalThis as unknown as { __pendingRaf: FrameRequestCallback[] }
      ).__pendingRaf.push(cb);
      return (
        (globalThis as unknown as { __pendingRaf: FrameRequestCallback[] })
          .__pendingRaf.length
      );
    });
    vi.stubGlobal('requestAnimationFrame', rafSpy);

    expect(() => editor.previewAnimations()).not.toThrow();
    expect(rafSpy.mock.calls.length).toBeGreaterThan(0);

    editor.detach();
  });

  it('flushing RAF frames keeps the RAF loop alive while steps remain', () => {
    const { canvas, overlay, store } = makeFixture();
    const { slideId } = makeSlideWithAnimations(store);
    const editor = initialize({
      canvas,
      overlay,
      store,
      hostWidth: 960,
      hostHeight: 540,
      dpr: 1,
    });
    editor.setCurrentSlide(slideId);

    editor.previewAnimations(); // schedules frame for step 0

    // After the first flush, performance.now()=500 > 200ms duration so
    // step 0 settles; the loop auto-advances to step 1 and re-schedules.
    flushRaf(500);
    const pendingAfterFirst = (
      globalThis as unknown as { __pendingRaf: FrameRequestCallback[] }
    ).__pendingRaf.length;
    // At least one more RAF should be pending (continuing the loop).
    expect(pendingAfterFirst).toBeGreaterThan(0);

    editor.detach();
  });

  it('detach() during a preview cancels the RAF (no post-detach paint)', () => {
    const { canvas, overlay, store } = makeFixture();
    const { slideId } = makeSlideWithAnimations(store);
    const editor = initialize({
      canvas,
      overlay,
      store,
      hostWidth: 960,
      hostHeight: 540,
      dpr: 1,
    });
    editor.setCurrentSlide(slideId);

    editor.previewAnimations(); // kicks RAF loop
    const pendingBefore = (
      globalThis as unknown as { __pendingRaf: FrameRequestCallback[] }
    ).__pendingRaf.length;
    expect(pendingBefore).toBeGreaterThan(0);

    editor.detach(); // must cancel RAF
    const pendingAfter = (
      globalThis as unknown as { __pendingRaf: FrameRequestCallback[] }
    ).__pendingRaf.length;
    expect(pendingAfter).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: previewAnimations on a slide with NO animations — no-op
// ---------------------------------------------------------------------------

describe('editor.previewAnimations — slide with no animations', () => {
  it('does not throw and does NOT schedule a RAF frame', () => {
    const { canvas, overlay, store } = makeFixture();
    let slideId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      store.addElement(slideId, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 200, h: 200, rotation: 0 },
        data: { kind: 'rect' },
      });
      // No animations added.
    });

    const rafSpy = vi.fn((_cb: FrameRequestCallback): number => 1);
    vi.stubGlobal('requestAnimationFrame', rafSpy);

    const editor = initialize({
      canvas,
      overlay,
      store,
      hostWidth: 960,
      hostHeight: 540,
      dpr: 1,
    });
    editor.setCurrentSlide(slideId);

    const callsBefore = rafSpy.mock.calls.length;
    expect(() => editor.previewAnimations()).not.toThrow();
    // No RAF should be scheduled for a slide with no animations.
    expect(rafSpy.mock.calls.length).toBe(callsBefore);

    editor.detach();
  });
});
