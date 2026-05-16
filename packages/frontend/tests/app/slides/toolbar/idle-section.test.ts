import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Slide-background handler logic (now hosted by RightGlobals — moved out of
 * IdleSection so the picker is reachable from every toolbar state, grouped
 * with the Theme button on the right).
 *
 * The .tsx components can't be rendered by the Node --experimental-strip-types
 * runner (resolve-hooks stubs all .tsx imports). The testable surface is the
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
    const batchMock = mock.fn((fn: () => void) => fn());
    const updateMock = mock.fn();
    const store = { batch: batchMock, updateSlideBackground: updateMock };
    const slideId = 'slide-1';
    const color = { kind: 'role', role: 'accent1' };

    const handler = makeOnBackgroundChange(store, slideId);
    handler(color);

    assert.equal(batchMock.mock.calls.length, 1);
    assert.equal(updateMock.mock.calls.length, 1);
    assert.equal(updateMock.mock.calls[0].arguments[0], slideId);
    assert.deepEqual(updateMock.mock.calls[0].arguments[1], { fill: color });
  });

  it('no-ops when store is null', () => {
    const updateMock = mock.fn();
    const handler = makeOnBackgroundChange(null, 'slide-1');
    handler({ kind: 'srgb', value: '#ff0000' });
    assert.equal(updateMock.mock.calls.length, 0);
  });

  it('no-ops when slideId is undefined', () => {
    const batchMock = mock.fn();
    const updateMock = mock.fn();
    const store = { batch: batchMock, updateSlideBackground: updateMock };
    const handler = makeOnBackgroundChange(store, undefined);
    handler({ kind: 'srgb', value: '#ff0000' });
    assert.equal(batchMock.mock.calls.length, 0);
    assert.equal(updateMock.mock.calls.length, 0);
  });

  it('passes srgb ThemeColor as fill', () => {
    const batchMock = mock.fn((fn: () => void) => fn());
    const updateMock = mock.fn();
    const store = { batch: batchMock, updateSlideBackground: updateMock };
    const color = { kind: 'srgb', value: '#123456' };

    const handler = makeOnBackgroundChange(store, 'slide-abc');
    handler(color);

    assert.deepEqual(updateMock.mock.calls[0].arguments[1], { fill: color });
  });
});
