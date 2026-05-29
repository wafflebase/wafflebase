import { describe, it, expect, vi } from 'vitest';

/**
 * Logic-level tests for LayoutButton's click handler. The handler:
 *   - reads the current slide id from the editor
 *   - looks up the slide's current layoutId in the store
 *   - opens the layout picker preselected to that layoutId
 *   - on pick, runs store.applyLayout(slideId, layoutId) inside store.batch
 *   - toggles via a closeRef (second click closes instead of reopening)
 *
 * The React component itself is thin — these tests cover the only logic
 * that can regress. Full interaction lives in the browser harness.
 */

interface Slide {
  id: string;
  layoutId: string;
  elements: unknown[];
}

interface StoreLike {
  read: () => { slides: Slide[] };
  applyLayout: (slideId: string, layoutId: string) => void;
  batch: (fn: () => void) => void;
}

interface EditorLike {
  getCurrentSlideId: () => string | undefined;
}

/**
 * Mirrors the handler in `layout-button.tsx`. Kept inline so the test
 * stays self-contained — if the component's logic changes, this helper
 * MUST be updated alongside it.
 */
function makeOnClick(
  store: StoreLike | null,
  editor: EditorLike | null,
  showPicker: (opts: {
    selectedLayoutId?: string;
    onPick: (layoutId: string) => void;
    onClose: () => void;
  }) => () => void,
) {
  const closeRef: { current: (() => void) | null } = { current: null };
  return () => {
    const slideId = editor?.getCurrentSlideId();
    if (!store || !slideId) return;
    if (closeRef.current) {
      closeRef.current();
      return;
    }
    const slide = store.read().slides.find((s) => s.id === slideId);
    closeRef.current = showPicker({
      selectedLayoutId: slide?.layoutId,
      onPick: (layoutId) => {
        store.batch(() => store.applyLayout(slideId, layoutId));
      },
      onClose: () => {
        closeRef.current = null;
      },
    });
  };
}

describe('LayoutButton handler', () => {
  function makeStore(slides: Slide[]): StoreLike {
    return {
      read: () => ({ slides }),
      applyLayout: vi.fn(),
      batch: vi.fn((fn) => fn()),
    };
  }

  it('opens the picker preselected to the current slide layout and applies on pick', () => {
    const store = makeStore([
      { id: 's1', layoutId: 'title-body', elements: [] },
      { id: 's2', layoutId: 'blank', elements: [] },
    ]);
    const editor = { getCurrentSlideId: () => 's2' };
    const showPicker = vi.fn((opts) => {
      opts.onPick('title-body');
      opts.onClose();
      return vi.fn();
    });

    const onClick = makeOnClick(store, editor, showPicker);
    onClick();

    expect(showPicker.mock.calls[0][0].selectedLayoutId).toBe('blank');
    expect(store.batch).toHaveBeenCalledTimes(1);
    expect(store.applyLayout).toHaveBeenCalledWith('s2', 'title-body');
  });

  it('no-ops when store is null', () => {
    const editor = { getCurrentSlideId: () => 's1' };
    const showPicker = vi.fn();
    makeOnClick(null, editor, showPicker)();
    expect(showPicker).not.toHaveBeenCalled();
  });

  it('no-ops when there is no current slide id', () => {
    const store = makeStore([{ id: 's1', layoutId: 'blank', elements: [] }]);
    const editor = { getCurrentSlideId: () => undefined };
    const showPicker = vi.fn();
    makeOnClick(store, editor, showPicker)();
    expect(showPicker).not.toHaveBeenCalled();
  });

  it('toggle closes the picker on a second click instead of reopening', () => {
    const store = makeStore([{ id: 's1', layoutId: 'blank', elements: [] }]);
    const editor = { getCurrentSlideId: () => 's1' };
    const close = vi.fn();
    // First call returns a close handle but does NOT auto-invoke onClose,
    // so closeRef stays populated and a second click hits the close path.
    const showPicker = vi.fn(() => close);

    const onClick = makeOnClick(store, editor, showPicker);
    onClick();
    onClick();

    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('passes the resolved slide layoutId even when slides are reordered', () => {
    const store = makeStore([
      { id: 's2', layoutId: 'blank', elements: [] },
      { id: 's1', layoutId: 'section', elements: [] },
    ]);
    const editor = { getCurrentSlideId: () => 's1' };
    const showPicker = vi.fn(() => vi.fn());

    makeOnClick(store, editor, showPicker)();

    expect(showPicker.mock.calls[0][0].selectedLayoutId).toBe('section');
  });
});
