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

describe('MemSlidesStore.updateElementFrame on a TableElement', () => {
  function setupTable(): { store: MemSlidesStore; slideId: string; tableId: string } {
    const store = new MemSlidesStore();
    let slideId = '';
    let tableId = '';
    store.batch(() => {
      slideId = store.addSlide('blank', 0);
      tableId = store.addElement(slideId, {
        type: 'table',
        frame: { x: 0, y: 0, w: 200, h: 100, rotation: 0 },
        data: {
          columnWidths: [80, 120],
          rows: [
            {
              height: 60,
              cells: [
                { body: { blocks: [] }, style: {} },
                { body: { blocks: [] }, style: {} },
              ],
            },
            {
              height: 40,
              cells: [
                { body: { blocks: [] }, style: {} },
                { body: { blocks: [] }, style: {} },
              ],
            },
          ],
        },
      });
    });
    return { store, slideId, tableId };
  }

  function readTable(store: MemSlidesStore, slideId: string, tableId: string): TableElement {
    const doc = store.read();
    const slide = doc.slides.find((s) => s.id === slideId);
    if (!slide) throw new Error('slide missing');
    const el = slide.elements.find((e) => e.id === tableId);
    if (!el || el.type !== 'table') throw new Error('table missing');
    return el;
  }

  it('proportionally scales columnWidths when frame.w changes', () => {
    // Regression guard: before wiring frame ↔ columnWidths sync, drag-
    // resizing a table mutated frame.w but left columnWidths untouched,
    // so the painted footprint (sum of columnWidths) drifted from the
    // selection bbox — clicks on visibly-painted cells outside the new
    // frame missed, and clicks in the empty resized frame "hit" the
    // table.
    const { store, slideId, tableId } = setupTable();
    store.batch(() => {
      store.updateElementFrame(slideId, tableId, { w: 400 });
    });
    const table = readTable(store, slideId, tableId);
    expect(table.frame.w).toBe(400);
    expect(table.data.columnWidths).toEqual([160, 240]); // [80, 120] * 2
  });

  it('proportionally scales row heights when frame.h changes', () => {
    const { store, slideId, tableId } = setupTable();
    store.batch(() => {
      store.updateElementFrame(slideId, tableId, { h: 200 });
    });
    const table = readTable(store, slideId, tableId);
    expect(table.frame.h).toBe(200);
    expect(table.data.rows.map((r) => r.height)).toEqual([120, 80]); // [60, 40] * 2
  });

  it('scales widths and heights together when both change', () => {
    const { store, slideId, tableId } = setupTable();
    store.batch(() => {
      store.updateElementFrame(slideId, tableId, { w: 100, h: 50 });
    });
    const table = readTable(store, slideId, tableId);
    expect(table.data.columnWidths).toEqual([40, 60]); // [80, 120] * 0.5
    expect(table.data.rows.map((r) => r.height)).toEqual([30, 20]); // [60, 40] * 0.5
  });

  it('leaves columnWidths / row heights untouched when only x/y change', () => {
    const { store, slideId, tableId } = setupTable();
    store.batch(() => {
      store.updateElementFrame(slideId, tableId, { x: 50, y: 30 });
    });
    const table = readTable(store, slideId, tableId);
    expect(table.frame.x).toBe(50);
    expect(table.frame.y).toBe(30);
    expect(table.data.columnWidths).toEqual([80, 120]);
    expect(table.data.rows.map((r) => r.height)).toEqual([60, 40]);
  });
});
