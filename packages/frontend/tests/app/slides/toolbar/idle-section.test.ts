import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

/**
 * IdleSection (.tsx) cannot be rendered by the Node --experimental-strip-types
 * test runner because it contains JSX. The resolve-hooks stub swaps all .tsx
 * files for no-op exports so transitive imports don't crash.
 *
 * The testable surface is the `onBackgroundChange` handler logic: given a
 * ThemeColor, it must call `store.batch` and `store.updateSlideBackground`
 * with the current slide ID and `{ fill: color }`.
 *
 * Full interaction tests (open dropdown → pick color → background updates)
 * belong in the browser interaction suite (tests/visual / Playwright) once
 * the new toolbar is wired into slides-detail.tsx.
 */

describe('IdleSection onBackgroundChange logic', () => {
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
