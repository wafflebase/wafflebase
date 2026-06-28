import { describe, it, expect } from 'vitest';
import {
  BUILTIN_STYLES,
  STYLE_IDS,
  blockStyleId,
  resolveStyleInline,
  resolveStyleBlock,
  type DocStyles,
} from '../../src/model/named-styles.js';
import { createBlock } from '../../src/model/types.js';

describe('blockStyleId', () => {
  it('maps paragraph and list-item to normal', () => {
    expect(blockStyleId(createBlock('paragraph'))).toBe('normal');
    expect(blockStyleId(createBlock('list-item'))).toBe('normal');
  });

  it('maps title / subtitle', () => {
    expect(blockStyleId(createBlock('title'))).toBe('title');
    expect(blockStyleId(createBlock('subtitle'))).toBe('subtitle');
  });

  it('maps headings by level', () => {
    expect(blockStyleId(createBlock('heading', { headingLevel: 1 }))).toBe('heading-1');
    expect(blockStyleId(createBlock('heading', { headingLevel: 6 }))).toBe('heading-6');
  });

  it('defaults heading without level to heading-1', () => {
    const b = createBlock('heading');
    delete b.headingLevel;
    expect(blockStyleId(b)).toBe('heading-1');
  });

  it('maps structural blocks to normal', () => {
    expect(blockStyleId(createBlock('horizontal-rule'))).toBe('normal');
    expect(blockStyleId(createBlock('page-break'))).toBe('normal');
  });
});

describe('built-in style values (Google Docs defaults)', () => {
  it('covers every style id', () => {
    for (const id of STYLE_IDS) {
      expect(BUILTIN_STYLES[id]).toBeDefined();
    }
  });

  it('headings are non-bold', () => {
    for (const id of STYLE_IDS) {
      expect(BUILTIN_STYLES[id].inline.bold).toBeUndefined();
    }
  });

  it('uses the Google Docs size + color hierarchy', () => {
    expect(BUILTIN_STYLES['title'].inline.fontSize).toBe(26);
    expect(BUILTIN_STYLES['heading-1'].inline.fontSize).toBe(20);
    expect(BUILTIN_STYLES['heading-3'].inline.color).toBe('#434343');
    expect(BUILTIN_STYLES['heading-6'].inline.italic).toBe(true);
  });
});

describe('resolveStyleInline / resolveStyleBlock', () => {
  it('returns built-in when no overrides', () => {
    expect(resolveStyleInline('heading-1')).toEqual({ fontSize: 20 });
    expect(resolveStyleBlock('heading-1')).toEqual({ marginTop: 27, marginBottom: 8 });
  });

  it('merges an override over the built-in', () => {
    const docStyles: DocStyles = {
      'heading-1': { inline: { fontSize: 28, bold: true } },
    };
    expect(resolveStyleInline('heading-1', docStyles)).toEqual({ fontSize: 28, bold: true });
    // block sub-key absent in the override → still built-in
    expect(resolveStyleBlock('heading-1', docStyles)).toEqual({ marginTop: 27, marginBottom: 8 });
  });

  it('does not mutate the built-in definition', () => {
    const docStyles: DocStyles = { 'title': { inline: { color: '#ff0000' } } };
    resolveStyleInline('title', docStyles);
    expect(BUILTIN_STYLES['title'].inline.color).toBeUndefined();
  });
});
