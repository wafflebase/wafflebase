import { describe, it, expect } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { createBlock, DEFAULT_BLOCK_STYLE } from '../../src/model/types.js';
import type { Block, Document } from '../../src/model/types.js';
import { BUILTIN_STYLES, effectiveBlockSpacing } from '../../src/model/named-styles.js';
import { Doc } from '../../src/model/document.js';

function para(id: string): Block {
  return { id, type: 'paragraph', inlines: [{ text: 'x', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } };
}

function docWith(...blocks: Block[]): Document {
  return { blocks };
}

describe('MemDocStore named styles', () => {
  it('returns an empty registry by default', () => {
    const store = new MemDocStore(docWith(para('a')));
    expect(store.getDocStyles()).toEqual({});
  });

  it('setBlockType materializes the style spacing when the style changes', () => {
    const store = new MemDocStore(docWith(para('a')));
    store.setBlockType('a', 'heading', { headingLevel: 1 });
    const block = store.getBlock('a')!;
    expect(block.style.marginTop).toBe(BUILTIN_STYLES['heading-1'].block.marginTop);
    expect(block.style.marginBottom).toBe(BUILTIN_STYLES['heading-1'].block.marginBottom);
    // Leading is style-owned too, so applying a style resets line spacing —
    // Google Docs' behaviour, and what keeps this eager write in agreement
    // with the lazy `effectiveBlockSpacing` the renderer resolves through.
    // Leading is NOT materialized — it stays a purely resolved field, so the
    // block keeps whatever it had. See `materializeBlockSpacing`.
    expect(block.style.lineHeight).toBe(DEFAULT_BLOCK_STYLE.lineHeight);
  });

  it('setBlockType back to paragraph resets heading spacing', () => {
    const store = new MemDocStore(docWith(para('a')));
    store.setBlockType('a', 'heading', { headingLevel: 1 });
    store.setBlockType('a', 'paragraph');
    const block = store.getBlock('a')!;
    expect(block.style.marginTop).toBe(BUILTIN_STYLES['normal'].block.marginTop);
    expect(block.style.marginBottom).toBe(BUILTIN_STYLES['normal'].block.marginBottom);
    expect(block.style.lineHeight).toBe(DEFAULT_BLOCK_STYLE.lineHeight);
  });

  it('a bullet toggle (paragraph↔list-item) does not disturb custom spacing', () => {
    const store = new MemDocStore(docWith(para('a')));
    store.applyBlockStyle('a', { marginTop: 99, marginBottom: 99 });
    store.setBlockType('a', 'list-item', { listKind: 'unordered', listLevel: 0 });
    const block = store.getBlock('a')!;
    expect(block.style.marginTop).toBe(99);
    expect(block.style.marginBottom).toBe(99);
  });

  it('updateStyleDefinition stores the override and re-materializes block spacing', () => {
    const h1 = createBlock('heading', { headingLevel: 1 });
    h1.id = 'h';
    const store = new MemDocStore(docWith(h1 as Block));
    store.updateStyleDefinition('heading-1', {
      inline: { fontSize: 30, bold: true },
      block: { marginTop: 40, marginBottom: 12 },
    });
    expect(store.getDocStyles()['heading-1']?.inline?.fontSize).toBe(30);
    const block = store.getBlock('h')!;
    expect(block.style.marginTop).toBe(40);
    expect(block.style.marginBottom).toBe(12);
  });

  it('resetStyle drops the override and restores built-in spacing', () => {
    const h1 = createBlock('heading', { headingLevel: 1 });
    h1.id = 'h';
    const store = new MemDocStore(docWith(h1 as Block));
    store.updateStyleDefinition('heading-1', { inline: {}, block: { marginTop: 40, marginBottom: 12 } });
    store.resetStyle('heading-1');
    expect(store.getDocStyles()['heading-1']).toBeUndefined();
    const block = store.getBlock('h')!;
    expect(block.style.marginTop).toBe(BUILTIN_STYLES['heading-1'].block.marginTop);
  });

  it('setDocStyles re-materializes block spacing across styled blocks', () => {
    const h1 = createBlock('heading', { headingLevel: 1 });
    h1.id = 'h';
    const store = new MemDocStore(docWith(h1 as Block));
    store.setDocStyles({ 'heading-1': { block: { marginTop: 50, marginBottom: 9 } } });
    expect(store.getBlock('h')!.style.marginTop).toBe(50);
    // Clearing the registry re-materializes back to the built-in H1 spacing.
    store.setDocStyles({});
    expect(store.getBlock('h')!.style.marginTop).toBe(BUILTIN_STYLES['heading-1'].block.marginTop);
  });

  it('resetAllStyles clears the whole registry', () => {
    const store = new MemDocStore(docWith(para('a')));
    store.updateStyleDefinition('title', { inline: { color: '#ff0000' }, block: {} });
    store.resetAllStyles();
    expect(store.getDocStyles()).toEqual({});
  });

  it('snapshot + undo restores the prior registry and spacing', () => {
    const h1 = createBlock('heading', { headingLevel: 1 });
    h1.id = 'h';
    const store = new MemDocStore(docWith(h1 as Block));
    store.snapshot();
    store.updateStyleDefinition('heading-1', { inline: { fontSize: 30 }, block: { marginTop: 40, marginBottom: 12 } });
    store.undo();
    expect(store.getDocStyles()).toEqual({});
    // Pre-snapshot the block was created at DEFAULT_BLOCK_STYLE (marginTop 0);
    // undo restores that, not the built-in heading spacing.
    expect(store.getBlock('h')!.style.marginTop).toBe(DEFAULT_BLOCK_STYLE.marginTop);
  });
});

describe('the interactive line-spacing pick sticks (Doc.applyBlockStyle funnel)', () => {
  // The second verified defect: the docs toolbar's `LineSpacingPicker` offers
  // 1.5 as a preset *and* accepts it in its Custom field, and on the six styles
  // whose own leading is not 1.5 (Title, Subtitle, Heading 1–4) that pick wrote
  // exactly the value the resolver read back as "inherit". The pick was a
  // silent no-op — and from an authored 2.0 it jumped the block to the style's
  // leading rather than to 1.5.
  //
  // These go through `Doc.applyBlockStyle`, the single funnel every interactive
  // block-style write passes through, because that is where the marker is
  // stamped. A test that set `block.style.authoredLineHeight` by hand would
  // pass without the funnel and so would not catch a toolbar regression.
  function titleDoc() {
    const title = createBlock('title');
    title.id = 't';
    const store = new MemDocStore(docWith(title as Block));
    return { doc: new Doc(store), store };
  }

  it('1.5 on a Title is honoured, not read back as inherit', () => {
    const { doc, store } = titleDoc();
    doc.applyBlockStyle('t', { lineHeight: 1.5 });
    expect(store.getBlock('t')!.style.authoredLineHeight).toBe(true);
    expect(effectiveBlockSpacing(store.getBlock('t')!, undefined, { namedStyleSpacing: true }).lineHeight).toBe(1.5);
  });

  it('1.5 from an authored 2.0 lands on 1.5, not on the style leading', () => {
    const { doc, store } = titleDoc();
    doc.applyBlockStyle('t', { lineHeight: 2 });
    expect(effectiveBlockSpacing(store.getBlock('t')!, undefined, { namedStyleSpacing: true }).lineHeight).toBe(2);
    doc.applyBlockStyle('t', { lineHeight: 1.5 });
    expect(effectiveBlockSpacing(store.getBlock('t')!, undefined, { namedStyleSpacing: true }).lineHeight).toBe(1.5);
  });

  it('claims only the leading, leaving the style\'s space-before intact', () => {
    const h1 = createBlock('heading', { headingLevel: 1 });
    h1.id = 'h';
    const store = new MemDocStore(docWith(h1 as Block));
    new Doc(store).applyBlockStyle('h', { lineHeight: 1.5 });
    expect(effectiveBlockSpacing(store.getBlock('h')!, undefined, { namedStyleSpacing: true })).toEqual({
      marginTop: 27, marginBottom: 8, lineHeight: 1.5,
    });
  });

  it('alignment and indent claim no spacing', () => {
    const { doc, store } = titleDoc();
    doc.applyBlockStyle('t', { alignment: 'center' });
    doc.applyBlockStyle('t', { marginLeft: 36 });
    const style = store.getBlock('t')!.style;
    expect(style.authoredLineHeight).toBeUndefined();
    expect(style.authoredMarginTop).toBeUndefined();
    expect(style.authoredMarginBottom).toBeUndefined();
    // …so the Title still leads at its own 1.1.
    expect(effectiveBlockSpacing(store.getBlock('t')!, undefined, { namedStyleSpacing: true }).lineHeight)
      .toBe(BUILTIN_STYLES['title'].block.lineHeight);
  });

  it('re-applying a different style clears the authored leading again', () => {
    // The un-author affordance: both stores materialize only when the `StyleId`
    // actually changes, so re-picking the *same* style is a no-op. Switching
    // away and back is what returns a field to its style.
    const { doc, store } = titleDoc();
    doc.applyBlockStyle('t', { lineHeight: 1.5 });
    doc.setBlockType('t', 'paragraph');
    doc.setBlockType('t', 'title');
    expect(store.getBlock('t')!.style.authoredLineHeight).toBe(false);
    expect(effectiveBlockSpacing(store.getBlock('t')!, undefined, { namedStyleSpacing: true }).lineHeight)
      .toBe(BUILTIN_STYLES['title'].block.lineHeight);
  });
});
