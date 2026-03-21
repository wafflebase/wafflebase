import { describe, it, expect } from 'vitest';
import { MemStore } from '../../src/store/memory';
import { Sheet } from '../../src/model/worksheet/sheet';
import {
  grid2string,
  string2grid,
} from '../../src/model/worksheet/grids';
import { Cell, Sref } from '../../src/model/core/types';

describe('TSV quoting round-trip', () => {
  it('should quote fields containing newlines', () => {
    const grid = new Map<Sref, Cell>([
      ['A1' as Sref, { v: 'hello\nworld' }],
      ['B1' as Sref, { v: 'plain' }],
    ]);
    const tsv = grid2string(grid);
    expect(tsv).toBe('"hello\nworld"\tplain');

    const parsed = string2grid({ r: 1, c: 1 }, tsv);
    expect(parsed.get('A1' as Sref)?.v).toBe('hello\nworld');
    expect(parsed.get('B1' as Sref)?.v).toBe('plain');
  });

  it('should quote fields containing tabs', () => {
    const grid = new Map<Sref, Cell>([
      ['A1' as Sref, { v: 'col1\tcol2' }],
    ]);
    const tsv = grid2string(grid);
    expect(tsv).toBe('"col1\tcol2"');

    const parsed = string2grid({ r: 1, c: 1 }, tsv);
    expect(parsed.get('A1' as Sref)?.v).toBe('col1\tcol2');
  });

  it('should escape double-quotes inside fields', () => {
    const grid = new Map<Sref, Cell>([
      ['A1' as Sref, { v: 'say "hello"' }],
    ]);
    const tsv = grid2string(grid);
    expect(tsv).toBe('"say ""hello"""');

    const parsed = string2grid({ r: 1, c: 1 }, tsv);
    expect(parsed.get('A1' as Sref)?.v).toBe('say "hello"');
  });

  it('should handle multiline cell among multiple rows and columns', () => {
    const grid = new Map<Sref, Cell>([
      ['A1' as Sref, { v: 'line1\nline2' }],
      ['B1' as Sref, { v: '10' }],
      ['A2' as Sref, { v: '20' }],
      ['B2' as Sref, { v: '30' }],
    ]);
    const tsv = grid2string(grid);
    expect(tsv).toBe('"line1\nline2"\t10\n20\t30');

    const parsed = string2grid({ r: 1, c: 1 }, tsv);
    expect(parsed.get('A1' as Sref)?.v).toBe('line1\nline2');
    expect(parsed.get('B1' as Sref)?.v).toBe('10');
    expect(parsed.get('A2' as Sref)?.v).toBe('20');
    expect(parsed.get('B2' as Sref)?.v).toBe('30');
  });

  it('should preserve plain TSV without quoting (backward compat)', () => {
    const parsed = string2grid({ r: 1, c: 1 }, '10\t20\n30\t40');
    expect(parsed.get('A1' as Sref)?.v).toBe('10');
    expect(parsed.get('B1' as Sref)?.v).toBe('20');
    expect(parsed.get('A2' as Sref)?.v).toBe('30');
    expect(parsed.get('B2' as Sref)?.v).toBe('40');
  });
});

describe('Sheet.copy', () => {
  it('should return TSV text of selected range', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');
    await sheet.setData({ r: 2, c: 1 }, '30');
    await sheet.setData({ r: 2, c: 2 }, '40');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 2, c: 2 });

    const { text } = await sheet.copy();
    expect(text).toBe('10\t20\n30\t40');
  });

  it('should copy single cell when no range is selected', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '42');
    sheet.selectStart({ r: 1, c: 1 });

    const { text } = await sheet.copy();
    expect(text).toBe('42');
  });
});

describe('Sheet.paste - internal formula relocation', () => {
  it('should relocate formula references when pasting internally', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');
    await sheet.setData({ r: 2, c: 1 }, '=A1+B1');

    // Verify formula computed correctly
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('30');

    // Select A2 (the formula cell) and copy
    sheet.selectStart({ r: 2, c: 1 });
    const { text } = await sheet.copy();

    // Move to A4 and paste
    sheet.selectStart({ r: 4, c: 1 });
    await sheet.paste({ text });

    // Formula should be relocated: =A1+B1 → =A3+B3
    expect(await sheet.toInputString({ r: 4, c: 1 })).toBe('=A3+B3');
  });

  it('should relocate formula with column shift', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '5');
    await sheet.setData({ r: 2, c: 1 }, '=A1+10');

    // Copy A2
    sheet.selectStart({ r: 2, c: 1 });
    const { text } = await sheet.copy();

    // Paste to B3
    sheet.selectStart({ r: 3, c: 2 });
    await sheet.paste({ text });

    // Formula relocated: =A1+10 → =B2+10
    expect(await sheet.toInputString({ r: 3, c: 2 })).toBe('=B2+10');
  });

  it('should preserve plain cell values on internal paste', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'hello');
    await sheet.setData({ r: 1, c: 2 }, 'world');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    const { text } = await sheet.copy();

    sheet.selectStart({ r: 3, c: 1 });
    await sheet.paste({ text });

    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('hello');
    expect(await sheet.toDisplayString({ r: 3, c: 2 })).toBe('world');
  });

  it('should preserve cell styles on internal paste', async () => {
    const store = new MemStore();
    const sheet = new Sheet(store);
    await sheet.setData({ r: 1, c: 1 }, '10');
    sheet.selectStart({ r: 1, c: 1 });
    await sheet.setRangeStyle({ b: true, bg: '#ff0000' });

    sheet.selectStart({ r: 1, c: 1 });
    const { text } = await sheet.copy();

    sheet.selectStart({ r: 2, c: 1 });
    await sheet.paste({ text });

    expect(await sheet.getStyle({ r: 2, c: 1 })).toEqual({
      b: true,
      bg: '#ff0000',
    });
    expect(await store.getRangeStyles()).toEqual([
      {
        range: [
          { r: 1, c: 1 },
          { r: 2, c: 1 },
        ],
        style: { b: true, bg: '#ff0000' },
      },
    ]);
  });

  it('should preserve empty-range styles on internal paste', async () => {
    const store = new MemStore();
    const sheet = new Sheet(store);

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 2, c: 2 });
    await sheet.setRangeStyle({ bg: '#ff0000' });

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 2, c: 2 });
    const { text } = await sheet.copy();

    sheet.selectStart({ r: 4, c: 4 });
    await sheet.paste({ text });

    expect(await sheet.getStyle({ r: 4, c: 4 })).toEqual({ bg: '#ff0000' });
    expect(await sheet.getStyle({ r: 4, c: 5 })).toEqual({ bg: '#ff0000' });
    expect(await sheet.getStyle({ r: 5, c: 4 })).toEqual({ bg: '#ff0000' });
    expect(await sheet.getStyle({ r: 5, c: 5 })).toEqual({ bg: '#ff0000' });
    expect(await store.getRangeStyles()).toEqual([
      {
        range: [
          { r: 1, c: 1 },
          { r: 2, c: 2 },
        ],
        style: { bg: '#ff0000' },
      },
      {
        range: [
          { r: 4, c: 4 },
          { r: 5, c: 5 },
        ],
        style: { bg: '#ff0000' },
      },
    ]);
  });
});

describe('Sheet.paste - external TSV', () => {
  it('should paste TSV text as plain values', async () => {
    const sheet = new Sheet(new MemStore());
    sheet.selectStart({ r: 1, c: 1 });

    await sheet.paste({ text: '10\t20\n30\t40' });

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('20');
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('30');
    expect(await sheet.toDisplayString({ r: 2, c: 2 })).toBe('40');
  });

  it('should apply input inference for external TSV paste', async () => {
    const sheet = new Sheet(new MemStore());
    sheet.selectStart({ r: 1, c: 1 });

    await sheet.paste({ text: '$1,200.50\t12.34%\n2025-02-19\ttrue' });

    expect(await sheet.getCell({ r: 1, c: 1 })).toEqual({
      v: '1200.5',
      s: { nf: 'currency', cu: 'USD' },
    });
    expect(await sheet.getCell({ r: 1, c: 2 })).toEqual({
      v: '0.1234',
      s: { nf: 'percent' },
    });
    expect(await sheet.getCell({ r: 2, c: 1 })).toEqual({
      v: '2025-02-19',
      s: { nf: 'date' },
    });
    expect(await sheet.getCell({ r: 2, c: 2 })).toEqual({
      v: 'TRUE',
    });
  });

  it('should infer formulas and preserve leading-zero text on external paste', async () => {
    const sheet = new Sheet(new MemStore());
    sheet.selectStart({ r: 1, c: 1 });

    await sheet.paste({ text: '=1+2\t00123' });

    expect(await sheet.toInputString({ r: 1, c: 1 })).toBe('=1+2');
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('3');
    expect(await sheet.getCell({ r: 1, c: 2 })).toEqual({
      v: '00123',
    });
  });

  it('should treat modified clipboard text as external paste', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');

    sheet.selectStart({ r: 1, c: 1 });
    await sheet.copy();

    // Paste with different text (user edited clipboard)
    sheet.selectStart({ r: 2, c: 1 });
    await sheet.paste({ text: 'modified' });

    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('modified');
  });
});

describe('Sheet.paste - formula recalculation', () => {
  it('should recalculate formulas after paste', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '5');
    await sheet.setData({ r: 1, c: 2 }, '10');
    await sheet.setData({ r: 3, c: 1 }, '100');
    await sheet.setData({ r: 3, c: 2 }, '200');
    await sheet.setData({ r: 2, c: 1 }, '=A1+B1');

    // Copy A2 (formula =A1+B1, value 15)
    sheet.selectStart({ r: 2, c: 1 });
    const { text } = await sheet.copy();

    // Paste to A4 — formula becomes =A3+B3 which references 100+200
    sheet.selectStart({ r: 4, c: 1 });
    await sheet.paste({ text });

    expect(await sheet.toInputString({ r: 4, c: 1 })).toBe('=A3+B3');
    expect(await sheet.toDisplayString({ r: 4, c: 1 })).toBe('300');
  });

  it('should recalculate dependant formula chain when pasting plain values', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1');
    await sheet.setData({ r: 1, c: 2 }, '=A1*2');
    await sheet.setData({ r: 1, c: 3 }, '=B1*2');

    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('2');
    expect(await sheet.toDisplayString({ r: 1, c: 3 })).toBe('4');

    // Paste plain value into A1 (not a formula cell)
    sheet.selectStart({ r: 1, c: 1 });
    await sheet.paste({ text: '5' });

    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('5');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 1, c: 3 })).toBe('20');
  });
});

describe('Sheet.cut', () => {
  it('should return TSV text of selected range', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });

    const { text } = await sheet.cut();
    expect(text).toBe('10\t20');
  });

  it('should set cut mode', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    sheet.selectStart({ r: 1, c: 1 });

    expect(sheet.isCutMode()).toBe(false);
    await sheet.cut();
    expect(sheet.isCutMode()).toBe(true);
  });

  it('should not be in cut mode after copy', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    sheet.selectStart({ r: 1, c: 1 });

    await sheet.cut();
    expect(sheet.isCutMode()).toBe(true);

    await sheet.copy();
    expect(sheet.isCutMode()).toBe(false);
  });

  it('should clear cut mode on clearCopyBuffer', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    sheet.selectStart({ r: 1, c: 1 });

    await sheet.cut();
    expect(sheet.isCutMode()).toBe(true);

    sheet.clearCopyBuffer();
    expect(sheet.isCutMode()).toBe(false);
  });
});

describe('Sheet.cut & paste', () => {
  it('should clear source cells after cut-paste', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 1, c: 2 }, '20');

    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 1, c: 2 });
    const { text } = await sheet.cut();

    sheet.selectStart({ r: 3, c: 1 });
    await sheet.paste({ text });

    // Destination has values
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('10');
    expect(await sheet.toDisplayString({ r: 3, c: 2 })).toBe('20');

    // Source is cleared
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('');
    expect(await sheet.toDisplayString({ r: 1, c: 2 })).toBe('');
  });

  it('should relocate formula on cut-paste', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 2, c: 1 }, '=A1+5');

    sheet.selectStart({ r: 2, c: 1 });
    const { text } = await sheet.cut();

    sheet.selectStart({ r: 4, c: 1 });
    await sheet.paste({ text });

    // Formula relocated
    expect(await sheet.toInputString({ r: 4, c: 1 })).toBe('=A3+5');
    // Source cleared
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('');
  });

  it('should redirect dependent formulas after cut-paste', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 2, c: 1 }, '=A1*2'); // depends on A1

    // Cut A1 to C1
    sheet.selectStart({ r: 1, c: 1 });
    const { text } = await sheet.cut();

    sheet.selectStart({ r: 1, c: 3 });
    await sheet.paste({ text });

    // A2's formula should now reference C1 instead of A1
    expect(await sheet.toInputString({ r: 2, c: 1 })).toBe('=C1*2');
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('20');
  });

  it('should redirect range references in dependent formulas', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await sheet.setData({ r: 2, c: 1 }, '20');
    await sheet.setData({ r: 3, c: 1 }, '30');
    await sheet.setData({ r: 4, c: 1 }, '=SUM(A1:A3)');

    // Cut A1:A3 to C1:C3
    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 3, c: 1 });
    const { text } = await sheet.cut();

    sheet.selectStart({ r: 1, c: 3 });
    await sheet.paste({ text });

    // A4's formula should now reference C1:C3
    expect(await sheet.toInputString({ r: 4, c: 1 })).toBe('=SUM(C1:C3)');
    expect(await sheet.toDisplayString({ r: 4, c: 1 })).toBe('60');
  });

  it('should clear cut mode after paste (single use)', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');

    sheet.selectStart({ r: 1, c: 1 });
    const { text } = await sheet.cut();
    expect(sheet.isCutMode()).toBe(true);

    sheet.selectStart({ r: 2, c: 1 });
    await sheet.paste({ text });
    expect(sheet.isCutMode()).toBe(false);
  });

  it('should clear source styles after cut-paste', async () => {
    const store = new MemStore();
    const sheet = new Sheet(store);
    await sheet.setData({ r: 1, c: 1 }, '10');
    sheet.selectStart({ r: 1, c: 1 });
    await sheet.setRangeStyle({ b: true, bg: '#ff0000' });

    sheet.selectStart({ r: 1, c: 1 });
    const { text } = await sheet.cut();

    sheet.selectStart({ r: 3, c: 1 });
    await sheet.paste({ text });

    // Destination has style
    expect(await sheet.getStyle({ r: 3, c: 1 })).toEqual({
      b: true,
      bg: '#ff0000',
    });

    // Source style is cleared
    expect(await sheet.getStyle({ r: 1, c: 1 })).toBeUndefined();
  });

  it('should not clear source on copy-paste (only cut)', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');

    sheet.selectStart({ r: 1, c: 1 });
    const { text } = await sheet.copy();

    sheet.selectStart({ r: 2, c: 1 });
    await sheet.paste({ text });

    // Source still has value (copy, not cut)
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('10');
  });

  it('should overwrite existing cell when cut-pasting onto it', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1');
    await sheet.setData({ r: 2, c: 1 }, '2');

    // Cut A1
    sheet.selectStart({ r: 1, c: 1 });
    const { text } = await sheet.cut();

    // Paste to A2 (which already has value '2')
    sheet.selectStart({ r: 2, c: 1 });
    await sheet.paste({ text });

    // A2 should have the cut value
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('1');
    // A1 should be cleared
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('');
  });

  // Table-driven tests: cut-paste must preserve styles on non-cut cells
  // that share the same range style patch as the cut source.
  //
  // Each case sets up a style patch on `styledRange`, cuts `cutRange`,
  // pastes at `pasteStart`, then checks every cell in `expectations`.
  const cutPasteStyleCases: Array<{
    name: string;
    styledRange: [[number, number], [number, number]];
    cutRange: [[number, number], [number, number]];
    pasteStart: [number, number];
    expectations: Array<{
      cell: [number, number];
      hasStyle: boolean;
      label: string;
    }>;
  }> = [
    {
      name: 'cut left part of horizontal range (A1 from A1:C1)',
      styledRange: [[1, 1], [1, 3]],
      cutRange: [[1, 1], [1, 1]],
      pasteStart: [3, 1],
      expectations: [
        { cell: [1, 1], hasStyle: false, label: 'A1 (cut source)' },
        { cell: [1, 2], hasStyle: true, label: 'B1 (untouched)' },
        { cell: [1, 3], hasStyle: true, label: 'C1 (untouched)' },
        { cell: [3, 1], hasStyle: true, label: 'A3 (paste dest)' },
      ],
    },
    {
      name: 'cut right part of horizontal range (C1 from A1:C1)',
      styledRange: [[1, 1], [1, 3]],
      cutRange: [[1, 3], [1, 3]],
      pasteStart: [3, 1],
      expectations: [
        { cell: [1, 1], hasStyle: true, label: 'A1 (untouched)' },
        { cell: [1, 2], hasStyle: true, label: 'B1 (untouched)' },
        { cell: [1, 3], hasStyle: false, label: 'C1 (cut source)' },
        { cell: [3, 1], hasStyle: true, label: 'A3 (paste dest)' },
      ],
    },
    {
      name: 'cut middle of horizontal range (B1 from A1:C1)',
      styledRange: [[1, 1], [1, 3]],
      cutRange: [[1, 2], [1, 2]],
      pasteStart: [3, 1],
      expectations: [
        { cell: [1, 1], hasStyle: true, label: 'A1 (untouched)' },
        { cell: [1, 2], hasStyle: false, label: 'B1 (cut source)' },
        { cell: [1, 3], hasStyle: true, label: 'C1 (untouched)' },
        { cell: [3, 1], hasStyle: true, label: 'A3 (paste dest)' },
      ],
    },
    {
      name: 'cut top part of vertical range (A1 from A1:A3)',
      styledRange: [[1, 1], [3, 1]],
      cutRange: [[1, 1], [1, 1]],
      pasteStart: [1, 3],
      expectations: [
        { cell: [1, 1], hasStyle: false, label: 'A1 (cut source)' },
        { cell: [2, 1], hasStyle: true, label: 'A2 (untouched)' },
        { cell: [3, 1], hasStyle: true, label: 'A3 (untouched)' },
        { cell: [1, 3], hasStyle: true, label: 'C1 (paste dest)' },
      ],
    },
    {
      name: 'cut top rows of 2D range (A1:B1 from A1:B3)',
      styledRange: [[1, 1], [3, 2]],
      cutRange: [[1, 1], [1, 2]],
      pasteStart: [5, 1],
      expectations: [
        { cell: [1, 1], hasStyle: false, label: 'A1 (cut source)' },
        { cell: [1, 2], hasStyle: false, label: 'B1 (cut source)' },
        { cell: [2, 1], hasStyle: true, label: 'A2 (untouched)' },
        { cell: [2, 2], hasStyle: true, label: 'B2 (untouched)' },
        { cell: [3, 1], hasStyle: true, label: 'A3 (untouched)' },
        { cell: [3, 2], hasStyle: true, label: 'B3 (untouched)' },
        { cell: [5, 1], hasStyle: true, label: 'A5 (paste dest)' },
        { cell: [5, 2], hasStyle: true, label: 'B5 (paste dest)' },
      ],
    },
    {
      name: 'cut overlapping destination (A1:B1 from A1:B1, paste at B1)',
      styledRange: [[1, 1], [1, 2]],
      cutRange: [[1, 1], [1, 2]],
      pasteStart: [1, 2],
      expectations: [
        { cell: [1, 1], hasStyle: false, label: 'A1 (cut source only)' },
        { cell: [1, 2], hasStyle: true, label: 'B1 (paste dest)' },
        { cell: [1, 3], hasStyle: true, label: 'C1 (paste dest)' },
      ],
    },
    {
      name: 'cut exact range (no remainder expected)',
      styledRange: [[1, 1], [1, 2]],
      cutRange: [[1, 1], [1, 2]],
      pasteStart: [3, 1],
      expectations: [
        { cell: [1, 1], hasStyle: false, label: 'A1 (cut source)' },
        { cell: [1, 2], hasStyle: false, label: 'B1 (cut source)' },
        { cell: [3, 1], hasStyle: true, label: 'A3 (paste dest)' },
        { cell: [3, 2], hasStyle: true, label: 'B3 (paste dest)' },
      ],
    },
  ];

  for (const tc of cutPasteStyleCases) {
    it(`cut-paste style: ${tc.name}`, async () => {
      const sheet = new Sheet(new MemStore());

      // Populate cells so internal paste path is taken
      const sr = tc.cutRange;
      for (let r = sr[0][0]; r <= sr[1][0]; r++) {
        for (let c = sr[0][1]; c <= sr[1][1]; c++) {
          await sheet.setData({ r, c }, `${r}${c}`);
        }
      }

      // Apply style to the styled range
      sheet.selectStart({ r: tc.styledRange[0][0], c: tc.styledRange[0][1] });
      sheet.selectEnd({ r: tc.styledRange[1][0], c: tc.styledRange[1][1] });
      await sheet.setRangeStyle({ bg: '#ff0000' });

      // Cut
      sheet.selectStart({ r: tc.cutRange[0][0], c: tc.cutRange[0][1] });
      sheet.selectEnd({ r: tc.cutRange[1][0], c: tc.cutRange[1][1] });
      const { text } = await sheet.cut();

      // Paste
      sheet.selectStart({ r: tc.pasteStart[0], c: tc.pasteStart[1] });
      await sheet.paste({ text });

      // Check expectations
      for (const exp of tc.expectations) {
        const style = await sheet.getStyle({ r: exp.cell[0], c: exp.cell[1] });
        if (exp.hasStyle) {
          expect(style, `${exp.label} should have style`).toEqual({
            bg: '#ff0000',
          });
        } else {
          expect(style, `${exp.label} should have no style`).toBeUndefined();
        }
      }
    });
  }

  it('should handle cut-paste with overlapping source and destination (shift down by 1)', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '1');
    await sheet.setData({ r: 2, c: 1 }, '2');
    await sheet.setData({ r: 3, c: 1 }, '3');

    // Cut A1:A2 (values 1,2)
    sheet.selectStart({ r: 1, c: 1 });
    sheet.selectEnd({ r: 2, c: 1 });
    const { text } = await sheet.cut();

    // Paste to A2 (destination A2:A3 overlaps source A1:A2 at A2)
    sheet.selectStart({ r: 2, c: 1 });
    await sheet.paste({ text });

    // A2 should have value 1 (from A1), A3 should have value 2 (from A2)
    expect(await sheet.toDisplayString({ r: 2, c: 1 })).toBe('1');
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('2');
    // A1 should be cleared (was part of cut source, not part of destination)
    expect(await sheet.toDisplayString({ r: 1, c: 1 })).toBe('');
  });
});
