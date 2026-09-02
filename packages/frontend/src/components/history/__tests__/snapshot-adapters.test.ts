import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemStore } from '@wafflebase/sheets';
import { SYNTHETIC_SLIDE_ID } from '@wafflebase/board';
import {
  parseBoardSnapshot,
  parseNoteSnapshot,
  parseSheetSnapshot,
  parseSlidesSnapshot,
} from '../snapshot-adapters';

const fixture = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', `${name}.yson.txt`), 'utf8');

describe('parseSheetSnapshot', () => {
  // SpreadsheetDocument is { tabs, tabOrder, sheets } — see
  // packages/sheets/src/model/workbook/worksheet-document.ts.
  it('reads tabs and their worksheets from a snapshot fixture', () => {
    const doc = parseSheetSnapshot(fixture('sheet'));
    expect(doc.tabOrder.length).toBeGreaterThan(0);
    expect(
      Object.keys(doc.sheets[doc.tabOrder[0]].cells).length,
    ).toBeGreaterThan(0);
  });

  // Counting raw JSON keys proves nothing about the wire format: a worksheet
  // keys its cells by `rowId|colId` (`createWorksheetCellKey`) and resolves
  // them to A1 through `rowOrder`/`colOrder`, and `getWorksheetEntries` drops
  // any key whose ids are not in those arrays. So assert through the
  // production path the preview actually uses — `MemStore.load` — which
  // yields zero cells for a fixture keyed by A1 notation.
  it('survives MemStore.load, the path the preview mounts it through', async () => {
    const doc = parseSheetSnapshot(fixture('sheet'));
    const store = new MemStore();
    store.load(doc.sheets[doc.tabOrder[0]]);

    expect(await store.get({ r: 1, c: 1 })).toEqual({ v: '1' });
    expect(await store.get({ r: 1, c: 2 })).toEqual({ v: '2' });
    expect(await store.get({ r: 2, c: 1 })).toMatchObject({ f: '=A1+2' });
    // Row heights and column widths are axis-id-keyed too, and resolve
    // through the same order arrays.
    expect((await store.getDimensionSizes('row')).get(2)).toBe(30);
    expect((await store.getDimensionSizes('col')).get(1)).toBe(120);
  });
});

describe('parseSlidesSnapshot', () => {
  it('reads slides from a snapshot fixture', () => {
    expect(parseSlidesSnapshot(fixture('slides')).slides.length).toBeGreaterThan(0);
  });
});

describe('parseBoardSnapshot', () => {
  // A board *renders* as one synthetic slide but is not stored as one: the
  // persisted root is `{meta, elements}` and the slide is manufactured at
  // read time. Aliasing this to the slides parser produced a document with
  // no `slides` at all — silently, since a missing key is not a parse error
  // — so the preview painted a blank canvas under a dated banner. Every
  // assertion here is against the real board wire format, which is what
  // makes the aliasing fail rather than pass.
  it('manufactures the synthetic slide from a board root', () => {
    const doc = parseBoardSnapshot(fixture('board'));
    expect(doc.slides).toHaveLength(1);
    expect(doc.slides[0].id).toBe(SYNTHETIC_SLIDE_ID);
    expect(doc.slides[0].elements.map((e) => e.id)).toEqual([
      'el-sticky',
      'el-note',
    ]);
  });

  it('supplies the theme/master/layout the slides renderer needs', () => {
    const doc = parseBoardSnapshot(fixture('board'));
    expect(doc.themes.length).toBeGreaterThan(0);
    expect(doc.masters.length).toBeGreaterThan(0);
    expect(doc.layouts.map((l) => l.id)).toContain(doc.slides[0].layoutId);
    expect(doc.meta.themeId).toBe(doc.themes[0].id);
  });

  it('carries the board meta across', () => {
    const doc = parseBoardSnapshot(fixture('board'));
    expect(doc.meta.title).toBe('Retro board');
    expect(doc.meta.unit).toBe('cm');
  });

  // A never-edited board attached by a viewer has no `meta` and no
  // `elements` at all (`boardInitialRootForRole`), which must read as an
  // empty board rather than throw.
  it('reads an empty board root as an empty board', () => {
    const doc = parseBoardSnapshot('{}');
    expect(doc.slides[0].elements).toEqual([]);
    expect(doc.meta.title).toBe('Untitled board');
  });
});

describe('parseNoteSnapshot', () => {
  it('flattens the Text CRDT back to markdown', () => {
    expect(parseNoteSnapshot('{"content":Text([{"val":"# hello"}])}')).toBe(
      '# hello',
    );
  });

  it('returns empty for a note whose content was never written', () => {
    expect(parseNoteSnapshot('{}')).toBe('');
  });
});

// The parser is regex-based upstream and silently loses whole document types.
// This test is the tripwire that tells us which types are still readable.
describe('YSON parse limits', () => {
  it('cannot yet read a docs tree, and says so loudly when that changes', () => {
    const docsSnapshot =
      '{"content":Tree({"type":"doc","children":[{"type":"block","children":' +
      '[{"type":"inline","children":[{"type":"text","value":"a"}]}]}]})}';
    // Pin the failure to the YSON parse step itself (not, say, a broken
    // import) so this only stays green for the reason we mean.
    expect(() => parseSheetSnapshot(docsSnapshot)).toThrow(
      /Failed to parse YSON:.*Unexpected token/,
    );
  });
});
