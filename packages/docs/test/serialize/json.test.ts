import { describe, it, expect } from 'vitest';
import { serializeJson } from '../../src/serialize/json.js';
import { paginateLayout } from '../../src/view/pagination.js';
import { computeLayout } from '../../src/view/layout.js';
import { DEFAULT_PAGE_SETUP, getEffectiveDimensions } from '../../src/model/types.js';
import type { Document } from '../../src/model/types.js';
import { StubMeasurer } from '../view/_stub-measurer.js';

function paragraph(id: string, text: string): import('../../src/model/types.js').Block {
  return {
    id,
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: {
      alignment: 'left',
      lineHeight: 1.5,
      marginTop: 0,
      marginBottom: 0,
      textIndent: 0,
      marginLeft: 0,
    },
  };
}

describe('serializeJson', () => {
  it('returns the document unchanged when no layout is supplied', () => {
    const doc: Document = {
      blocks: [paragraph('b1', 'hello')],
      pageSetup: DEFAULT_PAGE_SETUP,
    };
    const result = serializeJson(doc);
    expect(result.blocks).toEqual(doc.blocks);
    expect(result.pageSetup).toEqual(doc.pageSetup);
    expect(result._pageMeta).toBeUndefined();
  });

  it('strips a stale _pageMeta from the input on the no-layout path', () => {
    // `_pageMeta` is transport metadata produced only when serializeJson
    // is given a layout. If the input already carries one — e.g., a
    // round-trip through a previous serialization — the no-layout path
    // must drop it to honor the documented "omitted when no layout
    // provided" contract.
    const doc: Document & { _pageMeta?: unknown } = {
      blocks: [paragraph('b1', 'hello')],
      _pageMeta: [{ blockId: 'b1', lines: [1] }],
    } as Document & { _pageMeta?: unknown };
    const result = serializeJson(doc);
    expect(result._pageMeta).toBeUndefined();
    expect('_pageMeta' in result).toBe(false);
  });

  it('attaches _pageMeta when a paginated layout is supplied', () => {
    const setup = DEFAULT_PAGE_SETUP;
    // contentHeight = 1056 - 96 - 96 = 864. Use ~30 paragraphs of large
    // height to spill onto a second page.
    const blocks = Array.from({ length: 30 }, (_, i) => paragraph(`b${i}`, 'x'));
    const doc: Document = { blocks, pageSetup: setup };

    const measurer = new StubMeasurer();
    const { width: effW } = getEffectiveDimensions(setup);
    const contentWidth = effW - setup.margins.left - setup.margins.right;
    const { layout } = computeLayout(blocks, measurer, contentWidth);
    const paginated = paginateLayout(layout, setup);

    const result = serializeJson(doc, paginated);
    expect(result._pageMeta).toBeDefined();
    expect(result._pageMeta).toHaveLength(blocks.length);
    for (const meta of result._pageMeta!) {
      expect(typeof meta.blockId).toBe('string');
      expect(meta.lines.length).toBeGreaterThan(0);
      for (const p of meta.lines) {
        expect(p).toBeGreaterThanOrEqual(1);
      }
    }
    // The blockIds in _pageMeta line up 1:1 with the document blocks.
    expect(result._pageMeta!.map(m => m.blockId)).toEqual(blocks.map(b => b.id));
  });

  it('records pageIndex for each line of a multi-page block', () => {
    // Single block with many lines that spans onto two pages.
    const setup = DEFAULT_PAGE_SETUP;
    const block: import('../../src/model/types.js').Block = {
      id: 'spanning',
      type: 'paragraph',
      inlines: [{ text: 'word '.repeat(2000), style: {} }],
      style: {
        alignment: 'left',
        lineHeight: 1.5,
        marginTop: 0,
        marginBottom: 0,
        textIndent: 0,
        marginLeft: 0,
      },
    };
    const doc: Document = { blocks: [block], pageSetup: setup };

    const measurer = new StubMeasurer();
    const { width: effW } = getEffectiveDimensions(setup);
    const contentWidth = effW - setup.margins.left - setup.margins.right;
    const { layout } = computeLayout([block], measurer, contentWidth);
    const paginated = paginateLayout(layout, setup);

    const result = serializeJson(doc, paginated);
    expect(result._pageMeta).toBeDefined();
    expect(result._pageMeta).toHaveLength(1);
    const meta = result._pageMeta![0];
    expect(meta.blockId).toBe('spanning');
    // We expect the block to span at least two pages.
    const distinctPages = new Set(meta.lines);
    expect(distinctPages.size).toBeGreaterThanOrEqual(2);
  });
});
