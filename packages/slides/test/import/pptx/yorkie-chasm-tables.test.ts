// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTable } from '../../../src/import/pptx/table';
import { ImportReport } from '../../../src/import/pptx/report';
import { DEFAULT_WIDESCREEN_EMU, emuScale } from '../../../src/import/pptx/geometry';
import { parseXml } from '../../../src/import/pptx/xml';
import type { SlideParseContext } from '../../../src/import/pptx/shape';
import type { TableCell, TableElement } from '../../../src/model/element';

/**
 * Realistic-deck import smoke. Each fixture is a single `<p:graphicFrame>`
 * pulled from the Yorkie 캐즘 deck (slides 24-27 / 33-35 carry tables)
 * and wrapped in the standard p:/a: namespace declarations so parseXml
 * accepts it stand-alone. Source PPTX file is not in the repo; fixtures
 * were extracted offline in P2.4.
 *
 * Goals here are coarse:
 *   - parseTable produces a single TableElement (not [] and not a list
 *     of flattened text/shape pairs).
 *   - rows × cells counts match the source XML.
 *   - At least one cell carries non-empty text per fixture (the deck
 *     uses tables for content layout, not for decorative spacing).
 *
 * Bit-exact byte assertions belong in `table.test.ts` against
 * hand-authored XML where the inputs are small enough to reason about.
 */
const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(THIS_DIR, '__fixtures__', 'yorkie-chasm-tables');

function fixturePath(name: string): string {
  return resolve(FIXTURE_DIR, name);
}

function loadGraphicFrame(file: string): Element {
  const text = readFileSync(fixturePath(file), 'utf8');
  const doc = parseXml(text);
  const root = doc.documentElement;
  for (let i = 0; i < root.childNodes.length; i++) {
    const n = root.childNodes[i];
    if (n.nodeType === 1 && (n as Element).localName === 'graphicFrame') {
      return n as Element;
    }
  }
  throw new Error(`no <p:graphicFrame> in fixture ${file}`);
}

function ctx(report = new ImportReport()): SlideParseContext {
  return {
    archive: { readText: async () => undefined, readBytes: async () => undefined, list: () => [] },
    slidePartPath: 'ppt/slides/slide1.xml',
    rels: new Map(),
    scale: emuScale(DEFAULT_WIDESCREEN_EMU),
    report,
    idMap: new Map(),
    placeholderSizes: new Map(),
    clrMap: new Map(),
  };
}

function flatten(cells: readonly TableCell[]): string[] {
  return cells.flatMap((c) =>
    c.body.blocks.flatMap((b) => b.inlines.map((i) => i.text)),
  );
}

const FIXTURES = readdirSync(FIXTURE_DIR)
  .filter((n) => n.endsWith('.xml'))
  .sort();

describe('parseTable on Yorkie 캐즘 deck fixtures', () => {
  it('extracts all seven table fixtures', () => {
    // Sanity: make sure the test isn't silently running against zero
    // fixtures (e.g. if the directory got renamed or pruned).
    expect(FIXTURES.length).toBe(7);
  });

  for (const fixture of FIXTURES) {
    it(`${fixture} → single TableElement with non-empty content`, () => {
      const out = parseTable(loadGraphicFrame(fixture), ctx());
      expect(out).toHaveLength(1);
      expect(out[0].type).toBe('table');
      const t = out[0] as TableElement;

      expect(t.data.columnWidths.length).toBeGreaterThan(0);
      expect(t.data.rows.length).toBeGreaterThan(0);
      // Each row's cells array length must equal the column count for
      // this benchmark deck (no exotic ragged-row encodings).
      for (const row of t.data.rows) {
        expect(row.cells.length).toBe(t.data.columnWidths.length);
      }

      // At least one cell across the table carries a non-empty string.
      const everyText = t.data.rows.flatMap((r) => flatten(r.cells));
      const visible = everyText.filter((s) => s.trim().length > 0);
      expect(visible.length).toBeGreaterThan(0);

      // Frame width / height match the canonical grid sums (CR#13
      // frame-sync invariant).
      const wSum = t.data.columnWidths.reduce((a, b) => a + b, 0);
      const hSum = t.data.rows.reduce((a, r) => a + r.height, 0);
      expect(t.frame.w).toBeCloseTo(wSum, 6);
      expect(t.frame.h).toBeCloseTo(hSum, 6);
    });
  }

  it('emits no fallback-counter bumps on a clean structured import', () => {
    // Confirms the retired counters stay at zero and no other lossy
    // path fires for these benchmark tables.
    const report = new ImportReport();
    for (const fixture of FIXTURES) {
      parseTable(loadGraphicFrame(fixture), ctx(report));
    }
    expect(report.summary()).toBe('Imported with no fallbacks.');
  });
});
