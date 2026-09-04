import { BadRequestException, NotFoundException } from '@nestjs/common';
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
  let documentService: { getDocumentOrThrow: jest.Mock };

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
    documentService = {
      getDocumentOrThrow: jest
        .fn()
        .mockResolvedValue({ id: DOC, workspaceId: WS, type: 'sheet' }),
    };
    controller = new ApiV1CellsController(
      { withDocument } as never,
      documentService as never,
    );
  });

  const lastOptions = () => {
    const calls = withDocument.mock.calls as unknown[][];
    return calls.at(-1)?.[2] as
      | { initialRoot?: SpreadsheetDocument; syncMode?: string }
      | undefined;
  };

  const lastInitialRoot = () => lastOptions()?.initialRoot;

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
    expect(lastOptions()?.initialRoot).toBeUndefined();
    expect(lastOptions()?.syncMode).toBe('readonly');
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

  describe('non-sheet documents', () => {
    // A write verb seeds `initialRoot`, and Yorkie applies a seed to any
    // document that is still empty. `withDocument` defaults to the `sheet-`
    // docKey prefix, so a doc / slides / note / pdf / image / file document
    // used to be *written*: the seed created `sheets['tab-1']`, the cell
    // landed in it, and the request answered 200 — leaving a permanent,
    // invisible `sheet-<id>` document alongside the real `doc-<id>` one that
    // a later GET on the same id then read back, so nothing looked wrong.
    // Refusing before `withDocument` is what keeps that phantom from ever
    // being created.
    it.each(['doc', 'slides', 'note', 'pdf', 'image', 'file'] as const)(
      '400s a write against a %s document without opening a Yorkie document',
      async (type) => {
        documentService.getDocumentOrThrow.mockResolvedValue({
          id: DOC,
          workspaceId: WS,
          type,
        });

        await expect(
          controller.setCell(WS, DOC, 'tab-1', 'A1', { value: '5' }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(withDocument).not.toHaveBeenCalled();
      },
    );

    it.each(['setCell', 'deleteCell', 'batchUpdate'] as const)(
      '400s %s without opening a Yorkie document',
      async (op) => {
        documentService.getDocumentOrThrow.mockResolvedValue({
          id: DOC,
          workspaceId: WS,
          type: 'doc',
        });
        const call = {
          setCell: () =>
            controller.setCell(WS, DOC, 'tab-1', 'A1', { value: '5' }),
          deleteCell: () => controller.deleteCell(WS, DOC, 'tab-1', 'A1'),
          batchUpdate: () =>
            controller.batchUpdate(WS, DOC, 'tab-1', {
              cells: { A1: { value: '1' } },
            }),
        }[op];

        await expect(call()).rejects.toBeInstanceOf(BadRequestException);
        // No `withDocument` call at all: no attach, so no `sheet-<id>`
        // document is created and nothing is seeded.
        expect(withDocument).not.toHaveBeenCalled();
      },
    );

    // Reads used to be a deliberate exception: they create nothing, so a
    // non-sheet id fell through to `404 Tab not found` — the empty `sheet-<id>`
    // attach simply has no worksheet. But that is the same status a genuine
    // sheet returns for an unknown `tabId`, so a caller could not tell "this
    // document is not a sheet" from "that tab does not exist", and retried tab
    // ids that were never the problem. Reads now refuse the way the writes and
    // every sibling family do. Breaking change, documented in the Cells
    // section of packages/documentation/developers/rest-api.md.
    it.each(['getCells', 'getCell'] as const)(
      '%s on a non-sheet document 400s instead of 404 Tab not found',
      async (op) => {
        documentService.getDocumentOrThrow.mockResolvedValue({
          id: DOC,
          workspaceId: WS,
          type: 'doc',
        });

        const call = {
          getCells: () => controller.getCells(WS, DOC, 'tab-1', undefined),
          getCell: () => controller.getCell(WS, DOC, 'tab-1', 'A1'),
        }[op];

        const error = await call().then(
          () => null,
          (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(BadRequestException);
        expect(error).not.toBeInstanceOf(NotFoundException);
        expect((error as Error).message).toBe(
          `Cell reads are only available on sheet documents; "${DOC}" is a "doc" document.`,
        );
        // Refused before the attach, so a wrong-type read now costs no Yorkie
        // round-trip either — the same shape as the write guard.
        expect(withDocument).not.toHaveBeenCalled();
      },
    );

    it.each(['doc', 'slides', 'note', 'pdf', 'image', 'file'] as const)(
      '400s a read against a %s document',
      async (type) => {
        documentService.getDocumentOrThrow.mockResolvedValue({
          id: DOC,
          workspaceId: WS,
          type,
        });

        await expect(
          controller.getCells(WS, DOC, 'tab-1', undefined),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(withDocument).not.toHaveBeenCalled();
      },
    );

    // The refusal keys on the document's type, not on the attach coming back
    // empty — so an unknown tab on a genuine sheet is still `404 Tab not
    // found`, still readonly, still unseeded.
    it('still 404s an unknown tab on a genuine sheet, readonly and unseeded', async () => {
      const emptyDoc = { getRoot: () => ({}) as SpreadsheetDocument };
      withDocument.mockImplementation(
        (_id: string, cb: (d: typeof emptyDoc) => unknown) =>
          Promise.resolve(cb(emptyDoc)),
      );

      await expect(
        controller.getCells(WS, DOC, 'no-such-tab', undefined),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(lastOptions()?.initialRoot).toBeUndefined();
      expect(lastOptions()?.syncMode).toBe('readonly');
    });
  });
});
