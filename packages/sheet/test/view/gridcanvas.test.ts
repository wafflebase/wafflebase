import { describe, expect, it } from 'vitest';
import { toSref } from '../../src/model/coordinates';
import { MergeSpan, Ref } from '../../src/model/types';
import { GridCanvas } from '../../src/view/gridcanvas';

type MergeData = {
  anchors: Map<string, MergeSpan>;
  coverToAnchor: Map<string, string>;
};

const buildRenderableRefs = (
  GridCanvas.prototype as unknown as {
    buildRenderableRefs(
      rowStart: number,
      rowEnd: number,
      colStart: number,
      colEnd: number,
      mergeData?: MergeData,
    ): Ref[];
  }
).buildRenderableRefs;

describe('GridCanvas merged render refs', () => {
  it('includes offscreen merge anchor when merged block intersects viewport range', () => {
    const anchor = { r: 1, c: 1 };
    const span: MergeSpan = { rs: 3, cs: 3 };
    const anchorSref = toSref(anchor);

    const coverToAnchor = new Map<string, string>();
    for (let r = anchor.r; r < anchor.r + span.rs; r++) {
      for (let c = anchor.c; c < anchor.c + span.cs; c++) {
        const sref = toSref({ r, c });
        if (sref !== anchorSref) {
          coverToAnchor.set(sref, anchorSref);
        }
      }
    }

    const refs = buildRenderableRefs.call({}, 2, 4, 2, 4, {
      anchors: new Map([[anchorSref, span]]),
      coverToAnchor,
    });
    const srefs = refs.map((ref) => toSref(ref));

    expect(srefs).toContain(anchorSref);
    expect(srefs).not.toContain(toSref({ r: 2, c: 2 }));
    expect(srefs).toContain(toSref({ r: 4, c: 4 }));
  });

  it('does not include offscreen anchor when merged block does not intersect viewport range', () => {
    const anchor = { r: 1, c: 1 };
    const span: MergeSpan = { rs: 2, cs: 2 };
    const anchorSref = toSref(anchor);

    const refs = buildRenderableRefs.call({}, 5, 8, 5, 8, {
      anchors: new Map([[anchorSref, span]]),
      coverToAnchor: new Map(),
    });
    const srefs = refs.map((ref) => toSref(ref));

    expect(srefs).not.toContain(anchorSref);
  });
});
