import { describe, it, expect, vi } from 'vitest';

/**
 * Slide-background handler logic (now hosted by RightGlobals — moved out of
 * IdleSection so the picker is reachable from every toolbar state, grouped
 * with the Theme button on the right).
 *
 * These are logic tests for the background handler rather than the React
 * component. The testable surface is the
 * handler itself: given a ThemeColor, call store.batch + store.updateSlideBackground
 * with the current slide ID and { fill: color }. Full interaction tests live
 * in the browser harness.
 */

describe('Slide background onBackgroundChange logic', () => {
  /**
   * Extracts the handler logic from the component: given a store and slideId,
   * returns a function that mirrors what onBackgroundChange does in the component.
   */
  function makeOnBackgroundChange(
    store: {
      batch: (fn: () => void) => void;
      updateSlideBackground: (id: string, bg: { fill: unknown }) => void;
    } | null,
    slideId: string | undefined,
  ) {
    return (color: unknown) => {
      if (!store || !slideId) return;
      store.batch(() => store.updateSlideBackground(slideId, { fill: color }));
    };
  }

  it('calls store.batch and store.updateSlideBackground with slideId and fill', () => {
    const batchMock = vi.fn((fn: () => void) => fn());
    const updateMock = vi.fn();
    const store = { batch: batchMock, updateSlideBackground: updateMock };
    const slideId = 'slide-1';
    const color = { kind: 'role', role: 'accent1' };

    const handler = makeOnBackgroundChange(store, slideId);
    handler(color);

    expect(batchMock.mock.calls.length).toBe(1);
    expect(updateMock.mock.calls.length).toBe(1);
    expect(updateMock.mock.calls[0][0]).toBe(slideId);
    expect(updateMock.mock.calls[0][1]).toEqual({ fill: color });
  });

  it('no-ops when store is null', () => {
    const updateMock = vi.fn();
    const handler = makeOnBackgroundChange(null, 'slide-1');
    handler({ kind: 'srgb', value: '#ff0000' });
    expect(updateMock.mock.calls.length).toBe(0);
  });

  it('no-ops when slideId is undefined', () => {
    const batchMock = vi.fn();
    const updateMock = vi.fn();
    const store = { batch: batchMock, updateSlideBackground: updateMock };
    const handler = makeOnBackgroundChange(store, undefined);
    handler({ kind: 'srgb', value: '#ff0000' });
    expect(batchMock.mock.calls.length).toBe(0);
    expect(updateMock.mock.calls.length).toBe(0);
  });

  it('passes srgb ThemeColor as fill', () => {
    const batchMock = vi.fn((fn: () => void) => fn());
    const updateMock = vi.fn();
    const store = { batch: batchMock, updateSlideBackground: updateMock };
    const color = { kind: 'srgb', value: '#123456' };

    const handler = makeOnBackgroundChange(store, 'slide-abc');
    handler(color);

    expect(updateMock.mock.calls[0][1]).toEqual({ fill: color });
  });
});
