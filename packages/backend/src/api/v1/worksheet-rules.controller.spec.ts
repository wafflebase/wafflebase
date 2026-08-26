import { BadRequestException } from '@nestjs/common';
import { createSpreadsheetDocument } from '@wafflebase/sheets';
import type { SpreadsheetDocument } from '@wafflebase/sheets';
import { ApiV1WorksheetRulesController } from './worksheet-rules.controller';

const WS = 'ws-1';
const DOC = 'doc-1';
const CF = {
  id: 'r1',
  ranges: [
    [
      { r: 0, c: 0 },
      { r: 0, c: 0 },
    ],
  ],
  op: 'isEmpty',
  style: { b: true },
};

describe('ApiV1WorksheetRulesController', () => {
  let controller: ApiV1WorksheetRulesController;
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
    controller = new ApiV1WorksheetRulesController(
      { withDocument } as never,
      documentService as never,
    );
  });

  const ws = () => root.sheets['tab-1'] as Record<string, unknown>;

  it('setConditionalFormats stores the normalized rules', async () => {
    const res = await controller.setConditionalFormats(WS, DOC, 'tab-1', {
      rules: [CF],
    });
    expect(res.rules).toHaveLength(1);
    expect(ws().conditionalFormats).toHaveLength(1);
  });

  it('getConditionalFormats returns the stored rules', async () => {
    await controller.setConditionalFormats(WS, DOC, 'tab-1', { rules: [CF] });
    const res = await controller.getConditionalFormats(WS, DOC, 'tab-1');
    expect(res.rules[0]).toMatchObject({ id: 'r1', op: 'isEmpty' });
  });

  it('rejects an invalid rule with 400 before opening the doc', async () => {
    await expect(
      controller.setConditionalFormats(WS, DOC, 'tab-1', {
        rules: [{ ...CF, op: 'nope' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(withDocument).not.toHaveBeenCalled();
  });

  it('rejects worksheet rules on a non-sheet document', async () => {
    documentService.getDocumentOrThrow.mockResolvedValue({
      id: DOC,
      workspaceId: WS,
      type: 'doc',
    });
    await expect(
      controller.setDataValidations(WS, DOC, 'tab-1', { rules: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(withDocument).not.toHaveBeenCalled();
  });
});
