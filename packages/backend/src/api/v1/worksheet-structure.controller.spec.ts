import { BadRequestException } from '@nestjs/common';
import {
  createSpreadsheetDocument,
  getWorksheetCell,
  parseRef,
  writeWorksheetCell,
} from '@wafflebase/sheets';
import type { SpreadsheetDocument } from '@wafflebase/sheets';
import { ApiV1WorksheetStructureController } from './worksheet-structure.controller';

const WS = 'ws-1';
const DOC = 'doc-1';

describe('ApiV1WorksheetStructureController', () => {
  let controller: ApiV1WorksheetStructureController;
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
    controller = new ApiV1WorksheetStructureController(
      { withDocument } as never,
      documentService as never,
    );
  });

  const ws = () => root.sheets['tab-1'];

  it('clears every cell inside the range and counts them', async () => {
    writeWorksheetCell(ws(), parseRef('A1'), { v: '1' });
    writeWorksheetCell(ws(), parseRef('B2'), { v: '2' });
    writeWorksheetCell(ws(), parseRef('C3'), { v: '3' }); // outside A1:B2

    const res = await controller.clearRange(WS, DOC, 'tab-1', {
      range: 'A1:B2',
    });
    expect(res.cleared).toBe(2);
    expect(getWorksheetCell(ws(), parseRef('A1'))).toBeUndefined();
    expect(getWorksheetCell(ws(), parseRef('B2'))).toBeUndefined();
    expect(getWorksheetCell(ws(), parseRef('C3'))).toMatchObject({ v: '3' });
  });

  it('reports zero when the range holds no cells', async () => {
    const res = await controller.clearRange(WS, DOC, 'tab-1', {
      range: 'Z10:Z20',
    });
    expect(res.cleared).toBe(0);
  });

  it('rejects a malformed range before opening the doc', async () => {
    await expect(
      controller.clearRange(WS, DOC, 'tab-1', { range: '123' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(withDocument).not.toHaveBeenCalled();
  });

  it('rejects clear on a non-sheet document', async () => {
    documentService.getDocumentOrThrow.mockResolvedValue({
      id: DOC,
      workspaceId: WS,
      type: 'doc',
    });
    await expect(
      controller.clearRange(WS, DOC, 'tab-1', { range: 'A1:B2' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
