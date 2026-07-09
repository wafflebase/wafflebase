import { describe, expect, it } from 'vitest';
import { toSref } from '../../src/model/core/coordinates';
import { MergeSpan, Ref } from '../../src/model/core/types';
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

type MockCtx = {
  calls: string[];
  save(): void;
  restore(): void;
  fillRect(...a: number[]): void;
  strokeRect(...a: number[]): void;
  beginPath(): void;
  moveTo(...a: number[]): void;
  lineTo(...a: number[]): void;
  stroke(): void;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
};

function makeMockCtx(): MockCtx {
  const ctx = {
    calls: [] as string[],
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    save() {
      this.calls.push('save');
    },
    restore() {
      this.calls.push('restore');
    },
    fillRect() {
      this.calls.push('fillRect');
    },
    strokeRect() {
      this.calls.push('strokeRect');
    },
    beginPath() {
      this.calls.push('beginPath');
    },
    moveTo() {
      this.calls.push('moveTo');
    },
    lineTo() {
      this.calls.push('lineTo');
    },
    stroke() {
      this.calls.push('stroke');
    },
  };
  return ctx as unknown as MockCtx;
}

const renderCellCheckbox = (
  GridCanvas.prototype as unknown as {
    renderCellCheckbox: (...args: unknown[]) => void;
  }
).renderCellCheckbox;

function makeThis() {
  return {
    toCellRect: () => ({ left: 10, top: 10, width: 80, height: 24 }),
    getThemeColor: () => '#123456',
    getCheckIconPath2D: () => null, // force deterministic fallback
  };
}

describe('GridCanvas checkbox glyph', () => {
  const rule = {
    id: 'a',
    kind: 'checkbox' as const,
    ranges: [
      [
        { r: 1, c: 1 },
        { r: 1, c: 1 },
      ],
    ],
  };

  it('draws only an outline for an unchecked cell', () => {
    const ctx = makeMockCtx();
    renderCellCheckbox.call(
      makeThis(),
      ctx,
      { r: 1, c: 1 },
      rule,
      { v: 'FALSE' },
      { left: 0, top: 0 },
    );
    expect(ctx.calls).toContain('strokeRect');
    expect(ctx.calls).not.toContain('fillRect');
  });

  it('fills the box and draws a check for a checked cell', () => {
    const ctx = makeMockCtx();
    renderCellCheckbox.call(
      makeThis(),
      ctx,
      { r: 1, c: 1 },
      rule,
      { v: 'TRUE' },
      { left: 0, top: 0 },
    );
    expect(ctx.calls).toContain('fillRect');
    // fallback check path uses moveTo/lineTo + stroke
    expect(ctx.calls).toContain('moveTo');
    expect(ctx.calls).toContain('stroke');
  });

  it('skips tiny cells', () => {
    const ctx = makeMockCtx();
    const thisArg = {
      ...makeThis(),
      toCellRect: () => ({ left: 0, top: 0, width: 4, height: 4 }),
    };
    renderCellCheckbox.call(
      thisArg,
      ctx,
      { r: 1, c: 1 },
      rule,
      { v: 'TRUE' },
      { left: 0, top: 0 },
    );
    expect(ctx.calls).not.toContain('fillRect');
    expect(ctx.calls).not.toContain('strokeRect');
  });
});
