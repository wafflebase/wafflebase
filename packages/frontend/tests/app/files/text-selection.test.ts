import { describe, expect, it } from 'vitest';

import {
  normalizeClientRects,
  readPdfTextSelection,
  type ClientRect,
} from '@/app/files/comments/text-selection';

// A 1000×800 page sitting 100px right and 50px down from the viewport origin,
// so a test that forgets to subtract the page offset fails loudly.
const PAGE: ClientRect = { left: 100, top: 50, width: 1000, height: 800 };

const lineAt = (top: number, left = 100, width = 500): ClientRect => ({
  left,
  top,
  width,
  height: 20,
});

describe('normalizeClientRects', () => {
  it('converts a line box to page-relative fractions', () => {
    const [rect] = normalizeClientRects([lineAt(50)], PAGE);

    expect(rect).toEqual({ x: 0, y: 0, w: 0.5, h: 0.025 });
  });

  it('keeps one box per line so a highlight follows the text', () => {
    // Three lines, the last one short — a selection's real shape. Collapsing
    // these into a bounding box would tint the whole paragraph block.
    const rects = normalizeClientRects(
      [lineAt(50), lineAt(70), lineAt(90, 100, 200)],
      PAGE,
    );

    expect(rects).toHaveLength(3);
    expect(rects.map((r) => r.w)).toEqual([0.5, 0.5, 0.2]);
  });

  it('drops duplicate boxes for one line split across text nodes', () => {
    const rects = normalizeClientRects([lineAt(50), lineAt(50)], PAGE);
    expect(rects).toHaveLength(1);
  });

  it('drops degenerate boxes at line ends', () => {
    // A collapsed rect at the end of a line: real output from getClientRects.
    const rects = normalizeClientRects(
      [lineAt(50), { left: 600, top: 50, width: 0, height: 20 }],
      PAGE,
    );
    expect(rects).toHaveLength(1);
  });

  it('clamps a selection running past the page edge', () => {
    const rects = normalizeClientRects(
      [{ left: 900, top: 40, width: 400, height: 40 }],
      PAGE,
    );

    expect(rects[0]!.x + rects[0]!.w).toBeLessThanOrEqual(1);
    expect(rects[0]!.y).toBe(0);
  });


  it('joins the fragments of a typeset expression into one band', () => {
    // `n₁n₅ → o₂` as pdf.js emits it: a base glyph, a subscript dropped and
    // shrunk, another base, and so on — each its own positioned run. Painted
    // literally this is a row of disconnected chips around the subscripts.
    const rects = normalizeClientRects(
      [
        { left: 100, top: 50, width: 12, height: 20 }, // n
        { left: 112, top: 58, width: 6, height: 12 }, //  ₁ (dropped, small)
        { left: 118, top: 50, width: 12, height: 20 }, // n
        { left: 130, top: 58, width: 6, height: 12 }, //  ₅
        { left: 140, top: 50, width: 14, height: 20 }, // →
        { left: 154, top: 50, width: 12, height: 20 }, // o
        { left: 166, top: 58, width: 6, height: 12 }, //  ₂
      ],
      PAGE,
    );

    expect(rects).toHaveLength(1);
    // One band spanning the whole expression, tall enough to cover the
    // subscripts that hang below the baseline.
    expect(rects[0]!.x).toBeCloseTo(0);
    expect(rects[0]!.w).toBeCloseTo((172 - 100) / 1000);
    expect(rects[0]!.y).toBeCloseTo(0);
    expect(rects[0]!.h).toBeCloseTo(20 / 800);
  });

  it('still keeps separate lines separate after joining', () => {
    const rects = normalizeClientRects(
      [
        { left: 100, top: 50, width: 12, height: 20 },
        { left: 112, top: 58, width: 6, height: 12 },
        { left: 100, top: 90, width: 12, height: 20 },
      ],
      PAGE,
    );

    expect(rects).toHaveLength(2);
    expect(rects[0]!.y).toBeLessThan(rects[1]!.y);
  });

  it('does not join across a two-column gutter', () => {
    // Both runs sit on the same line, but a column gap is far wider than the
    // seam between two runs of one expression. Joining them would paint the
    // highlight straight across the empty gutter.
    const rects = normalizeClientRects(
      [
        { left: 100, top: 50, width: 300, height: 20 },
        { left: 500, top: 50, width: 300, height: 20 },
      ],
      PAGE,
    );

    expect(rects).toHaveLength(2);
  });

  it('returns nothing for an unmeasured page rather than dividing by zero', () => {
    const rects = normalizeClientRects([lineAt(50)], {
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    });
    expect(rects).toEqual([]);
  });
});

/** Build a Selection-like object over a real element, for the DOM reader. */
function fakeSelection(opts: {
  text: string;
  startIn: Node;
  endIn?: Node;
  rects?: ClientRect[];
  collapsed?: boolean;
}): Selection {
  const range = {
    startContainer: opts.startIn,
    endContainer: opts.endIn ?? opts.startIn,
    getClientRects: () => opts.rects ?? [lineAt(50)],
  } as unknown as Range;
  return {
    isCollapsed: opts.collapsed ?? false,
    rangeCount: 1,
    getRangeAt: () => range,
    toString: () => opts.text,
  } as unknown as Selection;
}

function pageElement(index: number): HTMLElement {
  const page = document.createElement('div');
  page.dataset.pdfPage = String(index);
  page.getBoundingClientRect = () => PAGE as DOMRect;
  const span = document.createElement('span');
  page.append(span);
  document.body.append(page);
  return page;
}

describe('readPdfTextSelection', () => {
  it('anchors a selection to the page it sits in', () => {
    const page = pageElement(2);

    const anchor = readPdfTextSelection(
      fakeSelection({ text: '  hello world  ', startIn: page.firstChild! }),
    );

    expect(anchor).not.toBeNull();
    expect(anchor!.kind).toBe('pdf-text');
    expect(anchor!.pageIndex).toBe(2);
    // The quote is trimmed: it is shown back to the reader in the composer.
    expect(anchor!.quote).toBe('hello world');
    expect(anchor!.rects).toHaveLength(1);
  });

  it('ignores a collapsed caret', () => {
    const page = pageElement(0);
    expect(
      readPdfTextSelection(
        fakeSelection({
          text: '',
          startIn: page.firstChild!,
          collapsed: true,
        }),
      ),
    ).toBeNull();
  });

  it('ignores a whitespace-only selection', () => {
    const page = pageElement(0);
    expect(
      readPdfTextSelection(
        fakeSelection({ text: '   \n ', startIn: page.firstChild! }),
      ),
    ).toBeNull();
  });

  it('ignores a selection outside any page', () => {
    const outside = document.createElement('div');
    document.body.append(outside);
    expect(
      readPdfTextSelection(fakeSelection({ text: 'x', startIn: outside })),
    ).toBeNull();
  });

  it('refuses a selection spanning two pages rather than truncating it', () => {
    // An anchor names exactly one page, so silently keeping the first page's
    // half of what the reader highlighted would be worse than declining.
    const first = pageElement(0);
    const second = pageElement(1);

    expect(
      readPdfTextSelection(
        fakeSelection({
          text: 'across the fold',
          startIn: first.firstChild!,
          endIn: second.firstChild!,
        }),
      ),
    ).toBeNull();
  });

  it('ignores a selection whose boxes all measure to nothing', () => {
    const page = pageElement(0);
    expect(
      readPdfTextSelection(
        fakeSelection({
          text: 'invisible',
          startIn: page.firstChild!,
          rects: [{ left: 100, top: 50, width: 0, height: 0 }],
        }),
      ),
    ).toBeNull();
  });

  it('ignores a null selection', () => {
    expect(readPdfTextSelection(null)).toBeNull();
  });
});
