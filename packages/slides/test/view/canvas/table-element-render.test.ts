import { describe, it, expect } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { DEFAULT_BLOCK_STYLE } from '@wafflebase/docs';
import { drawElement } from '../../../src/view/canvas/element-renderer';
import { defaultLight } from '../../../src/themes/default-light';
import { DEFAULT_MASTER } from '../../../src/model/master';
import { BUILT_IN_LAYOUTS } from '../../../src/model/layout';
import type { SlidesDocument } from '../../../src/model/presentation';
import type { TableElement } from '../../../src/model/element';
import { asCtx, createCtxSpy } from '../../../src/view/canvas/ctx-spy';

function emptyDoc(): SlidesDocument {
  return {
    meta: {
      title: 'test',
      themeId: defaultLight.id,
      masterId: DEFAULT_MASTER.id,
    },
    themes: [defaultLight],
    masters: [DEFAULT_MASTER],
    layouts: BUILT_IN_LAYOUTS,
    slides: [],
    guides: [],
  };
}

describe('drawElement on a TableElement', () => {
  it('applies the element frame transform and paints the table', () => {
    const ctx = createCtxSpy();
    const table: TableElement = {
      id: 'tbl',
      type: 'table',
      frame: { x: 50, y: 30, w: 200, h: 100, rotation: 0 },
      data: {
        columnWidths: [100, 100],
        rows: [
          {
            height: 50,
            cells: [
              { body: { blocks: [] }, style: { fill: '#abc' } },
              { body: { blocks: [] }, style: { fill: '#bcd' } },
            ],
          },
          {
            height: 50,
            cells: [
              { body: { blocks: [] }, style: { fill: '#cde' } },
              { body: { blocks: [] }, style: { fill: '#def' } },
            ],
          },
        ],
      },
    };

    drawElement(asCtx(ctx), table, emptyDoc(), defaultLight, () => {});

    // The element-renderer translates by (frame.x, frame.y) when there is
    // no rotation/flip, then the table-renderer paints in local space.
    // Four cells = four fillRect calls.
    expect(ctx.translate).toHaveBeenCalledWith(50, 30);
    expect(ctx.fillRect).toHaveBeenCalledTimes(4);
    expect(ctx.fillRect.mock.calls[0]).toEqual([0, 0, 100, 50]);
    expect(ctx.fillRect.mock.calls[1]).toEqual([100, 0, 100, 50]);
    expect(ctx.fillRect.mock.calls[2]).toEqual([0, 50, 100, 50]);
    expect(ctx.fillRect.mock.calls[3]).toEqual([100, 50, 100, 50]);
  });

  it('paints cell text content through the docs layout engine', () => {
    const ctx = createCtxSpy();
    const table: TableElement = {
      id: 'tbl',
      type: 'table',
      frame: { x: 0, y: 0, w: 200, h: 50, rotation: 0 },
      data: {
        columnWidths: [200],
        rows: [
          {
            height: 50,
            cells: [
              {
                body: {
                  blocks: [
                    {
                      id: 'b',
                      type: 'paragraph',
                      inlines: [{ text: 'cell', style: {} }],
                      style: { ...DEFAULT_BLOCK_STYLE },
                    },
                  ],
                },
                style: {},
              },
            ],
          },
        ],
      },
    };

    drawElement(asCtx(ctx), table, emptyDoc(), defaultLight, () => {});

    expect(ctx.fillText).toHaveBeenCalled();
  });
});
