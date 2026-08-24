import { BadRequestException } from '@nestjs/common';
import { createSpreadsheetDocument } from '@wafflebase/sheets';
import type { SpreadsheetDocument } from '@wafflebase/sheets';
import { ApiV1WorksheetController } from './worksheet.controller';

const WS = 'ws-1';
const DOC = 'doc-1';

describe('ApiV1WorksheetController', () => {
  let controller: ApiV1WorksheetController;
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
    controller = new ApiV1WorksheetController(
      { withDocument } as never,
      documentService as never,
    );
  });

  const ws = () => root.sheets['tab-1'] as Record<string, unknown>;

  it('setFreeze writes frozenRows/frozenCols', async () => {
    const r = await controller.setFreeze(WS, DOC, 'tab-1', { rows: 1, cols: 2 });
    expect(r).toEqual({ rows: 1, cols: 2 });
    expect(ws().frozenRows).toBe(1);
    expect(ws().frozenCols).toBe(2);
  });

  it('getFreeze returns defaults on a fresh tab', async () => {
    expect(await controller.getFreeze(WS, DOC, 'tab-1')).toEqual({
      rows: 0,
      cols: 0,
    });
  });

  it('setHidden writes hidden rows/columns', async () => {
    await controller.setHidden(WS, DOC, 'tab-1', { rows: [1, 3], columns: [1] });
    expect(ws().hiddenRows).toEqual([1, 3]);
    expect(ws().hiddenColumns).toEqual([1]);
  });

  // Indices are 1-based, like the A1 refs the rest of the v1 API speaks.
  // `Sheet.loadHiddenState` keeps only `>= 1`, so a 0 that reached the CRDT
  // would be dropped on load and make every index look off by one.
  it('setHidden rejects a 0 index instead of writing one the engine drops', async () => {
    await expect(
      controller.setHidden(WS, DOC, 'tab-1', { rows: [], columns: [0] }),
    ).rejects.toThrow();
    expect(ws().hiddenColumns).toBeUndefined();
  });

  it('setMerges writes the merges map', async () => {
    await controller.setMerges(WS, DOC, 'tab-1', {
      merges: { A1: { rs: 2, cs: 2 } },
    });
    expect(ws().merges).toEqual({ A1: { rs: 2, cs: 2 } });
  });

  it('rejects an invalid freeze before opening the doc', async () => {
    await expect(
      controller.setFreeze(WS, DOC, 'tab-1', { rows: -1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(withDocument).not.toHaveBeenCalled();
  });

  it('rejects worksheet ops on a non-sheet document', async () => {
    documentService.getDocumentOrThrow.mockResolvedValue({
      id: DOC,
      workspaceId: WS,
      type: 'doc',
    });
    await expect(
      controller.setFreeze(WS, DOC, 'tab-1', { rows: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(withDocument).not.toHaveBeenCalled();
  });
});
