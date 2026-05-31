import { describe, it, expect } from 'vitest';
import { computeLayout, computeListCounters } from '../../src/view/layout.js';
import { createBlock } from '../../src/model/types.js';
import { StubMeasurer, stubMeasurer } from './_stub-measurer.js';

describe('heading layout', () => {
  it('should apply heading default styles to layout runs', () => {
    const block = createBlock('heading', { headingLevel: 1 });
    block.inlines = [{ text: 'Title', style: {} }];
    const { layout } = computeLayout([block], stubMeasurer(), 600);
    const run = layout.blocks[0].lines[0].runs[0];
    // The run's inline should have heading defaults applied
    expect(run.inline.style.fontSize).toBe(24);
    expect(run.inline.style.bold).toBe(true);
  });

  it('should let explicit inline styles override heading defaults', () => {
    const block = createBlock('heading', { headingLevel: 1 });
    block.inlines = [{ text: 'Custom', style: { fontSize: 30 } }];
    const { layout } = computeLayout([block], stubMeasurer(), 600);
    const run = layout.blocks[0].lines[0].runs[0];
    expect(run.inline.style.fontSize).toBe(30);
    expect(run.inline.style.bold).toBe(true); // still gets bold from defaults
  });

  it('should produce larger line height for H1 than paragraph', () => {
    const h1 = createBlock('heading', { headingLevel: 1 });
    h1.inlines = [{ text: 'Heading', style: {} }];
    const para = createBlock('paragraph');
    para.inlines = [{ text: 'Paragraph', style: {} }];
    const { layout } = computeLayout([h1, para], stubMeasurer(), 600);
    expect(layout.blocks[0].height).toBeGreaterThan(layout.blocks[1].height);
  });
});

describe('empty block height', () => {
  it('should give empty title block the same line height as a title with text', () => {
    const emptyTitle = createBlock('title');
    emptyTitle.inlines = [{ text: '', style: {} }];
    const fullTitle = createBlock('title');
    fullTitle.inlines = [{ text: 'Hello', style: {} }];
    const { layout } = computeLayout([emptyTitle, fullTitle], stubMeasurer(), 600);
    expect(layout.blocks[0].height).toBe(layout.blocks[1].height);
  });

  it('should give empty heading block the same line height as a heading with text', () => {
    const emptyH1 = createBlock('heading', { headingLevel: 1 });
    emptyH1.inlines = [{ text: '', style: {} }];
    const fullH1 = createBlock('heading', { headingLevel: 1 });
    fullH1.inlines = [{ text: 'Hello', style: {} }];
    const { layout } = computeLayout([emptyH1, fullH1], stubMeasurer(), 600);
    expect(layout.blocks[0].height).toBe(layout.blocks[1].height);
  });

  it('should give empty subtitle block the same line height as a subtitle with text', () => {
    const emptySub = createBlock('subtitle');
    emptySub.inlines = [{ text: '', style: {} }];
    const fullSub = createBlock('subtitle');
    fullSub.inlines = [{ text: 'Hello', style: {} }];
    const { layout } = computeLayout([emptySub, fullSub], stubMeasurer(), 600);
    expect(layout.blocks[0].height).toBe(layout.blocks[1].height);
  });
});

describe('list-item layout', () => {
  it('should offset text by list indent', () => {
    const block = createBlock('list-item', { listKind: 'unordered', listLevel: 0 });
    block.inlines = [{ text: 'Item', style: {} }];
    const { layout } = computeLayout([block], stubMeasurer(), 600);
    const firstRun = layout.blocks[0].lines[0].runs[0];
    expect(firstRun.x).toBeGreaterThanOrEqual(36); // LIST_INDENT_PX
  });

  it('should increase indent for nested list levels', () => {
    const l0 = createBlock('list-item', { listKind: 'unordered', listLevel: 0 });
    l0.inlines = [{ text: 'Level 0', style: {} }];
    const l1 = createBlock('list-item', { listKind: 'unordered', listLevel: 1 });
    l1.inlines = [{ text: 'Level 1', style: {} }];
    const { layout } = computeLayout([l0, l1], stubMeasurer(), 600);
    const x0 = layout.blocks[0].lines[0].runs[0].x;
    const x1 = layout.blocks[1].lines[0].runs[0].x;
    expect(x1).toBeGreaterThan(x0);
  });
});

describe('horizontal-rule layout', () => {
  it('should have fixed height with no text runs', () => {
    const block = createBlock('horizontal-rule');
    const { layout } = computeLayout([block], stubMeasurer(), 600);
    const hrBlock = layout.blocks[0];
    expect(hrBlock.lines).toHaveLength(1);
    expect(hrBlock.lines[0].runs).toHaveLength(0);
    expect(hrBlock.height).toBe(20);
  });
});

describe('page-break layout', () => {
  it('should have fixed height with no text runs', () => {
    const block = createBlock('page-break');
    const { layout } = computeLayout([block], stubMeasurer(), 600);
    const pbBlock = layout.blocks[0];
    expect(pbBlock.lines).toHaveLength(1);
    expect(pbBlock.lines[0].runs).toHaveLength(0);
    expect(pbBlock.lines[0].height).toBe(20);
  });
});

describe('superscript/subscript layout', () => {
  it('should use reduced font size for width measurement', () => {
    // Use a measurer whose width scales with font.size so we can detect
    // the sup/sub size adjustment without depending on a real Canvas.
    const measurer = new StubMeasurer(8, { respectFontSize: true });

    const block = createBlock('paragraph');
    block.inlines = [
      { text: 'E=mc', style: {} },
      { text: '2', style: { superscript: true } },
    ];
    const { layout } = computeLayout([block], measurer, 500);
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
    const measurer = stubMeasurer();
    const block = createBlock('paragraph');
    block.inlines = [
      { text: '2', style: { superscript: true, fontSize: 11 } },
    ];
    const { layout } = computeLayout([block], measurer, 500);

    const normalBlock = createBlock('paragraph');
    normalBlock.inlines = [{ text: 'X', style: { fontSize: 11 } }];
    const normalResult = computeLayout([normalBlock], measurer, 500);

    // Line height should be the same — superscript preserves original font size for height
    expect(layout.blocks[0].lines[0].height).toBeGreaterThanOrEqual(
      normalResult.layout.blocks[0].lines[0].height,
    );
  });

  it('should use reduced font size for subscript width measurement', () => {
    const measurer = new StubMeasurer(8, { respectFontSize: true });

    const block = createBlock('paragraph');
    block.inlines = [
      { text: 'H', style: {} },
      { text: '2', style: { subscript: true } },
      { text: 'O', style: {} },
    ];
    const { layout } = computeLayout([block], measurer, 500);
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

describe('soft line break (`\\n`) layout', () => {
  // Build a paragraph from inlines so multi-inline tests can interleave
  // `\n`-only inlines (matching what the PPTX importer emits for `<a:br/>`).
  const para = (inlines: Array<{ text: string; style?: Record<string, unknown> }>) => {
    const block = createBlock('paragraph');
    block.inlines = inlines.map((inl) => ({ text: inl.text, style: inl.style ?? {} }));
    return block;
  };

  it('flushes a line at a single `\\n` inside one inline', () => {
    const block = para([{ text: 'abc\ndef' }]);
    const { layout } = computeLayout([block], stubMeasurer(), 1000);
    const lines = layout.blocks[0].lines;
    expect(lines).toHaveLength(2);
    // Line 1: "abc" + zero-width \n run.
    expect(lines[0].runs.map((r) => r.text)).toEqual(['abc', '\n']);
    expect(lines[0].runs[1].width).toBe(0);
    // Line 2: "def".
    expect(lines[1].runs.map((r) => r.text)).toEqual(['def']);
  });

  it('produces an empty visual line between two consecutive `\\n`s — slide 5 case', () => {
    // Mirrors PPTX `<a:r>Tier 3</a:r><a:br/><a:br/><a:r>원본 ...</a:r>`.
    const block = para([
      { text: 'Tier 3' },
      { text: '\n' },
      { text: '\n' },
      { text: '원본' },
    ]);
    const { layout } = computeLayout([block], stubMeasurer(), 1000);
    const lines = layout.blocks[0].lines;
    expect(lines).toHaveLength(3);
    // Line 1: "Tier " + "3" + \n (splitWords keeps the trailing space with "Tier").
    expect(lines[0].runs.map((r) => r.text).join('')).toBe('Tier 3\n');
    // Line 2: pure empty visual line — only the `\n` run sits on it.
    expect(lines[1].runs.map((r) => r.text)).toEqual(['\n']);
    expect(lines[1].width).toBe(0);
    // Line 3: "원본".
    expect(lines[2].runs.map((r) => r.text)).toEqual(['원본']);
  });

  it('adds a trailing empty line when the block ends with `\\n`', () => {
    const block = para([{ text: 'abc\n' }]);
    const { layout } = computeLayout([block], stubMeasurer(), 1000);
    const lines = layout.blocks[0].lines;
    // Two lines: "abc\n" and an empty trailing line for the cursor to sit on.
    expect(lines).toHaveLength(2);
    expect(lines[0].runs.map((r) => r.text)).toEqual(['abc', '\n']);
    expect(lines[1].runs).toHaveLength(0);
  });

  it('keeps cursor offsets continuous across a soft break', () => {
    // The `\n` run carries charStart/charEnd so a click at end-of-line 1
    // (or arrow-up from line 2 → line 1) resolves to an inline offset.
    const block = para([{ text: 'abc\ndef' }]);
    const { layout } = computeLayout([block], stubMeasurer(), 1000);
    const line1 = layout.blocks[0].lines[0];
    const brRun = line1.runs[1];
    expect(brRun.text).toBe('\n');
    expect(brRun.inlineIndex).toBe(0);
    expect(brRun.charStart).toBe(3); // right after "abc"
    expect(brRun.charEnd).toBe(4);
    // Next line picks up exactly where the `\n` left off in the same inline.
    const nextRun = layout.blocks[0].lines[1].runs[0];
    expect(nextRun.inlineIndex).toBe(0);
    expect(nextRun.charStart).toBe(4);
  });

  it('drops the first-line `textIndent` after a soft break', () => {
    // Mirrors the bullet hang-indent layout: textIndent applies to the
    // first line only. The wrapped line that follows a `\n` must start
    // at `marginLeft`, not `marginLeft + textIndent`.
    const block = para([{ text: 'a\nb' }]);
    block.style = { ...block.style, marginLeft: 40, textIndent: -20 };
    const { layout } = computeLayout([block], stubMeasurer(), 1000);
    const lines = layout.blocks[0].lines;
    // Line 1: first run starts at marginLeft + textIndent (= 20).
    expect(lines[0].runs[0].x).toBe(20);
    // Line 2: first run starts at marginLeft (40), no textIndent.
    expect(lines[1].runs[0].x).toBe(40);
  });

  it('composes with word-wrap — `\\n` flushes regardless of line width', () => {
    // 8 px/char × "aaaa" = 32 px fits in 100 px. The `\n` forces a wrap
    // even though "aaaa" alone would have stayed on the same visual line.
    const block = para([{ text: 'aaaa\nbbbb' }]);
    const { layout } = computeLayout([block], stubMeasurer(), 100);
    const lines = layout.blocks[0].lines;
    expect(lines).toHaveLength(2);
    expect(lines[0].runs[0].text).toBe('aaaa');
    expect(lines[1].runs[0].text).toBe('bbbb');
  });
});
