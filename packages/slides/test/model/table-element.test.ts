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

describe('MemSlidesStore.withTableCellBody', () => {
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
          columnWidths: [100, 100],
          rows: [
            {
              height: 50,
              cells: [
                { body: { blocks: [paragraph('a')] }, style: {} },
                { body: { blocks: [paragraph('b')] }, style: {} },
              ],
            },
            {
              height: 50,
              cells: [
                { body: { blocks: [paragraph('c')] }, style: {} },
                { body: { blocks: [paragraph('d')] }, style: {} },
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

  function paragraph(text: string) {
    return {
      id: `b-${text}`,
      type: 'paragraph' as const,
      inlines: [{ text, style: {} }],
      style: { alignment: 'left' as const, lineHeight: 1.2, marginTop: 0, marginBottom: 0, marginLeft: 0, textIndent: 0 },
    };
  }

  function readCellText(table: TableElement, r: number, c: number): string {
    return table.data.rows[r].cells[c].body.blocks[0].inlines[0].text;
  }

  it('mutates the targeted cell.body.blocks via the callback', () => {
    const { store, slideId, tableId } = setupTable();
    store.batch(() => {
      store.withTableCellBody(slideId, tableId, 0, 1, (blocks) => {
        blocks[0].inlines[0].text = 'B';
      });
    });
    const table = readTable(store, slideId, tableId);
    expect(readCellText(table, 0, 0)).toBe('a');
    expect(readCellText(table, 0, 1)).toBe('B');
    expect(readCellText(table, 1, 0)).toBe('c');
    expect(readCellText(table, 1, 1)).toBe('d');
  });

  it('honors an explicit blocks[] return value from the callback', () => {
    const { store, slideId, tableId } = setupTable();
    store.batch(() => {
      store.withTableCellBody(slideId, tableId, 1, 1, () => [paragraph('replaced')]);
    });
    const table = readTable(store, slideId, tableId);
    expect(readCellText(table, 1, 1)).toBe('replaced');
  });

  it('throws when the element is not a table', () => {
    const store = new MemSlidesStore();
    let slideId = '';
    let textId = '';
    store.batch(() => {
      slideId = store.addSlide('blank', 0);
      textId = store.addElement(slideId, {
        type: 'text',
        frame: { x: 0, y: 0, w: 100, h: 30, rotation: 0 },
        data: { blocks: [paragraph('hi')] },
      });
    });
    expect(() =>
      store.batch(() => {
        store.withTableCellBody(slideId, textId, 0, 0, () => undefined);
      }),
    ).toThrow(/not a table/);
  });

  it('throws when the cell is covered (gridSpan === 0 or rowSpan === 0)', () => {
    const store = new MemSlidesStore();
    let slideId = '';
    let tableId = '';
    store.batch(() => {
      slideId = store.addSlide('blank', 0);
      tableId = store.addElement(slideId, {
        type: 'table',
        frame: { x: 0, y: 0, w: 200, h: 50, rotation: 0 },
        data: {
          columnWidths: [100, 100],
          rows: [
            {
              height: 50,
              cells: [
                { body: { blocks: [] }, style: {}, gridSpan: 2 },
                { body: { blocks: [] }, style: {}, gridSpan: 0 },
              ],
            },
          ],
        },
      });
    });
    expect(() =>
      store.batch(() => {
        store.withTableCellBody(slideId, tableId, 0, 1, () => undefined);
      }),
    ).toThrow(/covered/);
  });

  it('throws when (row, col) is out of bounds', () => {
    const { store, slideId, tableId } = setupTable();
    expect(() =>
      store.batch(() => {
        store.withTableCellBody(slideId, tableId, 5, 5, () => undefined);
      }),
    ).toThrow(/cell/i);
  });
});

describe('MemSlidesStore.insertTableRow', () => {
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
          columnWidths: [100, 100],
          rows: [
            {
              height: 50,
              cells: [
                { body: { blocks: [] }, style: {} },
                { body: { blocks: [] }, style: {} },
              ],
            },
            {
              height: 50,
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

  it('appends a row with the same column count when atIndex === rows.length', () => {
    const { store, slideId, tableId } = setupTable();
    store.batch(() => {
      store.insertTableRow(slideId, tableId, 2);
    });
    const t = readTable(store, slideId, tableId);
    expect(t.data.rows).toHaveLength(3);
    expect(t.data.rows[2].cells).toHaveLength(2);
    // Empty body, no style, no spans on the new cells.
    for (const cell of t.data.rows[2].cells) {
      expect(cell.body.blocks).toEqual([]);
      expect(cell.style).toEqual({});
      expect(cell.gridSpan).toBeUndefined();
      expect(cell.rowSpan).toBeUndefined();
    }
  });

  it('inserts a row at the head when atIndex === 0', () => {
    const { store, slideId, tableId } = setupTable();
    store.batch(() => {
      store.insertTableRow(slideId, tableId, 0);
    });
    const t = readTable(store, slideId, tableId);
    expect(t.data.rows).toHaveLength(3);
    // The new row is now row 0; the old rows shifted down.
    expect(t.data.rows[0].cells).toHaveLength(2);
    expect(t.data.rows[0].cells[0].body.blocks).toEqual([]);
  });

  it('inherits the adjacent row height as a sensible default', () => {
    const { store, slideId, tableId } = setupTable();
    store.batch(() => {
      store.insertTableRow(slideId, tableId, 2);
    });
    const t = readTable(store, slideId, tableId);
    expect(t.data.rows[2].height).toBe(50); // inherited from row 1
  });

  it('extends frame.h by the new row height to keep the sum invariant', () => {
    const { store, slideId, tableId } = setupTable();
    store.batch(() => {
      store.insertTableRow(slideId, tableId, 2);
    });
    const t = readTable(store, slideId, tableId);
    // sum(row.height) = 50 + 50 + 50 = 150
    expect(t.frame.h).toBe(150);
  });

  it('throws when the element is not a table', () => {
    const store = new MemSlidesStore();
    let slideId = '';
    let textId = '';
    store.batch(() => {
      slideId = store.addSlide('blank', 0);
      textId = store.addElement(slideId, {
        type: 'text',
        frame: { x: 0, y: 0, w: 100, h: 30, rotation: 0 },
        data: { blocks: [] },
      });
    });
    expect(() =>
      store.batch(() => {
        store.insertTableRow(slideId, textId, 0);
      }),
    ).toThrow(/not a table/);
  });

  it('throws when atIndex is out of range', () => {
    const { store, slideId, tableId } = setupTable();
    expect(() =>
      store.batch(() => {
        store.insertTableRow(slideId, tableId, -1);
      }),
    ).toThrow(/atIndex/);
    expect(() =>
      store.batch(() => {
        store.insertTableRow(slideId, tableId, 99);
      }),
    ).toThrow(/atIndex/);
  });
});
