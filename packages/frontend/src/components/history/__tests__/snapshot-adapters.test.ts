import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
});

describe('parseSlidesSnapshot', () => {
  it('reads slides from a snapshot fixture', () => {
    expect(parseSlidesSnapshot(fixture('slides')).slides.length).toBeGreaterThan(0);
  });
});

describe('parseBoardSnapshot', () => {
  // A board is one synthetic slide, so it is stored as (and reads back as)
  // a plain SlidesDocument — see docs/design/board/board.md. The pan/zoom
  // Viewport is view-local and never persisted, so there is no board-only
  // wire shape to fixture separately.
  it('is the slides parser — a board is one synthetic-slide SlidesDocument', () => {
    expect(parseBoardSnapshot).toBe(parseSlidesSnapshot);
  });

  it('reads a board snapshot the same way it reads a slides snapshot', () => {
    expect(parseBoardSnapshot(fixture('slides')).slides.length).toBeGreaterThan(0);
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
