import { BadRequestException } from '@nestjs/common';
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
    await expect(
      controller.getFilter(WS, DOC, 'tab-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
