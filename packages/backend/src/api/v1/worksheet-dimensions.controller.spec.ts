import { BadRequestException } from '@nestjs/common';
import { createSpreadsheetDocument } from '@wafflebase/sheets';
import type { SpreadsheetDocument } from '@wafflebase/sheets';
import { ApiV1WorksheetDimensionsController } from './worksheet-dimensions.controller';

const WS = 'ws-1';
const DOC = 'doc-1';

describe('ApiV1WorksheetDimensionsController', () => {
  let controller: ApiV1WorksheetDimensionsController;
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
    controller = new ApiV1WorksheetDimensionsController(
      { withDocument } as never,
      documentService as never,
    );
  });

  const ws = () => root.sheets['tab-1'] as Record<string, unknown>;

  it('merges column styles per index and clears with null', async () => {
    await controller.setColumnStyles(WS, DOC, 'tab-1', {
      columnStyles: { '1': { b: true }, '2': { i: true } },
    });
    await controller.setColumnStyles(WS, DOC, 'tab-1', {
      columnStyles: { '1': { i: true }, '2': null },
    });
    const res = await controller.getColumnStyles(WS, DOC, 'tab-1');
    expect(res.columnStyles['1']).toMatchObject({ b: true, i: true });
    expect(res.columnStyles['2']).toBeUndefined();
  });

  it('round-trips row styles', async () => {
    await controller.setRowStyles(WS, DOC, 'tab-1', {
      rowStyles: { '3': { u: true } },
    });
    const res = await controller.getRowStyles(WS, DOC, 'tab-1');
    expect(res.rowStyles['3']).toMatchObject({ u: true });
  });

  it('sets and clears column widths', async () => {
    await controller.setColumnWidths(WS, DOC, 'tab-1', {
      columnWidths: { '1': 140 },
    });
    expect((ws().colWidths as Record<string, number>)['1']).toBe(140);
    await controller.setColumnWidths(WS, DOC, 'tab-1', {
      columnWidths: { '1': null },
    });
    const res = await controller.getColumnWidths(WS, DOC, 'tab-1');
    expect(res.columnWidths['1']).toBeUndefined();
  });

  it('round-trips row heights', async () => {
    await controller.setRowHeights(WS, DOC, 'tab-1', {
      rowHeights: { '2': 32 },
    });
    const res = await controller.getRowHeights(WS, DOC, 'tab-1');
    expect(res.rowHeights['2']).toBe(32);
  });

  it('rejects an invalid style before opening the doc', async () => {
    await expect(
      controller.setColumnStyles(WS, DOC, 'tab-1', {
        columnStyles: { '1': { bogus: 1 } },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(withDocument).not.toHaveBeenCalled();
  });

  it('rejects worksheet dimensions on a non-sheet document', async () => {
    documentService.getDocumentOrThrow.mockResolvedValue({
      id: DOC,
      workspaceId: WS,
      type: 'doc',
    });
    await expect(
      controller.getColumnWidths(WS, DOC, 'tab-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
