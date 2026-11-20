import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FONT_LINE_METRICS } from '../../src/view/font-metrics.data.js';
import { docsSingleLineMetrics } from '../../src/view/font-metrics.js';
import { computeLayout, DOCS_LAYOUT_OPTIONS } from '../../src/view/layout.js';
import { createBlock, createTableBlock } from '../../src/model/types.js';
import { computeTableLayout } from '../../src/view/table-layout.js';
import type { SingleLineMetricsFn } from '../../src/model/line-metrics.js';
import { ptToPx } from '../../src/view/theme.js';
import { stubMeasurer } from './_stub-measurer.js';

/**
 * Pitches read off Google Docs itself (2026-11-21, Chrome, 72 pt, Single,
 * baseline-to-baseline over 4–5 lines at DPR 2 — see
 * `docs/tasks/active/20261121-font-relative-leading-lessons.md`). These are
 * measurements, not derivations: the table is generated from font files, and
 * this is what says the generator's rule is Google's rule.
 */
const MEASURED_SINGLE_LINE: Record<string, number> = {
  Arial: 1.148,
  Roboto: 1.2005,
  Georgia: 1.1372,
  Montserrat: 1.2188,
  Merriweather: 1.2569,
  'Open Sans': 1.3611,
  'Noto Sans KR': 1.8837,
  'Gothic A1': 1.625,
  'Nanum Gothic': 1.625,
  'Nanum Myeongjo': 1.625,
};

/**
 * Line top to the first baseline, from the measured cap top plus the font's
 * cap height. Nanum Gothic is left out: its `OS/2` cap height disagrees with
 * its glyphs, so the derived number is off by the font, not by us.
 */
const MEASURED_ABOVE: Record<string, number> = {
  Arial: 0.9351,
  Georgia: 0.9168,
  Montserrat: 0.9656,
  Merriweather: 0.9826,
  'Noto Sans KR': 1.3736,
  'Gothic A1': 1.2314,
  'Nanum Myeongjo': 1.2373,
};

/** One device pixel at 72 pt and DPR 2, in em, plus the cap-height read. */
const TOLERANCE = 0.005;

describe('docsSingleLineMetrics', () => {
  for (const [family, single] of Object.entries(MEASURED_SINGLE_LINE)) {
    it(`matches Google Docs' single line for ${family}`, () => {
      const m = docsSingleLineMetrics(family);
      expect(Math.abs(m.above + m.below - single)).toBeLessThan(TOLERANCE);
    });
  }

  for (const [family, above] of Object.entries(MEASURED_ABOVE)) {
    it(`puts ${family}'s baseline where Google Docs does`, () => {
      expect(Math.abs(docsSingleLineMetrics(family).above - above)).toBeLessThan(TOLERANCE);
    });
  }

  it('reads the first family of a quoted, mixed-case list', () => {
    expect(docsSingleLineMetrics('"noto sans kr", sans-serif'))
      .toEqual(docsSingleLineMetrics('Noto Sans KR'));
  });

  it('falls back to Arial for a family it does not know, or none', () => {
    const arial = docsSingleLineMetrics('Arial');
    expect(docsSingleLineMetrics('Not A Real Font')).toEqual(arial);
    expect(docsSingleLineMetrics(undefined)).toEqual(arial);
  });
});

describe('font-relative line heights', () => {
  const paragraph = (text: string, style: Record<string, unknown> = {}, lineHeight?: number) => {
    const b = createBlock('paragraph');
    b.inlines = [{ text, style }];
    if (lineHeight !== undefined) {
      b.style.lineHeight = lineHeight;
      b.style.authoredLineHeight = true;
    }
    return b;
  };
  const layOut = (blocks: ReturnType<typeof createBlock>[], opts = DOCS_LAYOUT_OPTIONS) =>
    computeLayout(blocks, stubMeasurer(), 600, undefined, undefined, undefined, undefined, opts)
      .layout;

  it("gives Normal text Google Docs' 19.25 px pitch at 11 pt", () => {
    // Measured on the default Normal style (Arial 11 pt, 1.15): 38.5 device
    // px per line at DPR 2. Was 16.9 px under CSS leading.
    const line = layOut([paragraph('Body')]).blocks[0].lines[0];
    expect(Math.abs(line.height - 19.25)).toBeLessThan(0.2);
  });

  it('adds spacing below the text, leaving the baseline where it was', () => {
    const single = layOut([paragraph('Body', {}, 1)]).blocks[0].lines[0];
    const double = layOut([paragraph('Body', {}, 2)]).blocks[0].lines[0];
    expect(double.height).toBeCloseTo(single.height * 2, 5);
    expect(double.baseline).toBeCloseTo(single.baseline!, 5);
  });

  it('sizes a mixed line from its tallest above and its tallest below', () => {
    const metrics: SingleLineMetricsFn = (family) =>
      family === 'Tall' ? { above: 2, below: 0.1 } : { above: 0.5, below: 1 };
    const b = createBlock('paragraph');
    b.inlines = [
      { text: 'a', style: { fontFamily: 'Tall', fontSize: 12 } },
      { text: 'b', style: { fontFamily: 'Deep', fontSize: 12 } },
    ];
    b.style.lineHeight = 1;
    b.style.authoredLineHeight = true;
    const line = layOut([b], { ...DOCS_LAYOUT_OPTIONS, singleLineMetrics: metrics })
      .blocks[0].lines[0];
    const px = ptToPx(12);
    expect(line.baseline).toBeCloseTo(2 * px, 5);
    expect(line.height).toBeCloseTo(3 * px, 5);
  });

  it('never makes a line shorter than its font', () => {
    const line = layOut([paragraph('Body', {}, 0.5)]).blocks[0].lines[0];
    expect(line.height).toBeCloseTo(ptToPx(11), 5);
  });

  it('keeps CSS leading, and sets no baseline, for a host that supplies no metrics', () => {
    const line = layOut([paragraph('Body', {}, 1.5)], {}).blocks[0].lines[0];
    expect(line.height).toBeCloseTo(ptToPx(11) * 1.5, 5);
    expect(line.baseline).toBeUndefined();
  });
});

describe('font-metrics.data.ts drift', () => {
  /**
   * Families the generator deliberately leaves to the Arial fallback: they
   * ship only with Windows/Office, so there is no file to read and guessing
   * would be worse than saying so (see `SYSTEM` in the generator).
   */
  const NO_FILE = new Set(['cambria', '맑은 고딕', '바탕']);

  it('has an entry for every family in the curated font catalog', () => {
    const catalog = readFileSync(
      fileURLToPath(new URL(
        '../../../frontend/src/components/text-formatting/font-catalog.data.ts',
        import.meta.url,
      )),
      'utf8',
    );
    const families = [...catalog.matchAll(/family: "([^"]+)"/g)].map((m) => m[1].toLowerCase());
    expect(families.length).toBeGreaterThan(50);
    const missing = families.filter((f) => !(f in FONT_LINE_METRICS) && !NO_FILE.has(f));
    // Fix by re-running `node packages/docs/scripts/build-font-metrics.mjs`.
    expect(missing).toEqual([]);
  });
});

describe('font-relative leading: hostile and degenerate input', () => {
  it('treats Object.prototype names as unknown families', () => {
    const arial = docsSingleLineMetrics('Arial');
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(docsSingleLineMetrics(name)).toEqual(arial);
    }
  });

  it('lays out a run whose family is a prototype key', () => {
    const b = createBlock('paragraph');
    b.inlines = [{ text: 'x', style: { fontFamily: 'constructor' } }];
    expect(() => computeLayout([b], stubMeasurer(), 600, undefined, undefined, undefined,
      undefined, DOCS_LAYOUT_OPTIONS)).not.toThrow();
  });

  it('keeps a squeezed CJK baseline inside its line', () => {
    // Noto Sans KR's `above` alone is 1.38 em, more than the 1.0 em floor.
    const b = createBlock('paragraph');
    b.inlines = [{ text: '가', style: { fontFamily: 'Noto Sans KR' } }];
    b.style.lineHeight = 0.5;
    b.style.authoredLineHeight = true;
    const line = computeLayout([b], stubMeasurer(), 600, undefined, undefined, undefined,
      undefined, DOCS_LAYOUT_OPTIONS).layout.blocks[0].lines[0];
    expect(line.baseline!).toBeGreaterThan(0);
    expect(line.baseline!).toBeLessThanOrEqual(line.height);
    expect(line.textHeight!).toBeLessThanOrEqual(line.height + 1e-9);
  });

  it('records where the text ends, above the extra spacing', () => {
    const b = createBlock('paragraph');
    b.inlines = [{ text: 'x', style: {} }];
    b.style.lineHeight = 2;
    b.style.authoredLineHeight = true;
    const line = computeLayout([b], stubMeasurer(), 600, undefined, undefined, undefined,
      undefined, DOCS_LAYOUT_OPTIONS).layout.blocks[0].lines[0];
    expect(line.textHeight).toBeCloseTo(line.height / 2, 5);
  });

  it('drops a non-finite baseline from a table cell line', () => {
    const table = createTableBlock(1, 1);
    table.tableData!.rows[0].cells[0].blocks[0].inlines = [{ text: 'x', style: {} }];
    const poisoned: SingleLineMetricsFn = () => ({ above: NaN, below: 1 });
    const tl = computeTableLayout(table.tableData!, 'tbl', stubMeasurer(), 400,
      undefined, undefined, undefined, { namedStyleSpacing: true, singleLineMetrics: poisoned });
    const line = tl.cells[0][0].lines[0];
    expect(Number.isFinite(line.height)).toBe(true);
    expect(line.baseline).toBeUndefined();
    expect(line.textHeight).toBeUndefined();
  });
});
