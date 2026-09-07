import { describe, it, expect } from 'vitest';
import { Selection } from '../../src/view/selection.js';

/**
 * `Selection.rawAnchor` holds the un-snapped position a pointer gesture
 * anchored at, so `expandRangeForLinks` can re-snap idempotently instead of
 * ratcheting outward (#1038).
 *
 * `setRange` clearing it is the load-bearing part. Every write that is *not*
 * part of a pointer gesture goes through `setRange` — select-all, a restored
 * cursor, and `updateDragSelection`'s "mouse left the table" branch, which
 * deliberately rewrites the anchor to the table block so the highlight covers
 * the whole table. If a stale `rawAnchor` survived those, the next mousemove
 * would substitute it back and undo the rewrite.
 */
describe('Selection.rawAnchor', () => {
  const pos = (blockId: string, offset: number) => ({ blockId, offset });

  it('starts null', () => {
    expect(new Selection().rawAnchor).toBeNull();
  });

  it('is cleared by setRange, so a non-pointer write invalidates it', () => {
    const selection = new Selection();
    selection.setRange({ anchor: pos('b1', 2), focus: pos('b1', 2) });
    selection.rawAnchor = pos('b1', 2);

    // What the "mouse left the table" branch does: rewrite the anchor.
    selection.setRange({ anchor: pos('table', 0), focus: pos('b2', 5) });

    expect(selection.rawAnchor).toBeNull();
  });

  it('is cleared by setRange(null)', () => {
    const selection = new Selection();
    selection.setRange({ anchor: pos('b1', 0), focus: pos('b1', 4) });
    selection.rawAnchor = pos('b1', 0);

    selection.setRange(null);

    expect(selection.rawAnchor).toBeNull();
  });
});
