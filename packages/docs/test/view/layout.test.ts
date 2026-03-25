import { describe, it, expect } from 'vitest';
import { computeLayout } from '../../src/view/layout.js';
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
