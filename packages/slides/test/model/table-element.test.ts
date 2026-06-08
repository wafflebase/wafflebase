import { describe, it, expect } from 'vitest';
import { MemSlidesStore } from '../../src/store/memory';
import { isElementEmpty, type TableElement } from '../../src/model/element';

describe('TableElement model', () => {
  it('round-trips through MemSlidesStore.addElement / read()', () => {
    const store = new MemSlidesStore();
    let slideId = '';
    store.batch(() => {
      slideId = store.addSlide('blank', 0);
    });

    const init: Omit<TableElement, 'id'> = {
      type: 'table',
      frame: { x: 100, y: 80, w: 400, h: 200, rotation: 0 },
      data: {
        columnWidths: [200, 200],
        rows: [
          {
            height: 100,
            cells: [
              { body: { blocks: [] }, style: {} },
              { body: { blocks: [] }, style: {} },
            ],
          },
          {
            height: 100,
            cells: [
              { body: { blocks: [] }, style: {} },
              { body: { blocks: [] }, style: {} },
            ],
          },
        ],
      },
    };

    let tableId = '';
    store.batch(() => {
      tableId = store.addElement(slideId, init);
    });

    const doc = store.read();
    const slide = doc.slides.find((s) => s.id === slideId);
    expect(slide).toBeDefined();
    const table = slide?.elements.find((e) => e.id === tableId);
    expect(table).toBeDefined();
    expect(table?.type).toBe('table');

    const t = table as TableElement;
    expect(t.data.columnWidths).toEqual([200, 200]);
    expect(t.data.rows).toHaveLength(2);
    expect(t.data.rows[0].cells).toHaveLength(2);
    expect(t.data.rows[0].height).toBe(100);
  });

  it('isElementEmpty returns false for a TableElement (never carries placeholder semantics)', () => {
    const table: TableElement = {
      id: 't1',
      type: 'table',
      frame: { x: 0, y: 0, w: 200, h: 100, rotation: 0 },
      data: {
        columnWidths: [200],
        rows: [
          {
            height: 100,
            cells: [{ body: { blocks: [] }, style: {} }],
          },
        ],
      },
    };
    expect(isElementEmpty(table)).toBe(false);
  });
});
