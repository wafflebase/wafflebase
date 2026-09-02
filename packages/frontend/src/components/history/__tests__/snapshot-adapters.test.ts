import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseNoteSnapshot,
  parseSheetSnapshot,
  parseSlidesSnapshot,
} from '../snapshot-adapters';

const fixture = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', `${name}.yson.txt`), 'utf8');

describe('parseSheetSnapshot', () => {
  // SpreadsheetDocument is { tabs, tabOrder, sheets } — see
  // packages/sheets/src/model/workbook/worksheet-document.ts.
  it('reads tabs and their worksheets out of a captured snapshot', () => {
    const doc = parseSheetSnapshot(fixture('sheet'));
    expect(doc.tabOrder.length).toBeGreaterThan(0);
    expect(
      Object.keys(doc.sheets[doc.tabOrder[0]].cells).length,
    ).toBeGreaterThan(0);
  });
});

describe('parseSlidesSnapshot', () => {
  it('reads slides out of a captured snapshot', () => {
    expect(parseSlidesSnapshot(fixture('slides')).slides.length).toBeGreaterThan(0);
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
    expect(() => parseSheetSnapshot(docsSnapshot)).toThrow();
  });
});
