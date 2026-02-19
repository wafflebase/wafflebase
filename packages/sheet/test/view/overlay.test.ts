import { describe, expect, it } from 'vitest';
import { toSref } from '../../src/model/coordinates';
import { MergeSpan, Range, Ref } from '../../src/model/types';
import { Overlay } from '../../src/view/overlay';

type MergeData = {
  anchors: Map<string, MergeSpan>;
  coverToAnchor: Map<string, string>;
};

const resolveAutofillSelectionRange = (
  Overlay.prototype as unknown as {
    resolveAutofillSelectionRange(
      range: Range | undefined,
      activeCell: Ref,
      mergeData?: MergeData,
    ): Range;
  }
).resolveAutofillSelectionRange;

describe('Overlay autofill handle range', () => {
  it('keeps explicit selection range unchanged', () => {
    const range: Range = [
      { r: 2, c: 2 },
      { r: 4, c: 5 },
    ];

    const result = resolveAutofillSelectionRange.call({}, range, { r: 2, c: 2 });

    expect(result).toEqual(range);
  });

  it('uses active cell when there is no merge metadata', () => {
    const activeCell = { r: 3, c: 4 };

    const result = resolveAutofillSelectionRange.call({}, undefined, activeCell);

    expect(result).toEqual([activeCell, activeCell]);
  });

  it('expands to merged bounds when active cell is a merge anchor', () => {
    const anchor = { r: 2, c: 3 };
    const span: MergeSpan = { rs: 2, cs: 3 };
    const mergeData: MergeData = {
      anchors: new Map([[toSref(anchor), span]]),
      coverToAnchor: new Map(),
    };

    const result = resolveAutofillSelectionRange.call(
      {},
      undefined,
      anchor,
      mergeData,
    );

    expect(result).toEqual([anchor, { r: 3, c: 5 }]);
  });

  it('maps covered merged cells to the merge anchor bounds', () => {
    const anchor = { r: 5, c: 2 };
    const covered = { r: 6, c: 3 };
    const span: MergeSpan = { rs: 3, cs: 2 };
    const anchorSref = toSref(anchor);
    const mergeData: MergeData = {
      anchors: new Map([[anchorSref, span]]),
      coverToAnchor: new Map([[toSref(covered), anchorSref]]),
    };

    const result = resolveAutofillSelectionRange.call(
      {},
      undefined,
      covered,
      mergeData,
    );

    expect(result).toEqual([anchor, { r: 7, c: 3 }]);
  });
});
