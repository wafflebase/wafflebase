import { describe, it, expect } from 'vitest';
import type { HeadingLevel } from '../../src/model/types.js';
import {
  DEFAULT_BLOCK_STYLE,
  DEFAULT_PAGE_SETUP,
  DEFAULT_CELL_STYLE,
  PAPER_SIZES,
  resolvePageSetup,
  getEffectiveDimensions,
  createBlock,
  getHeadingDefaults,
  inlineStylesEqual,
  createTableCell,
  createTableBlock,
} from '../../src/model/types.js';

describe('BlockStyle', () => {
  it('DEFAULT_BLOCK_STYLE includes textIndent and marginLeft at 0', () => {
    expect(DEFAULT_BLOCK_STYLE.textIndent).toBe(0);
    expect(DEFAULT_BLOCK_STYLE.marginLeft).toBe(0);
  });
});

describe('PageSetup', () => {
  it('DEFAULT_PAGE_SETUP uses Letter, portrait, 1-inch margins', () => {
    expect(DEFAULT_PAGE_SETUP.paperSize).toBe(PAPER_SIZES.LETTER);
    expect(DEFAULT_PAGE_SETUP.orientation).toBe('portrait');
    expect(DEFAULT_PAGE_SETUP.margins).toEqual({
      top: 96, bottom: 96, left: 96, right: 96,
    });
  });

  it('resolvePageSetup returns default when undefined', () => {
    expect(resolvePageSetup(undefined)).toEqual(DEFAULT_PAGE_SETUP);
  });

  it('resolvePageSetup returns provided setup', () => {
    const custom = { ...DEFAULT_PAGE_SETUP, paperSize: PAPER_SIZES.A4 };
    expect(resolvePageSetup(custom)).toEqual(custom);
  });

  it('resolvePageSetup returns a defensive copy', () => {
    const resolved = resolvePageSetup(undefined);
    expect(resolved).not.toBe(DEFAULT_PAGE_SETUP);
    expect(resolved.margins).not.toBe(DEFAULT_PAGE_SETUP.margins);
    expect(resolved.paperSize).not.toBe(DEFAULT_PAGE_SETUP.paperSize);
  });

  it('getEffectiveDimensions returns paper size for portrait', () => {
    const dims = getEffectiveDimensions(DEFAULT_PAGE_SETUP);
    expect(dims.width).toBe(816);
    expect(dims.height).toBe(1056);
  });

  it('getEffectiveDimensions swaps width/height for landscape', () => {
    const landscape = { ...DEFAULT_PAGE_SETUP, orientation: 'landscape' as const };
    const dims = getEffectiveDimensions(landscape);
    expect(dims.width).toBe(1056);
    expect(dims.height).toBe(816);
  });
});

describe('createBlock', () => {
  it('creates a heading block with headingLevel', () => {
    const block = createBlock('heading', { headingLevel: 1 });
    expect(block.type).toBe('heading');
    expect(block.headingLevel).toBe(1);
    expect(block.inlines).toHaveLength(1);
    expect(block.inlines[0].text).toBe('');
  });

  it('creates a list-item block with defaults', () => {
    const block = createBlock('list-item', { listKind: 'unordered', listLevel: 0 });
    expect(block.type).toBe('list-item');
    expect(block.listKind).toBe('unordered');
    expect(block.listLevel).toBe(0);
    expect(block.inlines).toHaveLength(1);
  });

  it('creates a horizontal-rule block with empty inlines', () => {
    const block = createBlock('horizontal-rule');
    expect(block.type).toBe('horizontal-rule');
    expect(block.inlines).toHaveLength(0);
  });

  it('defaults to paragraph when called with no arguments', () => {
    const block = createBlock();
    expect(block.type).toBe('paragraph');
    expect(block.inlines).toHaveLength(1);
  });

  it('creates a heading block with headingLevel 1 when no opts provided', () => {
    const block = createBlock('heading');
    expect(block.type).toBe('heading');
    expect(block.headingLevel).toBe(1);
  });

  it('creates a list-item block with defaults when no opts provided', () => {
    const block = createBlock('list-item');
    expect(block.type).toBe('list-item');
    expect(block.listKind).toBe('unordered');
    expect(block.listLevel).toBe(0);
  });
});

describe('getHeadingDefaults', () => {
  it('returns fontSize 24 and bold for level 1', () => {
    expect(getHeadingDefaults(1)).toEqual({ fontSize: 24, bold: true });
  });

  it('returns fontSize 11 (no bold) for level 6', () => {
    expect(getHeadingDefaults(6)).toEqual({ fontSize: 11 });
  });

  it.each([
    [1, { fontSize: 24, bold: true }],
    [2, { fontSize: 20, bold: true }],
    [3, { fontSize: 16, bold: true }],
    [4, { fontSize: 14, bold: true }],
    [5, { fontSize: 12 }],
    [6, { fontSize: 11 }],
  ] as const)('returns correct defaults for level %i', (level, expected) => {
    expect(getHeadingDefaults(level as HeadingLevel)).toEqual(expected);
  });
});

describe('inlineStylesEqual', () => {
  it('should detect superscript difference', () => {
    expect(inlineStylesEqual({ superscript: true }, {})).toBe(false);
    expect(inlineStylesEqual({ superscript: true }, { superscript: true })).toBe(true);
  });

  it('should detect subscript difference', () => {
    expect(inlineStylesEqual({ subscript: true }, {})).toBe(false);
    expect(inlineStylesEqual({ subscript: true }, { subscript: true })).toBe(true);
  });

  it('should detect href difference', () => {
    expect(inlineStylesEqual({ href: 'https://example.com' }, {})).toBe(false);
    expect(
      inlineStylesEqual(
        { href: 'https://example.com' },
        { href: 'https://example.com' },
      ),
    ).toBe(true);
  });
});

describe('Table types', () => {
  it('createTableCell returns cell with empty inline and default style', () => {
    const cell = createTableCell();
    expect(cell.inlines).toEqual([{ text: '', style: {} }]);
    expect(cell.style).toEqual(DEFAULT_CELL_STYLE);
    expect(cell.colSpan).toBeUndefined();
    expect(cell.rowSpan).toBeUndefined();
  });

  it('createTableBlock creates a table with given dimensions', () => {
    const block = createTableBlock(3, 4);
    expect(block.type).toBe('table');
    expect(block.tableData).toBeDefined();
    expect(block.tableData!.rows).toHaveLength(3);
    expect(block.tableData!.rows[0].cells).toHaveLength(4);
    expect(block.tableData!.columnWidths).toHaveLength(4);
    const sum = block.tableData!.columnWidths.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0);
  });

  it('createTableBlock columns have equal widths', () => {
    const block = createTableBlock(2, 3);
    for (const w of block.tableData!.columnWidths) {
      expect(w).toBeCloseTo(1 / 3);
    }
  });
});
