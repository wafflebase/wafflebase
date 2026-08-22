import { BadRequestException } from '@nestjs/common';
import {
  createSpreadsheetDocument,
  getWorksheetCell,
  parseRef,
} from '@wafflebase/sheets';
import type { SpreadsheetDocument } from '@wafflebase/sheets';
import { ApiV1CellsController } from './cells.controller';

const WS = 'ws-1';
const DOC = 'doc-1';

describe('ApiV1CellsController initialRoot', () => {
  let controller: ApiV1CellsController;
  let root: SpreadsheetDocument;
  let withDocument: jest.Mock;

  beforeEach(() => {
    // A seeded root, so the write bodies run as they would after Yorkie
    // applies `initialRoot` on a fresh doc.
    root = createSpreadsheetDocument();
    const doc = {
      getRoot: () => root,
      update: (fn: (r: SpreadsheetDocument) => void) => fn(root),
    };
    withDocument = jest.fn((_id: string, cb: (d: typeof doc) => unknown) =>
      Promise.resolve(cb(doc)),
    );
    const documentService = {
      getDocumentOrThrow: jest
        .fn()
        .mockResolvedValue({ id: DOC, workspaceId: WS, type: 'sheet' }),
    };
    controller = new ApiV1CellsController(
      { withDocument } as never,
      documentService as never,
    );
  });

  const lastInitialRoot = () =>
    withDocument.mock.calls.at(-1)?.[2]?.initialRoot as
      | SpreadsheetDocument
      | undefined;

  it('setCell seeds the canonical tab-1 root', async () => {
    await controller.setCell(WS, DOC, 'tab-1', 'A1', { value: '5' });
    expect(lastInitialRoot()?.tabOrder).toEqual(['tab-1']);
  });

  it('deleteCell seeds the canonical tab-1 root', async () => {
    await controller.deleteCell(WS, DOC, 'tab-1', 'A1');
    expect(lastInitialRoot()?.tabOrder).toEqual(['tab-1']);
  });

  it('batchUpdate seeds the canonical tab-1 root', async () => {
    await controller.batchUpdate(WS, DOC, 'tab-1', {
      cells: { A1: { value: '1' } },
    });
    expect(lastInitialRoot()?.tabOrder).toEqual(['tab-1']);
  });

  it('getCells (read) is readonly and does NOT seed', async () => {
    await controller.getCells(WS, DOC, 'tab-1', undefined);
    const opts = withDocument.mock.calls.at(-1)?.[2];
    expect(opts?.initialRoot).toBeUndefined();
    expect(opts?.syncMode).toBe('readonly');
  });

  it('setCell merges style into the cell and keeps the value', async () => {
    await controller.setCell(WS, DOC, 'tab-1', 'A1', {
      value: 'x',
      style: { b: true, bg: '#ffff00' },
    });
    const cell = getWorksheetCell(root.sheets['tab-1'], parseRef('A1'));
    expect(cell?.v).toBe('x');
    expect(cell?.s).toMatchObject({ b: true, bg: '#ffff00' });
  });

  it('setCell rejects an invalid style with 400 before opening the doc', async () => {
    await expect(
      controller.setCell(WS, DOC, 'tab-1', 'A1', { style: { al: 'middle' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(withDocument).not.toHaveBeenCalled();
  });

  it('batchUpdate applies per-cell style', async () => {
    await controller.batchUpdate(WS, DOC, 'tab-1', {
      cells: { A1: { value: '1', style: { i: true } } },
    });
    const cell = getWorksheetCell(root.sheets['tab-1'], parseRef('A1'));
    expect(cell?.s).toMatchObject({ i: true });
  });
});
