import { BadRequestException } from '@nestjs/common';
import { createSpreadsheetDocument } from '@wafflebase/sheets';
import type { SpreadsheetDocument } from '@wafflebase/sheets';
import { ApiV1WorksheetStylesController } from './worksheet-styles.controller';

const WS = 'ws-1';
const DOC = 'doc-1';
const PATCH = {
  range: [
    { r: 0, c: 0 },
    { r: 2, c: 2 },
  ],
  style: { b: true },
};

describe('ApiV1WorksheetStylesController', () => {
  let controller: ApiV1WorksheetStylesController;
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
    controller = new ApiV1WorksheetStylesController(
      { withDocument } as never,
      documentService as never,
    );
  });

  const ws = () => root.sheets['tab-1'] as Record<string, unknown>;

  it('setRangeStyles stores and getRangeStyles returns patches', async () => {
    await controller.setRangeStyles(WS, DOC, 'tab-1', { rangeStyles: [PATCH] });
    expect((ws().rangeStyles as unknown[]).length).toBe(1);
    const res = await controller.getRangeStyles(WS, DOC, 'tab-1');
    expect(res.rangeStyles[0].style).toMatchObject({ b: true });
  });

  it('setSheetStyle merges the style; null clears it', async () => {
    await controller.setSheetStyle(WS, DOC, 'tab-1', { style: { b: true } });
    expect(ws().sheetStyle).toMatchObject({ b: true });
    await controller.setSheetStyle(WS, DOC, 'tab-1', { style: { i: true } });
    expect(ws().sheetStyle).toMatchObject({ b: true, i: true });
    await controller.setSheetStyle(WS, DOC, 'tab-1', { style: null });
    expect(ws().sheetStyle).toBeUndefined();
  });

  it('rejects an invalid sheet style with 400 before opening the doc', async () => {
    await expect(
      controller.setSheetStyle(WS, DOC, 'tab-1', { style: { bogus: 1 } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(withDocument).not.toHaveBeenCalled();
  });

  it('keeps the stored sheet style when the body omits "style"', async () => {
    await controller.setSheetStyle(WS, DOC, 'tab-1', { style: { b: true } });
    withDocument.mockClear();

    // An omitted key, a misspelled one and a body-less PUT (Express hands
    // Nest `{}`) must all be 400s that leave the stored style untouched --
    // clearing it here would be silent data loss behind a 200.
    for (const body of [{}, { styls: { i: true } }, { style: undefined }]) {
      await expect(
        controller.setSheetStyle(WS, DOC, 'tab-1', body),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(withDocument).not.toHaveBeenCalled();
    expect(ws().sheetStyle).toMatchObject({ b: true });
  });

  it('rejects worksheet styles on a non-sheet document', async () => {
    documentService.getDocumentOrThrow.mockResolvedValue({
      id: DOC,
      workspaceId: WS,
      type: 'doc',
    });
    await expect(
      controller.getSheetStyle(WS, DOC, 'tab-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
