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

    // Reads are a deliberate exception, kept as-is: they attach readonly with
    // no seed, so they create nothing, and the documented contract for a
    // non-sheet id is `404 Tab not found`. Changing that is an API-contract
    // change (see packages/documentation/developers/rest-api.md), so it is
    // pinned here rather than altered.
    it.each(['getCells', 'getCell'] as const)(
      '%s on a non-sheet document still 404s Tab not found, readonly and unseeded',
      async (op) => {
        documentService.getDocumentOrThrow.mockResolvedValue({
          id: DOC,
          workspaceId: WS,
          type: 'doc',
        });
        // A `doc-` document opened under the `sheet-` key is empty: no
        // `sheets` at all.
        const emptyDoc = { getRoot: () => ({}) as SpreadsheetDocument };
        withDocument.mockImplementation(
          (_id: string, cb: (d: typeof emptyDoc) => unknown) =>
            Promise.resolve(cb(emptyDoc)),
        );

        const call = {
          getCells: () => controller.getCells(WS, DOC, 'tab-1', undefined),
          getCell: () => controller.getCell(WS, DOC, 'tab-1', 'A1'),
        }[op];

        await expect(call()).rejects.toBeInstanceOf(NotFoundException);
        expect(lastOptions()?.initialRoot).toBeUndefined();
        expect(lastOptions()?.syncMode).toBe('readonly');
      },
    );
  });
});
