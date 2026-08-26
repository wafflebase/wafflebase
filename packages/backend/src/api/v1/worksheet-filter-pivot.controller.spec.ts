import { BadRequestException } from '@nestjs/common';
import yorkie, { Document as YorkieDocument } from '@yorkie-js/sdk';
import { createSpreadsheetDocument } from '@wafflebase/sheets';
import type { SpreadsheetDocument } from '@wafflebase/sheets';
import { ApiV1WorksheetFilterPivotController } from './worksheet-filter-pivot.controller';

const WS = 'ws-1';
const DOC = 'doc-1';
const FILTER = { startRow: 0, endRow: 5, startCol: 0, endCol: 3, columns: {} };
const PIVOT = {
  id: 'p1',
  sourceTabId: 'tab-1',
  sourceRange: 'A1:C2',
  rowFields: [],
  columnFields: [],
  valueFields: [],
  filterFields: [],
  showTotals: { rows: true, columns: true },
};

describe('ApiV1WorksheetFilterPivotController', () => {
  let controller: ApiV1WorksheetFilterPivotController;
  let root: SpreadsheetDocument;
  let withDocument: jest.Mock;
  let documentService: { getDocumentOrThrow: jest.Mock };

  beforeEach(() => {
    root = createSpreadsheetDocument();
    const doc = {
      getRoot: () => root,
      update: (fn: (r: SpreadsheetDocument) => void) => fn(root),
    };
    withDocument = jest.fn((_id: string, cb: (d: typeof doc) => unknown) =>
      Promise.resolve(cb(doc)),
    );
    documentService = {
      getDocumentOrThrow: jest
        .fn()
        .mockResolvedValue({ id: DOC, workspaceId: WS, type: 'sheet' }),
    };
    controller = new ApiV1WorksheetFilterPivotController(
      { withDocument } as never,
      documentService as never,
    );
  });

  const ws = () => root.sheets['tab-1'] as Record<string, unknown>;

  it('setFilter writes and getFilter returns it', async () => {
    await controller.setFilter(WS, DOC, 'tab-1', { filter: FILTER });
    expect(ws().filter).toMatchObject({ startRow: 0, endRow: 5 });
    const res = await controller.getFilter(WS, DOC, 'tab-1');
    expect(res.filter).toMatchObject({ startRow: 0, endRow: 5 });
  });

  it('setFilter with null clears it', async () => {
    await controller.setFilter(WS, DOC, 'tab-1', { filter: FILTER });
    await controller.setFilter(WS, DOC, 'tab-1', { filter: null });
    expect(ws().filter).toBeUndefined();
  });

  it('setPivot writes the pivotTable field', async () => {
    await controller.setPivot(WS, DOC, 'tab-1', { pivot: PIVOT });
    expect(ws().pivotTable).toMatchObject({ id: 'p1', sourceTabId: 'tab-1' });
  });

  it('rejects an invalid filter with 400 before opening the doc', async () => {
    await expect(
      controller.setFilter(WS, DOC, 'tab-1', {
        filter: { ...FILTER, startRow: -1 },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(withDocument).not.toHaveBeenCalled();
  });

  it('rejects filter/pivot on a non-sheet document', async () => {
    documentService.getDocumentOrThrow.mockResolvedValue({
      id: DOC,
      workspaceId: WS,
      type: 'doc',
    });
    await expect(controller.getFilter(WS, DOC, 'tab-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

/**
 * The suite above drives a plain `createSpreadsheetDocument()` object, which is
 * never a Yorkie proxy — so it cannot see the serialisation these two readers
 * actually have to survive in production. A real (offline) `yorkie.Document`
 * can: `doc.update` alone builds the CRDT and hands back proxies, no server
 * needed. `detachYorkieValue` mis-reads a nested array proxy (`Array.isArray`
 * is false for one) and emits CRDT metadata in its place.
 */
describe('ApiV1WorksheetFilterPivotController over a real Yorkie document', () => {
  let controller: ApiV1WorksheetFilterPivotController;
  let doc: YorkieDocument<SpreadsheetDocument>;

  beforeEach(() => {
    doc = new yorkie.Document<SpreadsheetDocument>(
      `sheet-filter-pivot-test-${Date.now()}-${Math.random()}`,
    );
    doc.update((root) => {
      const initial = createSpreadsheetDocument();
      root.tabs = initial.tabs;
      root.tabOrder = initial.tabOrder;
      root.sheets = initial.sheets;
    });
    const withDocument = jest.fn(
      (_id: string, cb: (d: typeof doc) => unknown) => Promise.resolve(cb(doc)),
    );
    controller = new ApiV1WorksheetFilterPivotController(
      { withDocument } as never,
      {
        getDocumentOrThrow: jest
          .fn()
          .mockResolvedValue({ id: DOC, workspaceId: WS, type: 'sheet' }),
      } as never,
    );
  });

  it('getFilter returns nested arrays as real arrays', async () => {
    const filter = {
      ...FILTER,
      hiddenRows: [2, 4],
      columns: { '0': { hiddenValues: ['x', 'y'] } },
    };
    await controller.setFilter(WS, DOC, 'tab-1', { filter });

    const res = await controller.getFilter(WS, DOC, 'tab-1');

    expect(res.filter).toMatchObject(filter);
    const read = res.filter as {
      hiddenRows: unknown;
      columns: { '0': { hiddenValues: unknown } };
    };
    expect(Array.isArray(read.hiddenRows)).toBe(true);
    expect(Array.isArray(read.columns['0'].hiddenValues)).toBe(true);
    // The production failure mode: the response is serialised by `res.json()`,
    // and a leaked array proxy either throws there or lands as CRDT metadata.
    const serialized = JSON.parse(JSON.stringify(res)) as { filter: unknown };
    expect(serialized.filter).toMatchObject(filter);
  });

  it('getPivot returns the four field arrays as real arrays', async () => {
    const pivot = {
      ...PIVOT,
      rowFields: [{ column: 'A' }],
      valueFields: [{ column: 'B', aggregate: 'sum' }],
    };
    await controller.setPivot(WS, DOC, 'tab-1', { pivot });

    const res = await controller.getPivot(WS, DOC, 'tab-1');

    expect(res.pivot).toMatchObject(pivot);
    for (const key of [
      'rowFields',
      'columnFields',
      'valueFields',
      'filterFields',
    ] as const) {
      expect(Array.isArray((res.pivot as Record<string, unknown>)[key])).toBe(
        true,
      );
    }
    const serialized = JSON.parse(JSON.stringify(res)) as { pivot: unknown };
    expect(serialized.pivot).toMatchObject(pivot);
  });
});
