import { describe, it, expect } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { createBlock, DEFAULT_BLOCK_STYLE } from '../../src/model/types.js';
import type { Block, Document } from '../../src/model/types.js';
import { BUILTIN_STYLES } from '../../src/model/named-styles.js';

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
  });

  it('setBlockType back to paragraph resets heading spacing', () => {
    const store = new MemDocStore(docWith(para('a')));
    store.setBlockType('a', 'heading', { headingLevel: 1 });
    store.setBlockType('a', 'paragraph');
    const block = store.getBlock('a')!;
    expect(block.style.marginTop).toBe(BUILTIN_STYLES['normal'].block.marginTop);
    expect(block.style.marginBottom).toBe(BUILTIN_STYLES['normal'].block.marginBottom);
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
