import { describe, it, expect } from 'vitest';
import type { HeadingLevel, Document, Inline, InlineStyle, Block } from '../../src/model/types.js';
import {
  DEFAULT_BLOCK_STYLE,
  DEFAULT_PAGE_SETUP,
  DEFAULT_CELL_STYLE,
  PAPER_SIZES,
  resolvePageSetup,
  getEffectiveDimensions,
  createBlock,
  createEmptyBlock,
  getHeadingDefaults,
  inlineStylesEqual,
  createTableCell,
  createTableBlock,
  findImageAtOffset,
  clampImageToWidth,
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

  it('creates a page-break block with empty inlines', () => {
    const block = createBlock('page-break');
    expect(block.type).toBe('page-break');
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
  it('createTableCell returns cell with empty block and default style', () => {
    const cell = createTableCell();
    expect(cell.blocks).toHaveLength(1);
    expect(cell.blocks[0].type).toBe('paragraph');
    expect(cell.blocks[0].inlines).toEqual([{ text: '', style: {} }]);
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

describe('createTableBlock rowHeights', () => {
  it('should not include rowHeights by default', () => {
    const block = createTableBlock(2, 3);
    expect(block.tableData!.rowHeights).toBeUndefined();
  });
});

describe('HeaderFooter', () => {
  it('should include header and footer in Document type', () => {
    const doc: Document = {
      blocks: [createEmptyBlock()],
      header: {
        blocks: [createEmptyBlock()],
        marginFromEdge: 48,
      },
      footer: {
        blocks: [createEmptyBlock()],
        marginFromEdge: 48,
      },
    };
    expect(doc.header).toBeDefined();
    expect(doc.header!.blocks).toHaveLength(1);
    expect(doc.header!.marginFromEdge).toBe(48);
    expect(doc.footer).toBeDefined();
    expect(doc.footer!.blocks).toHaveLength(1);
    expect(doc.footer!.marginFromEdge).toBe(48);
  });

  it('should support pageNumber in InlineStyle', () => {
    const inline: Inline = {
      text: '#',
      style: { pageNumber: true },
    };
    expect(inline.style.pageNumber).toBe(true);
  });

  it('should allow Document without header/footer', () => {
    const doc: Document = { blocks: [createEmptyBlock()] };
    expect(doc.header).toBeUndefined();
    expect(doc.footer).toBeUndefined();
  });
});

describe('ImageData on InlineStyle', () => {
  it('should allow creating an inline with image data', () => {
    const inline: Inline = {
      text: '\uFFFC',
      style: {
        image: {
          src: 'https://example.com/image.png',
          width: 200,
          height: 150,
          alt: 'Test image',
        },
      },
    };
    expect(inline.style.image).toBeDefined();
    expect(inline.style.image!.src).toBe('https://example.com/image.png');
    expect(inline.style.image!.width).toBe(200);
    expect(inline.style.image!.height).toBe(150);
    expect(inline.style.image!.alt).toBe('Test image');
  });

  it('should compare inline styles with image data', () => {
    const a: InlineStyle = {
      image: { src: 'a.png', width: 100, height: 100 },
    };
    const b: InlineStyle = {
      image: { src: 'a.png', width: 100, height: 100 },
    };
    const c: InlineStyle = {
      image: { src: 'b.png', width: 100, height: 100 },
    };
    expect(inlineStylesEqual(a, b)).toBe(true);
    expect(inlineStylesEqual(a, c)).toBe(false);
  });

  it('imageDataEqual distinguishes rotation', () => {
    const a: InlineStyle = {
      image: { src: 'x.png', width: 10, height: 10, rotation: 90 },
    };
    const b: InlineStyle = {
      image: { src: 'x.png', width: 10, height: 10, rotation: 180 },
    };
    expect(inlineStylesEqual(a, b)).toBe(false);
  });

  it('imageDataEqual distinguishes each crop edge independently', () => {
    const base = { src: 'x.png', width: 10, height: 10 };
    const fields = ['cropLeft', 'cropRight', 'cropTop', 'cropBottom'] as const;
    for (const field of fields) {
      const a: InlineStyle = { image: { ...base } };
      const b: InlineStyle = { image: { ...base, [field]: 0.25 } };
      expect(
        inlineStylesEqual(a, b),
        `expected change in ${field} to be detected`,
      ).toBe(false);
    }
  });

  it('imageDataEqual distinguishes originalWidth/Height', () => {
    const a: InlineStyle = {
      image: { src: 'x.png', width: 10, height: 10, originalWidth: 100, originalHeight: 80 },
    };
    const b: InlineStyle = {
      image: { src: 'x.png', width: 10, height: 10, originalWidth: 200, originalHeight: 80 },
    };
    expect(inlineStylesEqual(a, b)).toBe(false);
  });

  it('imageDataEqual treats undefined rotation as distinct from 0', () => {
    // Kept as a guard against accidentally normalizing `rotation: 0` into
    // `undefined` at equality time — stored documents should round-trip
    // exactly what was written, not what would have rendered identically.
    const a: InlineStyle = { image: { src: 'x.png', width: 10, height: 10 } };
    const b: InlineStyle = {
      image: { src: 'x.png', width: 10, height: 10, rotation: 0 },
    };
    expect(inlineStylesEqual(a, b)).toBe(false);
  });
});

describe('clampImageToWidth', () => {
  it('returns the image unchanged when it already fits', () => {
    expect(clampImageToWidth(100, 50, 800)).toEqual({ width: 100, height: 50 });
  });

  it('scales width down to maxWidth and height proportionally', () => {
    // 4000×2000 source (2:1) → max 800 → 800×400.
    expect(clampImageToWidth(4000, 2000, 800)).toEqual({ width: 800, height: 400 });
  });

  it('rounds the scaled height to the nearest pixel', () => {
    // 300×151 source → max 200 → scale 200/300 ≈ 0.6667 → h = 151 * 0.6667 ≈ 100.67 → 101.
    expect(clampImageToWidth(300, 151, 200)).toEqual({ width: 200, height: 101 });
  });

  it('clamps degenerate very-short images to height >= 1', () => {
    // A 10000×1 banner scaling to 100: height = round(0.01) = 0 → clamped to 1.
    expect(clampImageToWidth(10000, 1, 100)).toEqual({ width: 100, height: 1 });
  });

  it('returns the input unchanged when width is zero', () => {
    expect(clampImageToWidth(0, 50, 200)).toEqual({ width: 0, height: 50 });
  });

  it('returns the input unchanged when width is negative', () => {
    expect(clampImageToWidth(-10, 50, 200)).toEqual({ width: -10, height: 50 });
  });

  it('handles exact-fit width as a no-op', () => {
    expect(clampImageToWidth(200, 100, 200)).toEqual({ width: 200, height: 100 });
  });
});

describe('findImageAtOffset', () => {
  function makeBlock(inlines: Inline[]): Block {
    return { id: 'b1', type: 'paragraph', inlines, style: { ...DEFAULT_BLOCK_STYLE } };
  }

  it('returns null when the block has no image inline at the offset', () => {
    const block = makeBlock([{ text: 'hello', style: {} }]);
    expect(findImageAtOffset(block, 0)).toBeNull();
    expect(findImageAtOffset(block, 2)).toBeNull();
  });

  it('returns the image data when offset falls on the image inline', () => {
    const img = { src: 'x.png', width: 10, height: 10 };
    const block = makeBlock([
      { text: 'ab', style: {} },
      { text: '\uFFFC', style: { image: img } },
      { text: 'cd', style: {} },
    ]);
    expect(findImageAtOffset(block, 2)).toBe(img);
  });

  it('returns null for offsets before and after the image inline', () => {
    const img = { src: 'x.png', width: 10, height: 10 };
    const block = makeBlock([
      { text: 'ab', style: {} },
      { text: '\uFFFC', style: { image: img } },
      { text: 'cd', style: {} },
    ]);
    expect(findImageAtOffset(block, 0)).toBeNull();
    expect(findImageAtOffset(block, 1)).toBeNull();
    // offset 3 is on the first char of 'cd', not the image.
    expect(findImageAtOffset(block, 3)).toBeNull();
  });

  it('returns null when offset is past the end of the block', () => {
    const img = { src: 'x.png', width: 10, height: 10 };
    const block = makeBlock([{ text: '\uFFFC', style: { image: img } }]);
    expect(findImageAtOffset(block, 5)).toBeNull();
  });
});
