import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemStore } from '@wafflebase/sheets';
import { MemSlidesStore } from '@wafflebase/slides';
import { SYNTHETIC_SLIDE_ID } from '@wafflebase/board';
import {
  parseBoardSnapshot,
  parseDocsSnapshot,
  parseNoteSnapshot,
  parseSheetSnapshot,
  parseSlidesSnapshot,
} from '../snapshot-adapters';
import { firstWorksheetTabId } from '../first-worksheet-tab';

/**
 * Every fixture here is a **captured** revision snapshot — created with
 * `createRevision` against a real Yorkie server and copied byte for byte.
 * That matters more than it sounds: the hand-authored fixtures these replaced
 * were valid JSON, and so carried none of the `Int(…)`/`Long(…)` literals a
 * real snapshot is full of. They therefore passed against a parser that
 * returned `{type:'Int',value:320}` for every integer, and the slides preview
 * shipped rendering a solid theme-coloured rectangle and nothing else.
 *
 * Anything replacing a fixture must be captured the same way.
 */
const fixture = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', `${name}.yson.txt`), 'utf8');

/** Fails with the wrapper's own shape in the message, not a bare `false`. */
function expectPlainNumber(value: unknown, what: string) {
  expect(
    { [what]: value, isNumber: typeof value === 'number' },
    `${what} must be a plain number, not a YSON wrapper`,
  ).toMatchObject({ isNumber: true });
}

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

  // `SheetPreview`'s mount effect gives up before it ever reaches
  // `MemStore.load`/`initialize` unless `firstWorksheetTabId` names a tab that
  // has a `sheets` entry (`if (!container || !worksheet) return`). When the
  // preview came up blank in a browser that guard was the first suspect; this
  // pins that it passes for a real captured document, so a future blank
  // preview cannot be blamed on it without the fixture changing first.
  it('yields a tab the mount guard accepts', () => {
    const doc = parseSheetSnapshot(fixture('sheet'));
    const tabId = firstWorksheetTabId(doc);
    expect(tabId).toBeTruthy();
    expect(doc.sheets[tabId!]).toBeDefined();
  });

  // The integers a captured worksheet carries — `frozenRows`, `nextRowId`,
  // and every row height / column width. Typed `number` by the model and used
  // as one by the grid renderer.
  it('unwraps the worksheet integers a real snapshot wraps', () => {
    const ws = parseSheetSnapshot(fixture('sheet')).sheets['tab-1'];
    expectPlainNumber(ws.frozenRows, 'frozenRows');
    expectPlainNumber(ws.frozenCols, 'frozenCols');
    expectPlainNumber(ws.nextRowId, 'nextRowId');
    expectPlainNumber(ws.rowHeights!['rtw15'], 'rowHeights.rtw15');
    expectPlainNumber(ws.colWidths!['cq2ag'], 'colWidths.cq2ag');
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
    expect(await store.get({ r: 2, c: 1 })).toMatchObject({ f: '=A1+2' });
    expect(await store.get({ r: 5, c: 3 })).toEqual({ v: '1' });
    // Row heights and column widths are axis-id-keyed too, and resolve
    // through the same order arrays. A wrapped `Int(30)` reaches the grid as
    // an object and every y-offset computed from it becomes `NaN`, so assert
    // the value, not just its presence.
    expect((await store.getDimensionSizes('row')).get(2)).toBe(30);
    expect((await store.getDimensionSizes('column')).get(1)).toBe(120);
  });
});

describe('parseSlidesSnapshot', () => {
  it('reads slides from a snapshot fixture', () => {
    expect(parseSlidesSnapshot(fixture('slides')).slides.length).toBeGreaterThan(0);
  });

  // The reported Critical bug, pinned. This fixture is the very deck that
  // rendered as a solid `#202124` rectangle: its two shapes have `Int(320)` /
  // `Int(200)` frames, so without unwrapping the renderer computed `NaN`
  // width and height and painted only the theme background.
  it('unwraps every element frame integer', () => {
    const doc = parseSlidesSnapshot(fixture('slides'));
    const elements = doc.slides[0].elements;
    expect(elements.length).toBeGreaterThan(0);
    for (const el of elements) {
      expectPlainNumber(el.frame.w, `${el.id}.frame.w`);
      expectPlainNumber(el.frame.h, `${el.id}.frame.h`);
      expectPlainNumber(el.frame.x, `${el.id}.frame.x`);
      expectPlainNumber(el.frame.y, `${el.id}.frame.y`);
      expectPlainNumber(el.frame.rotation, `${el.id}.frame.rotation`);
      // Not every integer lives on the frame: a stroke width does too, and it
      // is multiplied by the render scale the same way.
      expect(Number.isFinite(el.frame.w * el.frame.h)).toBe(true);
    }
  });

  // `SlidesPreview` never touches the parsed document directly — it hands it
  // to `new MemSlidesStore(doc)` and the editor reads it back out. The store
  // clones and migrates on both construction and `read()`, so assert past
  // that, which is the shape the renderer actually receives.
  it('survives MemSlidesStore, the path the preview mounts it through', () => {
    const store = new MemSlidesStore(parseSlidesSnapshot(fixture('slides')));
    const read = store.read();
    for (const el of read.slides[0].elements) {
      expectPlainNumber(el.frame.w, `${el.id}.frame.w after read()`);
      expectPlainNumber(el.frame.h, `${el.id}.frame.h after read()`);
    }
    // The layout/master/theme chrome the renderer resolves against carries
    // integers of its own (placeholder frames, font sizes).
    for (const layout of read.layouts) {
      for (const ph of layout.placeholders) {
        expectPlainNumber(ph.frame.w, `layout ${layout.id} placeholder width`);
      }
    }
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

  // Board elements go through the same `Element.frame` the slides renderer
  // reads, so they wrap the same way — and a board's `boardPreviewViewport`
  // additionally *sums* those frames to find the content bounds, which turns
  // one wrapper into a `NaN` viewport for the whole plane.
  it('unwraps board element frames and effect scalars', () => {
    const [sticky] = parseBoardSnapshot(fixture('board')).slides[0].elements;
    expectPlainNumber(sticky.frame.w, 'sticky.frame.w');
    expectPlainNumber(sticky.frame.h, 'sticky.frame.h');
    expectPlainNumber(sticky.frame.x, 'sticky.frame.x');
    expect(sticky.frame.x).toBe(-240);
    const shadow = (
      sticky.data as { effects?: { shadow?: Record<string, unknown> } }
    ).effects?.shadow;
    expectPlainNumber(shadow?.blur, 'shadow.blur');
    expectPlainNumber(shadow?.distance, 'shadow.distance');
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
  // The `Text` CRDT is an aggregate, not a scalar: the unwrap walk must hand
  // it through by reference or `YSON.textToString` has nothing left to read.
  // This fixture is a captured note, so its nodes carry the real per-character
  // `attrs` (author / timestamp) a hand-written one omits.
  it('flattens a captured note back to its markdown', () => {
    expect(parseNoteSnapshot(fixture('note'))).toBe('ㅁㄴㅇㄹㅁㄴㅇㄹㅁㄴㅇㄹㅁㄴㅇㄹ');
  });

  it('returns empty for a note whose content was never written', () => {
    expect(parseNoteSnapshot('{}')).toBe('');
  });
});

describe('parseDocsSnapshot', () => {
  const doc = () => parseDocsSnapshot(fixture('docs'));

  // Depth 4 (`doc > block > inline > text`) is the shallowest a real docs
  // document gets, and it is exactly what the pre-0.7.19 regex parser could
  // not reach. The fixture's table goes deeper still
  // (`block > row > cell > block > inline > text`).
  it('reads a captured docs snapshot past three nesting levels', () => {
    expect(doc().blocks.map((b) => b.type)).toEqual([
      'heading',
      'paragraph',
      'list-item',
      'paragraph',
      'table',
    ]);
  });

  // The two silent-corruption traps in one assertion. `attrs`-vs-`attributes`
  // would make every block a style-less `paragraph`; leaving the values
  // JSON-encoded would make `type` compare as `"heading"` *with quotes* and
  // miss just as quietly. Neither throws, so only a value assertion catches
  // them.
  it('decodes JSON-encoded tree attributes rather than passing them through', () => {
    const heading = doc().blocks[0];
    expect(heading).toMatchObject({
      type: 'heading',
      headingLevel: 1,
      // The whole DEFAULT_BLOCK_STYLE set rides on every block the editor
      // writes, so this also proves the shared block-style codec is reached.
      style: { alignment: 'center', lineHeight: 1.5, marginBottom: 8 },
    });
    // Ids come from `generateBlockId()`, so assert the shape, not the value.
    expect(heading.id).toMatch(/^block-\d+-\d+$/);
    expect(heading.inlines[0]).toMatchObject({
      text: 'Quarterly Report',
      style: { bold: true },
    });
  });

  it('reads a list item with its kind and level', () => {
    expect(doc().blocks[2]).toMatchObject({
      type: 'list-item',
      listKind: 'unordered',
      listLevel: 0,
    });
  });

  // Unbalanced brackets inside a string value were the parser's second
  // defect, and reached notes as well as docs.
  it('keeps text containing unbalanced brackets and braces intact', () => {
    const runs = doc().blocks[1].inlines;
    expect(runs.map((r) => r.text).join('')).toBe(
      'See issue 3] for context and { unmatched brace.',
    );
    expect(runs[1].style).toMatchObject({ italic: true, color: '#C2484C' });
  });

  // `view/layout.ts` paints an image segment for ANY inline carrying
  // `style.image`, with no text-length guard, so an empty-text image inline
  // renders a ghost — usually a duplicate. The editor's live reader has
  // dropped those since issue #182; a revision preview renders precisely the
  // pre-#182 trees that fix was written for, so the shared reader must drop
  // them too. The fixture carries one deliberately.
  it('drops the empty-text image inline a pre-#182 CRDT left behind', () => {
    const images = doc().blocks[3].inlines;
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      text: 'logo',
      style: { image: { src: 'https://example.com/logo.png', width: 64 } },
    });
  });

  it('reads a nested table, its spans and its comma-bearing border colour', () => {
    const table = doc().blocks[4];
    expect(table.tableData?.columnWidths).toEqual([120, 240]);
    const [header, body] = table.tableData!.rows;
    expect(
      header.cells.map((c) => c.blocks[0].inlines[0].text),
    ).toEqual(['Region', 'Revenue']);
    expect(header.cells[0].style.backgroundColor).toBe('#EEEEEE');
    // `rgb(255, 128, 0)` contains the same separator the border codec uses.
    expect(header.cells[1].style.borderTop).toEqual({
      width: 1,
      style: 'solid',
      color: 'rgb(255, 128, 0)',
    });
    expect(body.cells.map((c) => c.blocks[0].inlines[0].text)).toEqual([
      'APAC',
      '¥1,200',
    ]);
  });

  it('reads the header and footer regions alongside the body', () => {
    const { header, footer } = doc();
    expect(header?.blocks[0].inlines[0].text).toBe('Confidential');
    expect(header?.marginFromEdge).toBe(36);
    // The page-number run is an empty inline carrying only a flag.
    expect(footer?.blocks[0].inlines[1].style.pageNumber).toBe(true);
  });

  // `pageSetup` is plain JSON rather than a tree node, so it rides the same
  // scalar unwrap every other type depends on — `Int(96)` must arrive as 96,
  // not `{type:'Int',value:96}`, or the layout computes NaN margins.
  it('unwraps pageSetup scalars and the named-style registry', () => {
    const parsed = doc();
    expectPlainNumber(parsed.pageSetup?.margins.top, 'margins.top');
    expectPlainNumber(parsed.pageSetup?.paperSize.width, 'paperSize.width');
    expect(parsed.pageSetup).toMatchObject({
      orientation: 'portrait',
      paperSize: { name: 'Letter', width: 816, height: 1056 },
    });
    expect(parsed.styles).toEqual({
      Normal: { fontSize: 11, fontFamily: 'Arial' },
    });
  });

  it('returns an empty document when content was never written', () => {
    expect(parseDocsSnapshot('{}')).toEqual({ blocks: [] });
  });

  // `stylesJson` is only a string by convention — it comes out of a CRDT.
  // A number would pass `JSON.parse` via coercion and land a non-object in
  // `doc.styles`.
  it('ignores a non-string named-style registry', () => {
    const snapshot =
      '{"content":Tree({"type":"doc","children":[]}),"stylesJson":5}';
    expect(parseDocsSnapshot(snapshot).styles).toBeUndefined();
  });
});

// These two defects are why docs preview could not ship before
// `@yorkie-js/sdk@0.7.19`, and why some note previews were
// content-dependent. Both were measured against a real server. This is the
// tripwire that tells us if a future SDK bump regresses either one.
describe('YSON parse limits', () => {
  it('reads a Tree nested deeper than three levels', () => {
    const deep =
      '{"content":Tree({"type":"doc","children":[{"type":"block","children":' +
      '[{"type":"inline","children":[{"type":"text","value":"a"}]}]}]})}';
    expect(parseDocsSnapshot(deep).blocks[0].inlines[0].text).toBe('a');
  });

  it('is string-aware: an unmatched bracket in a note is not structure', () => {
    expect(
      parseNoteSnapshot('{"content":Text([{"val":"Fix issue 3] later"}])}'),
    ).toBe('Fix issue 3] later');
  });
});
