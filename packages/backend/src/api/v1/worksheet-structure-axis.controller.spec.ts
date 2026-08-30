import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import yorkie, { Document as YorkieDocument } from '@yorkie-js/sdk';
import {
  createSpreadsheetDocument,
  getWorksheetCell,
  parseRef,
  writeWorksheetCell,
} from '@wafflebase/sheets';
import type { SpreadsheetDocument } from '@wafflebase/sheets';
import { ApiV1WorksheetStructureController } from './worksheet-structure.controller';
import { MaxAxisEntries } from '../../yorkie/worksheet-structure';

const WS = 'ws-1';
const DOC = 'doc-1';
const TAB = 'tab-1';

/**
 * Row/column edits run against a real (offline) `yorkie.Document`, not a plain
 * object: `doc.update` alone builds the CRDT and hands the engine the same
 * proxies production sees, which is the only place the axis-order splices and
 * the cell-key rewrites can be shown to work.
 */
describe('ApiV1WorksheetStructureController row/column edits', () => {
  let controller: ApiV1WorksheetStructureController;
  let doc: YorkieDocument<SpreadsheetDocument>;
  let documentService: { getDocumentOrThrow: jest.Mock };
  let withDocument: jest.Mock;

  const seed = (cells: Record<string, string>) => {
    doc.update((root) => {
      for (const [ref, value] of Object.entries(cells)) {
        writeWorksheetCell(root.sheets[TAB], parseRef(ref), { v: value });
      }
    });
  };

  const read = (ref: string) =>
    getWorksheetCell(doc.getRoot().sheets[TAB], parseRef(ref))?.v;

  beforeEach(() => {
    doc = new yorkie.Document<SpreadsheetDocument>(
      `sheet-structure-test-${process.hrtime.bigint()}`,
    );
    doc.update((root) => {
      const initial = createSpreadsheetDocument();
      root.tabs = initial.tabs;
      root.tabOrder = initial.tabOrder;
      root.sheets = initial.sheets;
    });
    withDocument = jest.fn((_id: string, cb: (d: typeof doc) => unknown) =>
      Promise.resolve(cb(doc)),
    );
    documentService = {
      getDocumentOrThrow: jest
        .fn()
        .mockResolvedValue({ id: DOC, workspaceId: WS, type: 'sheet' }),
    };
    controller = new ApiV1WorksheetStructureController(
      { withDocument } as never,
      documentService as never,
    );
  });

  it('insert pushes rows at and below the index down', async () => {
    seed({ A1: 'one', A2: 'two' });

    const res = await controller.insertAxis(WS, DOC, TAB, {
      axis: 'row',
      index: 2,
      count: 1,
    });

    expect(res).toEqual({ axis: 'row', index: 2, count: 1 });
    expect(read('A1')).toBe('one');
    expect(read('A2')).toBeUndefined();
    expect(read('A3')).toBe('two');
  });

  it('insert shifts a formula that points below the insertion', async () => {
    doc.update((root) => {
      writeWorksheetCell(root.sheets[TAB], parseRef('B1'), { f: '=A2' });
    });

    await controller.insertAxis(WS, DOC, TAB, {
      axis: 'row',
      index: 2,
      count: 1,
    });

    expect(getWorksheetCell(doc.getRoot().sheets[TAB], parseRef('B1'))?.f).toBe(
      '=A3',
    );
  });

  it('delete removes the rows and pulls the rest up', async () => {
    seed({ A1: 'one', A2: 'two', A3: 'three' });

    const res = await controller.deleteAxis(WS, DOC, TAB, {
      axis: 'row',
      index: 2,
      count: 1,
    });

    // The engine's negative-count convention is internal: the response echoes
    // the request the caller actually sent.
    expect(res).toEqual({ axis: 'row', index: 2, count: 1 });
    expect(read('A1')).toBe('one');
    expect(read('A2')).toBe('three');
    expect(read('A3')).toBeUndefined();
  });

  it('insert and delete work on columns too', async () => {
    seed({ A1: 'a', B1: 'b' });

    await controller.insertAxis(WS, DOC, TAB, {
      axis: 'column',
      index: 1,
      count: 1,
    });
    expect(read('A1')).toBeUndefined();
    expect(read('B1')).toBe('a');
    expect(read('C1')).toBe('b');

    await controller.deleteAxis(WS, DOC, TAB, {
      axis: 'column',
      index: 1,
      count: 1,
    });
    expect(read('A1')).toBe('a');
    expect(read('B1')).toBe('b');
  });

  it('move relocates a row block', async () => {
    seed({ A1: 'one', A2: 'two', A3: 'three' });

    const res = await controller.moveAxis(WS, DOC, TAB, {
      axis: 'row',
      srcIndex: 3,
      count: 1,
      dstIndex: 1,
    });

    expect(res).toEqual({ axis: 'row', srcIndex: 3, count: 1, dstIndex: 1 });
    expect(read('A1')).toBe('three');
    expect(read('A2')).toBe('one');
    expect(read('A3')).toBe('two');
  });

  it('rejects an invalid request before opening the document', async () => {
    await expect(
      controller.insertAxis(WS, DOC, TAB, { axis: 'row', index: 0, count: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.deleteAxis(WS, DOC, TAB, { axis: 'row', index: 1, count: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.moveAxis(WS, DOC, TAB, {
        axis: 'row',
        srcIndex: 2,
        count: 3,
        dstIndex: 3,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(withDocument).not.toHaveBeenCalled();
  });

  it('rejects row/column edits on a non-sheet document', async () => {
    documentService.getDocumentOrThrow.mockResolvedValue({
      id: DOC,
      workspaceId: WS,
      type: 'doc',
    });
    for (const call of [
      () =>
        controller.insertAxis(WS, DOC, TAB, {
          axis: 'row',
          index: 1,
          count: 1,
        }),
      () =>
        controller.deleteAxis(WS, DOC, TAB, {
          axis: 'row',
          index: 1,
          count: 1,
        }),
      () =>
        controller.moveAxis(WS, DOC, TAB, {
          axis: 'row',
          srcIndex: 2,
          count: 1,
          dstIndex: 1,
        }),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(withDocument).not.toHaveBeenCalled();
  });

  it('rejects a structural edit against an unknown tab', async () => {
    for (const call of [
      () =>
        controller.insertAxis(WS, DOC, 'no-such-tab', {
          axis: 'row',
          index: 1,
          count: 1,
        }),
      () =>
        controller.deleteAxis(WS, DOC, 'no-such-tab', {
          axis: 'row',
          index: 1,
          count: 1,
        }),
      () =>
        controller.moveAxis(WS, DOC, 'no-such-tab', {
          axis: 'row',
          srcIndex: 2,
          count: 1,
          dstIndex: 1,
        }),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(NotFoundException);
    }
  });

  // `root.sheets` is a Yorkie proxy whose get trap answers these with a
  // *function* — truthy — so a bare `if (!worksheet)` accepted them and handed
  // the engine a function to splice `rowOrder` on: a 500, not a 404.
  // `__proto__` and `constructor` are here because they are truthy on a plain
  // object, which is the fixture the clear-range spec uses.
  it.each([
    'toString',
    'toJSON',
    'toJS',
    'toJSForTest',
    'getID',
    '__proto__',
    'constructor',
  ])('rejects the proxy magic key %s as a tab id', async (tabId) => {
    await expect(
      controller.insertAxis(WS, DOC, tabId, {
        axis: 'row',
        index: 1,
        count: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(doc.getRoot().sheets[TAB].rowOrder.length).toBe(0);
  });

  it('refuses a structural edit on a pivot-output tab', async () => {
    // `Sheet.insertRows` and friends open with `if (this.pivotDefinition)
    // return;` — the rows here are regenerated from the definition.
    doc.update((root) => {
      root.sheets[TAB].pivotTable = {
        id: 'p1',
        sourceTabId: TAB,
        sourceRange: 'A1:B4',
        rowFields: [],
        columnFields: [],
        valueFields: [],
        filterFields: [],
        showTotals: { rows: true, columns: true },
      };
    });

    await expect(
      controller.insertAxis(WS, DOC, TAB, { axis: 'row', index: 1, count: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a structural edit on a non-sheet tab', async () => {
    // A datasource tab's grid is re-materialized from its query on refresh, so
    // a shift written here would be silently discarded.
    doc.update((root) => {
      root.tabs[TAB].type = 'datasource';
    });

    await expect(
      controller.insertAxis(WS, DOC, TAB, { axis: 'row', index: 1, count: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('resource bounds', () => {
    // Without the bound this test does not fail — it hangs the suite for
    // minutes. `ensureAxisLength` back-fills the whole axis before the insert,
    // so a one-row insert at row 1,000,000 materializes 999,999 CRDT entries
    // synchronously inside `doc.update`, and the axis-id space (36^4) runs out
    // on the way.
    it('rejects an insert at a far index instead of materializing the axis', async () => {
      seed({ A1: 'one' });

      await expect(
        controller.insertAxis(WS, DOC, TAB, {
          axis: 'row',
          index: 1000000,
          count: 1,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      // The throw happens before the first mutation, so the update rolls back.
      expect(doc.getRoot().sheets[TAB].rowOrder.length).toBe(1);
      expect(read('A1')).toBe('one');
    });

    it('rejects an insert of more than MaxAxisEntries at once', async () => {
      await expect(
        controller.insertAxis(WS, DOC, TAB, {
          axis: 'row',
          index: 1,
          count: MaxAxisEntries + 1,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(doc.getRoot().sheets[TAB].rowOrder.length).toBe(0);
    });

    it('allows an insert of exactly MaxAxisEntries', async () => {
      await controller.insertAxis(WS, DOC, TAB, {
        axis: 'row',
        index: 1,
        count: MaxAxisEntries,
      });
      expect(doc.getRoot().sheets[TAB].rowOrder.length).toBe(MaxAxisEntries);
    });

    it('bounds repeated inserts cumulatively', async () => {
      // Each request is legal in isolation. Columns make the grid bound cheap
      // to reach: two 10,000-column inserts would leave 20,000 > 18,278.
      await controller.insertAxis(WS, DOC, TAB, {
        axis: 'column',
        index: 1,
        count: 10000,
      });
      expect(doc.getRoot().sheets[TAB].colOrder.length).toBe(10000);

      await expect(
        controller.insertAxis(WS, DOC, TAB, {
          axis: 'column',
          index: 1,
          count: 10000,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(doc.getRoot().sheets[TAB].colOrder.length).toBe(10000);
    });

    it('rejects a move whose source lies far past the axis', async () => {
      seed({ A1: 'one', A2: 'two' });

      await expect(
        controller.moveAxis(WS, DOC, TAB, {
          axis: 'row',
          srcIndex: 999999,
          count: 1,
          dstIndex: 1,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(read('A1')).toBe('one');
    });

    it('does not bound a delete by the growth cap', async () => {
      seed({ A1: 'one', A2: 'two', A3: 'three' });

      await controller.deleteAxis(WS, DOC, TAB, {
        axis: 'row',
        index: 1,
        count: 1000000,
      });

      expect(read('A1')).toBeUndefined();
      expect(read('A2')).toBeUndefined();
      expect(read('A3')).toBeUndefined();
    });
  });

  describe('parity with the editor', () => {
    it('refuses a move that would split a merged range', async () => {
      // A1:A3 merged; moving row 2 out would leave a merge over rows that were
      // never merged. `Sheet.moveCells` abandons the whole operation here.
      seed({ A1: 'one', A2: 'two', A3: 'three' });
      doc.update((root) => {
        root.sheets[TAB].merges = { A1: { rs: 3, cs: 1 } };
      });

      await expect(
        controller.moveAxis(WS, DOC, TAB, {
          axis: 'row',
          srcIndex: 2,
          count: 1,
          dstIndex: 5,
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(read('A2')).toBe('two');
      expect(doc.getRoot().sheets[TAB].merges?.A1).toEqual({ rs: 3, cs: 1 });
    });

    it('allows a move that carries a whole merged block', async () => {
      seed({ A1: 'one', A2: 'two', A3: 'three' });
      doc.update((root) => {
        root.sheets[TAB].merges = { A1: { rs: 2, cs: 1 } };
      });

      await expect(
        controller.moveAxis(WS, DOC, TAB, {
          axis: 'row',
          srcIndex: 1,
          count: 2,
          dstIndex: 4,
        }),
      ).resolves.toBeDefined();
    });

    it('shifts the filter range, hidden rows and freeze pane', async () => {
      // All five are keyed by index rather than by axis id, so unlike cells
      // they do not survive a shift on their own.
      doc.update((root) => {
        const ws = root.sheets[TAB];
        ws.filter = {
          startRow: 3,
          endRow: 20,
          startCol: 1,
          endCol: 4,
          columns: {},
          hiddenRows: [5],
        };
        ws.hiddenRows = [7];
        ws.frozenRows = 2;
      });

      await controller.insertAxis(WS, DOC, TAB, {
        axis: 'row',
        index: 1,
        count: 2,
      });

      // A Yorkie array proxy does not deep-compare, so spread it first.
      const ws = doc.getRoot().sheets[TAB];
      expect(ws.filter?.startRow).toBe(5);
      expect(ws.filter?.endRow).toBe(22);
      expect([...(ws.filter?.hiddenRows ?? [])]).toEqual([7]);
      expect([...(ws.hiddenRows ?? [])]).toEqual([9]);
      expect(ws.frozenRows).toBe(4);
    });

    it('shrinks the freeze pane when rows inside it are deleted', async () => {
      doc.update((root) => {
        root.sheets[TAB].frozenRows = 3;
      });

      await controller.deleteAxis(WS, DOC, TAB, {
        axis: 'row',
        index: 1,
        count: 2,
      });

      expect(doc.getRoot().sheets[TAB].frozenRows).toBe(1);
    });

    it('clears cached formula values it cannot recalculate', async () => {
      // The calculator needs a live `Sheet` and is async; this runs inside a
      // synchronous `doc.update`. `null` beats a number that no longer matches
      // the formula next to it.
      doc.update((root) => {
        writeWorksheetCell(root.sheets[TAB], parseRef('B1'), {
          f: '=A2',
          v: '42',
        });
      });

      await controller.insertAxis(WS, DOC, TAB, {
        axis: 'row',
        index: 2,
        count: 1,
      });

      const cell = getWorksheetCell(doc.getRoot().sheets[TAB], parseRef('B1'));
      expect(cell?.f).toBe('=A3');
      expect(cell?.v).toBeUndefined();
    });
  });

  describe('cross-tab ranges', () => {
    const seedSecondTab = () => {
      doc.update((root) => {
        const second = createSpreadsheetDocument({
          tabId: 'tab-2',
          tabName: 'Sheet2',
        });
        root.tabs['tab-2'] = second.tabs['tab-2'];
        root.tabOrder.push('tab-2');
        root.sheets['tab-2'] = second.sheets['tab-2'];
        root.sheets['tab-2'].charts = {
          c1: {
            id: 'c1',
            type: 'bar',
            sourceTabId: TAB,
            sourceRange: 'A2:B4',
            anchor: 'A1',
            offsetX: 0,
            offsetY: 0,
            width: 320,
            height: 200,
          },
        };
      });
    };

    it("repoints another tab's chart range on insert", async () => {
      seedSecondTab();

      await controller.insertAxis(WS, DOC, TAB, {
        axis: 'row',
        index: 1,
        count: 1,
      });

      expect(doc.getRoot().sheets['tab-2'].charts!.c1.sourceRange).toBe(
        'A3:B5',
      );
    });

    it("repoints another tab's chart range on move", async () => {
      seedSecondTab();

      await controller.moveAxis(WS, DOC, TAB, {
        axis: 'row',
        srcIndex: 2,
        count: 1,
        dstIndex: 6,
      });

      expect(doc.getRoot().sheets['tab-2'].charts!.c1.sourceRange).not.toBe(
        'A2:B4',
      );
    });
  });
});
