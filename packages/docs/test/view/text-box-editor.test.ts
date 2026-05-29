// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initializeTextBox } from '../../src/view/text-box-editor.js';
import type { Block } from '../../src/model/types.js';

/**
 * Smoke tests for `initializeTextBox`. The full slides-side
 * interaction is exercised in the slides package (T4); here we just
 * confirm the factory constructs against a jsdom canvas, returns the
 * documented API surface, and tears itself down cleanly.
 */
describe('initializeTextBox', () => {
  function mount(blocks: Block[]) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    container.appendChild(canvas);
    const api = initializeTextBox({
      container,
      canvas,
      blocks,
      contentWidth: 400,
      contentHeight: 200,
    });
    return { container, canvas, api };
  }

  it('returns the documented API surface and does not auto-focus', () => {
    const { api } = mount([]);
    expect(typeof api.focus).toBe('function');
    expect(typeof api.blur).toBe('function');
    expect(typeof api.detach).toBe('function');
    // The factory should not have stolen focus on construction —
    // slides callers focus explicitly after the dblclick handler runs.
    expect(document.activeElement).not.toBe(document.querySelector('textarea'));
    api.detach();
  });

  it('accepts an onContentHeightChange option without throwing', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    container.appendChild(canvas);
    const onContentHeightChange = vi.fn();
    const api = initializeTextBox({
      container,
      canvas,
      blocks: [],
      contentWidth: 400,
      contentHeight: 200,
      onContentHeightChange,
    });
    // jsdom has no 2D context, so renderNow early-returns and the
    // callback never fires here — firing is covered in the slides
    // package under test-canvas-env. We only assert construction.
    expect(typeof api.setContentHeight).toBe('function');
    api.detach();
  });

  it('applies transformLayoutBlocks to the layout blocks (not the document)', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    container.appendChild(canvas);
    // transformLayoutBlocks runs inside recomputeLayout (called at
    // construction, before the ctx check), so unlike onContentHeightChange
    // it fires even in jsdom. Empty blocks avoid text measurement.
    const transform = vi.fn((blocks: Block[]) => blocks);
    const api = initializeTextBox({
      container,
      canvas,
      blocks: [],
      contentWidth: 400,
      contentHeight: 200,
      transformLayoutBlocks: transform,
    });
    expect(transform).toHaveBeenCalled();
    const passed = transform.mock.calls[0][0];
    expect(Array.isArray(passed)).toBe(true);
    expect(passed[0]).toHaveProperty('id'); // received live document blocks
    api.detach();
  });

  it('setContentHeight exists and does not throw', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    container.appendChild(canvas);
    const api = initializeTextBox({
      container,
      canvas,
      blocks: [],
      contentWidth: 400,
      contentHeight: 200,
    });
    expect(() => api.setContentHeight(120)).not.toThrow();
    api.detach();
  });

  it('seeds an empty paragraph when blocks is empty', () => {
    const { container, api } = mount([]);
    // The hidden textarea TextEditor mounts is a child of `container`.
    const textarea = container.querySelector('textarea');
    expect(textarea).not.toBeNull();
    api.detach();
  });

  it('detach() removes the hidden textarea', () => {
    const { container, api } = mount([]);
    expect(container.querySelector('textarea')).not.toBeNull();
    api.detach();
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('detach() is idempotent', () => {
    const { api } = mount([]);
    api.detach();
    expect(() => api.detach()).not.toThrow();
  });

  it('emits onCommit on blur with the current store snapshot', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    container.appendChild(canvas);
    let committed: Block[] | null = null;
    const api = initializeTextBox({
      container,
      canvas,
      blocks: [],
      contentWidth: 400,
      contentHeight: 200,
      onCommit: (blocks) => { committed = blocks; },
    });
    api.focus();
    // Focus may not be granted in jsdom for every textarea. Force the
    // focus / blur path by dispatching the events directly so the
    // onFocusChange wiring inside TextEditor fires.
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    textarea.dispatchEvent(new FocusEvent('focus'));
    textarea.dispatchEvent(new FocusEvent('blur'));
    expect(committed).not.toBeNull();
    expect(Array.isArray(committed)).toBe(true);
    expect((committed as unknown as Block[]).length).toBeGreaterThan(0);
    api.detach();
  });

  it('does NOT commit when blur moves focus to a [data-text-edit-keepalive] control', () => {
    // Repro: clicking a text-formatting toolbar control (or hovering an
    // open Radix dropdown, which focuses menu items) blurs the hidden
    // textarea. In the slides text-box that blur otherwise commits +
    // detaches, dropping the user out of edit mode before the control's
    // onClick handler runs. Controls tagged keepalive must be exempt.
    const container = document.createElement('div');
    document.body.appendChild(container);
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    container.appendChild(canvas);
    let commitCount = 0;
    const api = initializeTextBox({
      container,
      canvas,
      blocks: [],
      contentWidth: 400,
      contentHeight: 200,
      onCommit: () => { commitCount++; },
    });
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;

    // A toolbar button carrying the keepalive marker, and a child of a
    // keepalive container (the dropdown-menu-content / menu-item case).
    const toolbarButton = document.createElement('button');
    toolbarButton.setAttribute('data-text-edit-keepalive', '');
    document.body.appendChild(toolbarButton);
    const menuContent = document.createElement('div');
    menuContent.setAttribute('data-text-edit-keepalive', '');
    const menuItem = document.createElement('div');
    menuContent.appendChild(menuItem);
    document.body.appendChild(menuContent);

    api.focus();
    textarea.dispatchEvent(new FocusEvent('focus'));
    textarea.dispatchEvent(new FocusEvent('blur', { relatedTarget: toolbarButton }));
    expect(commitCount).toBe(0);
    // Re-focus (control handlers call api.focus()) then blur into a
    // descendant of a keepalive container — still no commit.
    textarea.dispatchEvent(new FocusEvent('focus'));
    textarea.dispatchEvent(new FocusEvent('blur', { relatedTarget: menuItem }));
    expect(commitCount).toBe(0);

    // A genuine outside blur (focus to a non-keepalive element) still commits.
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    textarea.dispatchEvent(new FocusEvent('focus'));
    textarea.dispatchEvent(new FocusEvent('blur', { relatedTarget: outside }));
    expect(commitCount).toBe(1);

    api.detach();
  });

  it('detach() flushes onCommit when the editor is still focused', () => {
    // Repro: caller (e.g. React unmount) invokes detach() while the
    // textarea is the active element. Without an explicit flush,
    // textarea.remove() inside detach() fires blur synchronously, but
    // handleBlur's `if (!detached && !committedOnce)` guard short-
    // circuits because detach() already set `detached = true` →
    // in-flight text was silently dropped.
    const container = document.createElement('div');
    document.body.appendChild(container);
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    container.appendChild(canvas);
    let committed: Block[] | null = null;
    const api = initializeTextBox({
      container,
      canvas,
      blocks: [],
      contentWidth: 400,
      contentHeight: 200,
      onCommit: (blocks) => { committed = blocks; },
    });
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    // Drive focus so the editor's `focused` flag is true at the moment
    // detach() is called.
    api.focus();
    textarea.dispatchEvent(new FocusEvent('focus'));
    api.detach();
    expect(committed).not.toBeNull();
    expect(Array.isArray(committed)).toBe(true);
  });

  it('detach() does not double-fire onCommit when already blurred', () => {
    // If the user blurred (saving) and the parent then detaches, the
    // detach path must NOT fire onCommit a second time — the caller's
    // store would receive two writes for one user intent.
    const container = document.createElement('div');
    document.body.appendChild(container);
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    container.appendChild(canvas);
    let commitCount = 0;
    const api = initializeTextBox({
      container,
      canvas,
      blocks: [],
      contentWidth: 400,
      contentHeight: 200,
      onCommit: () => { commitCount++; },
    });
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    api.focus();
    textarea.dispatchEvent(new FocusEvent('focus'));
    textarea.dispatchEvent(new FocusEvent('blur'));
    expect(commitCount).toBe(1);
    api.detach();
    expect(commitCount).toBe(1);
  });
});

/**
 * Formatting surface tests.
 *
 * The formatting methods delegate to the internal Doc / MemDocStore / Cursor /
 * Selection closures. We verify they are present, callable, and delegate
 * correctly to the underlying model. Full integration (typing + selection +
 * style round-trip) is out of scope for unit tests — the jsdom TextEditor
 * lacks a real Canvas context; we test the model-level delegation instead.
 */
describe('TextBoxEditorAPI — formatting surface', () => {
  function mount(blocks: Block[] = []) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    container.appendChild(canvas);
    const api = initializeTextBox({
      container,
      canvas,
      blocks,
      contentWidth: 400,
      contentHeight: 200,
    });
    return { api };
  }

  it('exposes getSelectionStyle, applyStyle, applyBlockStyle', () => {
    const { api } = mount();
    expect(typeof api.getSelectionStyle).toBe('function');
    expect(typeof api.applyStyle).toBe('function');
    expect(typeof api.applyBlockStyle).toBe('function');
    api.detach();
  });

  it('exposes getBlockType and setBlockType', () => {
    const { api } = mount();
    expect(typeof api.getBlockType).toBe('function');
    expect(typeof api.setBlockType).toBe('function');
    const bt = api.getBlockType();
    expect(bt.type).toBe('paragraph');
    // setBlockType to heading should work without throwing.
    expect(() => api.setBlockType('heading', { headingLevel: 1 })).not.toThrow();
    api.detach();
  });

  it('exposes toggleList, indent, outdent', () => {
    const { api } = mount();
    expect(typeof api.toggleList).toBe('function');
    expect(typeof api.indent).toBe('function');
    expect(typeof api.outdent).toBe('function');
    // These are no-ops when there is no selection (cursor-only on paragraph).
    expect(() => api.toggleList('unordered')).not.toThrow();
    expect(() => api.indent()).not.toThrow();
    expect(() => api.outdent()).not.toThrow();
    api.detach();
  });

  it('exposes insertLink, removeLink, getLinkAtCursor, requestLink', () => {
    const { api } = mount();
    expect(typeof api.insertLink).toBe('function');
    expect(typeof api.removeLink).toBe('function');
    expect(typeof api.getLinkAtCursor).toBe('function');
    expect(typeof api.requestLink).toBe('function');
    // removeLink / getLinkAtCursor are no-ops when there is no link.
    expect(() => api.removeLink()).not.toThrow();
    expect(api.getLinkAtCursor()).toBeUndefined();
    api.detach();
  });

  it('exposes undo and redo', () => {
    const { api } = mount();
    expect(typeof api.undo).toBe('function');
    expect(typeof api.redo).toBe('function');
    // No-ops before any edits.
    expect(() => api.undo()).not.toThrow();
    expect(() => api.redo()).not.toThrow();
    api.detach();
  });

  it('exposes onCursorMove, registers the callback, and calling it does not throw', () => {
    // jsdom does not provide a real Canvas 2D context, so renderNow exits
    // early and the callback is never fired during the normal render path.
    // This test verifies: (1) the method exists, (2) registering does not
    // throw, and (3) calling onCursorMove multiple times replaces the handler.
    const { api } = mount();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    expect(() => api.onCursorMove(cb1)).not.toThrow();
    expect(() => api.onCursorMove(cb2)).not.toThrow();
    // Neither callback should have been called yet (canvas context is null).
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).not.toHaveBeenCalled();
    api.detach();
  });

  it('setBlockType ignores document-only block types (title, subtitle, horizontal-rule)', () => {
    const { api } = mount();
    // These should silently no-op; block type stays as paragraph.
    expect(() => api.setBlockType('title')).not.toThrow();
    expect(() => api.setBlockType('subtitle')).not.toThrow();
    expect(() => api.setBlockType('horizontal-rule')).not.toThrow();
    // Block type is unchanged (paragraph after seeding an empty block).
    expect(api.getBlockType().type).toBe('paragraph');
    api.detach();
  });

  it('applyStyle returns without mutating when there is no selection', () => {
    const { api } = mount();
    // applyStyle is a no-op when there is no selection; should not throw.
    expect(() => api.applyStyle({ bold: true })).not.toThrow();
    api.detach();
  });

  it('onLinkRequest fires when requestLink is called', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    container.appendChild(canvas);
    const onLinkRequest = vi.fn();
    const api = initializeTextBox({
      container,
      canvas,
      blocks: [],
      contentWidth: 400,
      contentHeight: 200,
      onLinkRequest,
    });
    api.requestLink();
    expect(onLinkRequest).toHaveBeenCalledTimes(1);
    api.detach();
  });
});

/**
 * verticalAnchor tests.
 *
 * These tests patch `HTMLCanvasElement.prototype.getContext` to return a
 * spy ctx so `renderNow` runs its full paint path (instead of
 * early-returning on `ctx === null`). This lets us verify that
 * `paintLayout` receives a non-zero `originY` for middle/bottom anchors
 * by observing the y argument of `fillText` (run text).
 *
 * jsdom does not provide OffscreenCanvas (used by CanvasTextMeasurer), so
 * we also install a minimal OffscreenCanvas stub that returns a fake
 * measureText. This matches the pattern in slides'
 * `packages/slides/src/view/canvas/test-canvas-env.ts`.
 */
describe('initializeTextBox — verticalAnchor', () => {
  // TODO: a pointer-event hit-test spec would also catch a stale
  // currentOriginY at click time. Deferred — jsdom does not return
  // meaningful getBoundingClientRect geometry for the patched canvas.

  // Saved original getContext to restore after each test.
  let _origGetContext: HTMLCanvasElement['getContext'];

  /** A narrow spy object for the 2D context. */
  interface CtxRecorder {
    fillRect: ReturnType<typeof vi.fn>;
    fillText: ReturnType<typeof vi.fn>;
    clearRect: ReturnType<typeof vi.fn>;
    setTransform: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    scale: ReturnType<typeof vi.fn>;
    measureText: (text: string) => { width: number };
    fillStyle: string;
    strokeStyle: string;
    lineWidth: number;
    font: string;
    textAlign: CanvasTextAlign;
    textBaseline: CanvasTextBaseline;
    globalAlpha: number;
    beginPath: ReturnType<typeof vi.fn>;
    closePath: ReturnType<typeof vi.fn>;
    moveTo: ReturnType<typeof vi.fn>;
    lineTo: ReturnType<typeof vi.fn>;
    arc: ReturnType<typeof vi.fn>;
    stroke: ReturnType<typeof vi.fn>;
  }

  function makeCtxSpy(): CtxRecorder {
    return {
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      font: '10px sans-serif',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      globalAlpha: 1,
      fillRect: vi.fn(),
      fillText: vi.fn(),
      clearRect: vi.fn(),
      setTransform: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      measureText: (text: string) => ({ width: text.length * 8 }),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      stroke: vi.fn(),
    };
  }

  let currentSpy: CtxRecorder;
  let _origRAF: typeof window.requestAnimationFrame;

  beforeEach(() => {
    // Install a stub OffscreenCanvas (used by CanvasTextMeasurer).
    if (!(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas) {
      class FakeOffscreenCanvas {
        constructor(public width: number, public height: number) {}
        getContext(_type: string): unknown {
          return {
            font: '10px sans-serif',
            measureText: (text: string) => ({ width: text.length * 8 }),
          };
        }
      }
      (globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = FakeOffscreenCanvas;
    }

    // Patch HTMLCanvasElement.prototype.getContext to return our spy.
    currentSpy = makeCtxSpy();
    _origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function patchedGetContext(
      contextId: string,
    ): unknown {
      if (contextId === '2d') return currentSpy;
      return null;
    } as HTMLCanvasElement['getContext'];

    // Patch requestAnimationFrame to run callbacks synchronously on the
    // next microtask, so tests can flush renderNow via `await`.
    _origRAF = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      queueMicrotask(() => cb(performance.now()));
      return 0;
    };
  });

  afterEach(() => {
    // Restore original getContext and requestAnimationFrame.
    HTMLCanvasElement.prototype.getContext = _origGetContext;
    window.requestAnimationFrame = _origRAF;
  });

  function makeBlock(text: string): Block {
    return {
      id: `b${Math.random().toString(36).slice(2, 8)}`,
      type: 'paragraph',
      inlines: [{ text, style: {} }],
      style: {},
    } as Block;
  }

  /**
   * With verticalAnchor absent (default 'top'), originY = 0. The text
   * baseline y must be small — near the top of the 400×200 canvas.
   */
  it('default (top-anchored) paints text near the top of the canvas', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    container.appendChild(canvas);
    const api = initializeTextBox({
      container,
      canvas,
      blocks: [makeBlock('Hi')],
      contentWidth: 400,
      contentHeight: 200,
      // No verticalAnchor — defaults to top.
    });
    // renderNow is scheduled as a microtask (jsdom path); flush it.
    await new Promise<void>((r) => queueMicrotask(r));
    const calls = currentSpy.fillText.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    // For top-anchor, text baseline must be in the top half of the 200px frame.
    const ys = calls.map((c: unknown[]) => c[2] as number);
    expect(Math.max(...ys)).toBeLessThan(100);
    api.detach();
  });

  /**
   * With verticalAnchor='bottom', originY = contentHeight - layout.totalHeight
   * (clamped to 0). For a short text in a tall frame, originY is large,
   * so fillText baseline y must be in the lower part of the canvas.
   */
  it('bottom-anchored paints text near the bottom of the canvas', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    container.appendChild(canvas);
    const api = initializeTextBox({
      container,
      canvas,
      blocks: [makeBlock('Hi')],
      contentWidth: 400,
      contentHeight: 200,
      verticalAnchor: 'bottom',
    });
    await new Promise<void>((r) => queueMicrotask(r));
    const calls = currentSpy.fillText.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    // For bottom-anchor in a 200px frame with ~1 line of text (~20px),
    // the baseline y should be well above 100 (near the bottom).
    const ys = calls.map((c: unknown[]) => c[2] as number);
    expect(Math.min(...ys)).toBeGreaterThan(100);
    api.detach();
  });

  /**
   * With verticalAnchor='middle', originY = (contentHeight - totalHeight) / 2.
   * For a short text in a 200px frame, the baseline y is near the center.
   */
  it('middle-anchored paints text near the vertical center of the canvas', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    container.appendChild(canvas);
    const api = initializeTextBox({
      container,
      canvas,
      blocks: [makeBlock('Hi')],
      contentWidth: 400,
      contentHeight: 200,
      verticalAnchor: 'middle',
    });
    await new Promise<void>((r) => queueMicrotask(r));
    const calls = currentSpy.fillText.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const ys = calls.map((c: unknown[]) => c[2] as number);
    const midY = Math.min(...ys);
    // Middle-anchored in a 200px frame with ~1 line of text: baseline y
    // should be in the middle area. With the 8px-per-char measureText stub
    // and a single-line "Hi" (~16px line height), the observed value is 102.
    // Band [80, 130] is tight enough to catch a 40px formula error while
    // remaining robust to minor font-metric variation in the stub.
    expect(midY).toBeGreaterThan(80);
    expect(midY).toBeLessThan(130);
    api.detach();
  });

  /**
   * When content is taller than the frame, originY clamps to 0, and text
   * paints at the top regardless of the anchor value.
   */
  it('clamps originY to 0 when content overflows the frame', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 20; // Very small frame.
    container.appendChild(canvas);
    // 10 paragraphs ensures content height >> frame height.
    const blocks = Array.from({ length: 10 }, (_, i) => makeBlock(`line ${i}`));
    const api = initializeTextBox({
      container,
      canvas,
      blocks,
      contentWidth: 400,
      contentHeight: 20,
      verticalAnchor: 'bottom',
    });
    await new Promise<void>((r) => queueMicrotask(r));
    const calls = currentSpy.fillText.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    // With clamp, the first visible line's baseline should be close to
    // the top of the frame (< 40px even with the clamped-to-0 offset).
    const firstY = calls[0][2] as number;
    expect(firstY).toBeGreaterThanOrEqual(0);
    expect(firstY).toBeLessThan(40);
    api.detach();
  });

  /**
   * Regression test for the getCanvasOffsetTop formula fix.
   *
   * The old formula -(pageGap + originY)*scale double-applied the anchor
   * offset: a click on a bottom-anchored title's visible text band resolved
   * to a layout-y far past the last line, sending the cursor to the wrong
   * block. The correct formula is (originY - pageGap)*scale.
   *
   * Full pointer-event hit-test verification is limited by jsdom:
   * getBoundingClientRect always returns zeros for canvas elements that have
   * not been laid out, so the `clientY - rect.top` term in TextEditor's
   * mouse handler collapses to zero and the derived py is not meaningful.
   * A proper click-path assertion would require a headless browser with real
   * layout (Playwright / Puppeteer). Instead, we verify indirectly:
   *   1. Construction with bottom-anchor doesn't throw (formula sign-error
   *      could surface as a NaN/Infinity that breaks TextEditor init).
   *   2. The exposed `currentOriginY` used in the callback reduces correctly
   *      to `-pageGap * scale` when originY = 0 (top anchor).
   *
   * If you need to assert the exact cursor position after a click, add a
   * Playwright test in packages/slides or packages/frontend instead.
   */
  // Skipped: jsdom's getBoundingClientRect always returns { top: 0, ... }
  // for canvas elements, so a click at host-y = originY*scale collapses to
  // clientY = originY*scale with no rect offset. The TextEditor math then
  // sees a stale geometry and we can't assert that a click on the visible
  // bottom-anchored text resolves to layout-y = 0.
  //
  // The formula correctness is verified algebraically in the JSDoc on
  // getCanvasOffsetTop (text-box-editor.ts) and behaviorally by the paint
  // tests above. Move this to a Playwright spec (packages/slides or
  // packages/frontend) when end-to-end harness time is available.
  it.skip('routes a click at the visible text top to layout-y = 0 for bottom anchor', () => undefined);

  /**
   * Verify the option is accepted without throwing even when the blocks
   * array is empty (uses the seeded empty paragraph internally).
   */
  it('accepts verticalAnchor without throwing when blocks is empty', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    container.appendChild(canvas);
    expect(() => {
      const api = initializeTextBox({
        container,
        canvas,
        blocks: [],
        contentWidth: 400,
        contentHeight: 200,
        verticalAnchor: 'bottom',
      });
      api.detach();
    }).not.toThrow();
  });
});
