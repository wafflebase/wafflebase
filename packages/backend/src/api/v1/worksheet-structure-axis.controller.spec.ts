import { BadRequestException } from '@nestjs/common';
import yorkie, { Document as YorkieDocument } from '@yorkie-js/sdk';
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
const TAB = 'tab-1';

/**
 * Row/column edits run against a real (offline) `yorkie.Document`, not a plain
 * object: `doc.update` alone builds the CRDT and hands the engine the same
 * proxies production sees, which is the only place the axis-order splices and
 * the cell-key rewrites can be shown to work.
 */
describe('ApiV1WorksheetStructureController row/column edits', () => {
  let controller: ApiV1WorksheetStructureController;
  let doc: YorkieDocument<SpreadsheetDocument>;
  let documentService: { getDocumentOrThrow: jest.Mock };
  let withDocument: jest.Mock;

  const seed = (cells: Record<string, string>) => {
    doc.update((root) => {
      for (const [ref, value] of Object.entries(cells)) {
        writeWorksheetCell(root.sheets[TAB], parseRef(ref), { v: value });
      }
    });
  };

  const read = (ref: string) =>
    getWorksheetCell(doc.getRoot().sheets[TAB], parseRef(ref))?.v;

  beforeEach(() => {
    doc = new yorkie.Document<SpreadsheetDocument>(
      `sheet-structure-test-${process.hrtime.bigint()}`,
    );
    doc.update((root) => {
      const initial = createSpreadsheetDocument();
      root.tabs = initial.tabs;
      root.tabOrder = initial.tabOrder;
      root.sheets = initial.sheets;
    });
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

  it('insert pushes rows at and below the index down', async () => {
    seed({ A1: 'one', A2: 'two' });

    const res = await controller.insertAxis(WS, DOC, TAB, {
      axis: 'row',
      index: 2,
      count: 1,
    });

    expect(res).toEqual({ axis: 'row', index: 2, count: 1 });
    expect(read('A1')).toBe('one');
    expect(read('A2')).toBeUndefined();
    expect(read('A3')).toBe('two');
  });

  it('insert shifts a formula that points below the insertion', async () => {
    doc.update((root) => {
      writeWorksheetCell(root.sheets[TAB], parseRef('B1'), { f: '=A2' });
    });

    await controller.insertAxis(WS, DOC, TAB, {
      axis: 'row',
      index: 2,
      count: 1,
    });

    expect(getWorksheetCell(doc.getRoot().sheets[TAB], parseRef('B1'))?.f).toBe(
      '=A3',
    );
  });

  it('delete removes the rows and pulls the rest up', async () => {
    seed({ A1: 'one', A2: 'two', A3: 'three' });

    const res = await controller.deleteAxis(WS, DOC, TAB, {
      axis: 'row',
      index: 2,
      count: 1,
    });

    // The engine takes a negative count for a delete.
    expect(res).toEqual({ axis: 'row', index: 2, count: -1 });
    expect(read('A1')).toBe('one');
    expect(read('A2')).toBe('three');
    expect(read('A3')).toBeUndefined();
  });

  it('insert and delete work on columns too', async () => {
    seed({ A1: 'a', B1: 'b' });

    await controller.insertAxis(WS, DOC, TAB, {
      axis: 'column',
      index: 1,
      count: 1,
    });
    expect(read('A1')).toBeUndefined();
    expect(read('B1')).toBe('a');
    expect(read('C1')).toBe('b');

    await controller.deleteAxis(WS, DOC, TAB, {
      axis: 'column',
      index: 1,
      count: 1,
    });
    expect(read('A1')).toBe('a');
    expect(read('B1')).toBe('b');
  });

  it('move relocates a row block', async () => {
    seed({ A1: 'one', A2: 'two', A3: 'three' });

    const res = await controller.moveAxis(WS, DOC, TAB, {
      axis: 'row',
      srcIndex: 3,
      count: 1,
      dstIndex: 1,
    });

    expect(res).toEqual({ axis: 'row', srcIndex: 3, count: 1, dstIndex: 1 });
    expect(read('A1')).toBe('three');
    expect(read('A2')).toBe('one');
    expect(read('A3')).toBe('two');
  });

  it('rejects an invalid request before opening the document', async () => {
    await expect(
      controller.insertAxis(WS, DOC, TAB, { axis: 'row', index: 0, count: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.moveAxis(WS, DOC, TAB, {
        axis: 'row',
        srcIndex: 2,
        count: 3,
        dstIndex: 3,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(withDocument).not.toHaveBeenCalled();
  });

  it('rejects row/column edits on a non-sheet document', async () => {
    documentService.getDocumentOrThrow.mockResolvedValue({
      id: DOC,
      workspaceId: WS,
      type: 'doc',
    });
    await expect(
      controller.insertAxis(WS, DOC, TAB, { axis: 'row', index: 1, count: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
