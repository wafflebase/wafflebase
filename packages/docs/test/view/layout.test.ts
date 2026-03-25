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
