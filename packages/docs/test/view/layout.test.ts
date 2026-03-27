import { describe, it, expect } from 'vitest';
import { computeLayout, computeListCounters } from '../../src/view/layout.js';
import { createBlock } from '../../src/model/types.js';

function mockCtx(): CanvasRenderingContext2D {
  return {
    font: '',
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as unknown as CanvasRenderingContext2D;
}

describe('heading layout', () => {
  it('should apply heading default styles to layout runs', () => {
    const block = createBlock('heading', { headingLevel: 1 });
    block.inlines = [{ text: 'Title', style: {} }];
    const { layout } = computeLayout([block], mockCtx(), 600);
    const run = layout.blocks[0].lines[0].runs[0];
    // The run's inline should have heading defaults applied
    expect(run.inline.style.fontSize).toBe(24);
    expect(run.inline.style.bold).toBe(true);
  });

  it('should let explicit inline styles override heading defaults', () => {
    const block = createBlock('heading', { headingLevel: 1 });
    block.inlines = [{ text: 'Custom', style: { fontSize: 30 } }];
    const { layout } = computeLayout([block], mockCtx(), 600);
    const run = layout.blocks[0].lines[0].runs[0];
    expect(run.inline.style.fontSize).toBe(30);
    expect(run.inline.style.bold).toBe(true); // still gets bold from defaults
  });

  it('should produce larger line height for H1 than paragraph', () => {
    const h1 = createBlock('heading', { headingLevel: 1 });
    h1.inlines = [{ text: 'Heading', style: {} }];
    const para = createBlock('paragraph');
    para.inlines = [{ text: 'Paragraph', style: {} }];
    const { layout } = computeLayout([h1, para], mockCtx(), 600);
    expect(layout.blocks[0].height).toBeGreaterThan(layout.blocks[1].height);
  });
});

describe('list-item layout', () => {
  it('should offset text by list indent', () => {
    const block = createBlock('list-item', { listKind: 'unordered', listLevel: 0 });
    block.inlines = [{ text: 'Item', style: {} }];
    const { layout } = computeLayout([block], mockCtx(), 600);
    const firstRun = layout.blocks[0].lines[0].runs[0];
    expect(firstRun.x).toBeGreaterThanOrEqual(36); // LIST_INDENT_PX
  });

  it('should increase indent for nested list levels', () => {
    const l0 = createBlock('list-item', { listKind: 'unordered', listLevel: 0 });
    l0.inlines = [{ text: 'Level 0', style: {} }];
    const l1 = createBlock('list-item', { listKind: 'unordered', listLevel: 1 });
    l1.inlines = [{ text: 'Level 1', style: {} }];
    const { layout } = computeLayout([l0, l1], mockCtx(), 600);
    const x0 = layout.blocks[0].lines[0].runs[0].x;
    const x1 = layout.blocks[1].lines[0].runs[0].x;
    expect(x1).toBeGreaterThan(x0);
  });
});

describe('horizontal-rule layout', () => {
  it('should have fixed height with no text runs', () => {
    const block = createBlock('horizontal-rule');
    const { layout } = computeLayout([block], mockCtx(), 600);
    const hrBlock = layout.blocks[0];
    expect(hrBlock.lines).toHaveLength(1);
    expect(hrBlock.lines[0].runs).toHaveLength(0);
    expect(hrBlock.height).toBe(20);
  });
});

describe('superscript/subscript layout', () => {
  it('should use reduced font size for width measurement', () => {
    // Use a mock that respects the font property to detect size changes
    const ctx = {
      font: '',
      measureText(text: string) {
        // Parse font size from ctx.font (e.g. "14.666px Arial" -> 14.666)
        const match = (this as { font: string }).font.match(/([\d.]+)px/);
        const pxPerChar = match ? parseFloat(match[1]) : 8;
        return { width: text.length * pxPerChar };
      },
    } as unknown as CanvasRenderingContext2D;

    const block = createBlock('paragraph');
    block.inlines = [
      { text: 'E=mc', style: {} },
      { text: '2', style: { superscript: true } },
    ];
    const { layout } = computeLayout([block], ctx, 500);
    const normalRun = layout.blocks[0].lines[0].runs[0];
    const superRun = layout.blocks[0].lines[0].runs[1];
    expect(superRun).toBeDefined();
    // Superscript uses 60% font size, so width-per-char should be ~60% of normal
    const normalWidthPerChar = normalRun.width / normalRun.text.length;
    const superWidthPerChar = superRun.width / superRun.text.length;
    expect(superWidthPerChar).toBeLessThan(normalWidthPerChar);
    expect(superWidthPerChar / normalWidthPerChar).toBeCloseTo(0.6, 1);
  });

  it('should preserve original font size for line height with superscript', () => {
    const ctx = mockCtx();
    const block = createBlock('paragraph');
    block.inlines = [
      { text: '2', style: { superscript: true, fontSize: 11 } },
    ];
    const { layout } = computeLayout([block], ctx, 500);

    const normalBlock = createBlock('paragraph');
    normalBlock.inlines = [{ text: 'X', style: { fontSize: 11 } }];
    const normalResult = computeLayout([normalBlock], ctx, 500);

    // Line height should be the same — superscript preserves original font size for height
    expect(layout.blocks[0].lines[0].height).toBeGreaterThanOrEqual(
      normalResult.layout.blocks[0].lines[0].height,
    );
  });

  it('should use reduced font size for subscript width measurement', () => {
    const ctx = {
      font: '',
      measureText(text: string) {
        const match = (this as { font: string }).font.match(/([\d.]+)px/);
        const pxPerChar = match ? parseFloat(match[1]) : 8;
        return { width: text.length * pxPerChar };
      },
    } as unknown as CanvasRenderingContext2D;

    const block = createBlock('paragraph');
    block.inlines = [
      { text: 'H', style: {} },
      { text: '2', style: { subscript: true } },
      { text: 'O', style: {} },
    ];
    const { layout } = computeLayout([block], ctx, 500);
    const normalRun = layout.blocks[0].lines[0].runs[0];
    const subRun = layout.blocks[0].lines[0].runs[1];
    expect(subRun).toBeDefined();
    const normalWidthPerChar = normalRun.width / normalRun.text.length;
    const subWidthPerChar = subRun.width / subRun.text.length;
    expect(subWidthPerChar / normalWidthPerChar).toBeCloseTo(0.6, 1);
  });
});

describe('computeListCounters', () => {
  it('should number consecutive ordered items', () => {
    const blocks = [
      createBlock('list-item', { listKind: 'ordered', listLevel: 0 }),
      createBlock('list-item', { listKind: 'ordered', listLevel: 0 }),
      createBlock('list-item', { listKind: 'ordered', listLevel: 0 }),
    ];
    const counters = computeListCounters(blocks);
    expect(counters.get(blocks[0].id)).toBe('1.');
    expect(counters.get(blocks[1].id)).toBe('2.');
    expect(counters.get(blocks[2].id)).toBe('3.');
  });

  it('should reset counter after a non-list block', () => {
    const blocks = [
      createBlock('list-item', { listKind: 'ordered', listLevel: 0 }),
      createBlock('paragraph'),
      createBlock('list-item', { listKind: 'ordered', listLevel: 0 }),
    ];
    const counters = computeListCounters(blocks);
    expect(counters.get(blocks[0].id)).toBe('1.');
    expect(counters.get(blocks[2].id)).toBe('1.');
  });

  it('should use level-based formatting (a. for level 1, i. for level 2)', () => {
    const blocks = [
      createBlock('list-item', { listKind: 'ordered', listLevel: 0 }),
      createBlock('list-item', { listKind: 'ordered', listLevel: 1 }),
      createBlock('list-item', { listKind: 'ordered', listLevel: 2 }),
    ];
    const counters = computeListCounters(blocks);
    expect(counters.get(blocks[0].id)).toBe('1.');
    expect(counters.get(blocks[1].id)).toBe('a.');
    expect(counters.get(blocks[2].id)).toBe('i.');
  });

  it('should not include unordered list items', () => {
    const blocks = [
      createBlock('list-item', { listKind: 'unordered', listLevel: 0 }),
      createBlock('list-item', { listKind: 'ordered', listLevel: 0 }),
    ];
    const counters = computeListCounters(blocks);
    expect(counters.has(blocks[0].id)).toBe(false);
    expect(counters.get(blocks[1].id)).toBe('1.');
  });

  it('should reset deeper levels when a shallower level appears', () => {
    const blocks = [
      createBlock('list-item', { listKind: 'ordered', listLevel: 0 }),
      createBlock('list-item', { listKind: 'ordered', listLevel: 1 }),
      createBlock('list-item', { listKind: 'ordered', listLevel: 1 }),
      createBlock('list-item', { listKind: 'ordered', listLevel: 0 }),
      createBlock('list-item', { listKind: 'ordered', listLevel: 1 }),
    ];
    const counters = computeListCounters(blocks);
    expect(counters.get(blocks[0].id)).toBe('1.');
    expect(counters.get(blocks[1].id)).toBe('a.');
    expect(counters.get(blocks[2].id)).toBe('b.');
    expect(counters.get(blocks[3].id)).toBe('2.');
    expect(counters.get(blocks[4].id)).toBe('a.'); // reset back to 'a' after level 0 appeared
  });
});
