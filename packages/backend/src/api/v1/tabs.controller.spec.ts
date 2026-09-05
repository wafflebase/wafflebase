import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { createSpreadsheetDocument } from '@wafflebase/sheets';
import type { SpreadsheetDocument } from '@wafflebase/sheets';
import { ApiV1TabsController } from './tabs.controller';

const WS = 'ws-1';
const DOC = 'doc-1';

describe('ApiV1TabsController create/rename', () => {
  let controller: ApiV1TabsController;
  let root: SpreadsheetDocument;
  let documentService: { getDocumentOrThrow: jest.Mock };
  let withDocument: jest.Mock;

  beforeEach(() => {
    root = createSpreadsheetDocument(); // { tab-1: "Sheet1" }
    // Fake Yorkie doc: getRoot/update both operate on the in-memory root, so
    // the controller mutations run exactly as they would inside doc.update.
    const doc = {
      getRoot: () => root,
      update: (fn: (r: SpreadsheetDocument) => void) => fn(root),
    };
    withDocument = jest.fn((_id: string, cb: (d: typeof doc) => unknown) =>
      Promise.resolve(cb(doc)),
    );
    const yorkieService = { withDocument };
    documentService = {
      getDocumentOrThrow: jest
        .fn()
        .mockResolvedValue({ id: DOC, workspaceId: WS, type: 'sheet' }),
    };
    controller = new ApiV1TabsController(
      yorkieService as never,
      documentService as never,
    );
  });

  describe('create', () => {
    it('adds tab metadata, order and an empty worksheet', async () => {
      const res = (await controller.create(WS, DOC, { name: 'History' })) as {
        id: string;
        name: string;
        type: string;
      };
      expect(res).toMatchObject({ name: 'History', type: 'sheet' });
      expect(root.tabOrder).toContain(res.id);
      expect(root.tabs[res.id]).toEqual({
        id: res.id,
        name: 'History',
        type: 'sheet',
      });
      expect(root.sheets[res.id]).toBeDefined();
    });

    it('defaults an omitted name to the next SheetN', async () => {
      const res = (await controller.create(WS, DOC, {})) as { name: string };
      expect(res.name).toBe('Sheet2');
    });

    it('rejects an unsupported tab type without mutating', async () => {
      await expect(
        controller.create(WS, DOC, { type: 'datasource' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(root.tabOrder).toEqual(['tab-1']);
    });
  });

  describe('rename', () => {
    it('renames an existing tab', async () => {
      const res = (await controller.rename(WS, DOC, 'tab-1', {
        name: '  Summary  ',
      })) as { id: string; name: string };
      expect(res).toEqual({ id: 'tab-1', name: 'Summary', type: 'sheet' });
      expect(root.tabs['tab-1'].name).toBe('Summary');
    });

    it('404s a missing tab', async () => {
      await expect(
        controller.rename(WS, DOC, 'tab-nope', { name: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('400s a blank name', async () => {
      await expect(
        controller.rename(WS, DOC, 'tab-1', { name: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(root.tabs['tab-1'].name).toBe('Sheet1');
    });

    it('409s a duplicate name', async () => {
      const created = (await controller.create(WS, DOC, {
        name: 'History',
      })) as {
        id: string;
      };
      await expect(
        controller.rename(WS, DOC, created.id, { name: 'Sheet1' }),
      ).rejects.toBeInstanceOf(ConflictException);
      // unchanged
      expect(root.tabs[created.id].name).toBe('History');
    });
  });

  describe('non-sheet documents', () => {
    // `withDocument` defaults to the `sheet-` docKey prefix, so a doc/slides
    // document would not open ITS Yorkie document — it would attach an empty
    // one under `sheet-<id>`. Reported as an empty tab list on `list`, and on
    // `create` as a 500 from `root.tabs[tabId]` AFTER that phantom existed.
    // Rejecting before `withDocument` is what keeps it from being created.
    beforeEach(() => {
      documentService.getDocumentOrThrow.mockResolvedValue({
        id: DOC,
        workspaceId: WS,
        type: 'doc',
      });
    });

    it.each(['list', 'create', 'rename'] as const)(
      '400s %s without opening a Yorkie document',
      async (op) => {
        const call = {
          list: () => controller.list(WS, DOC),
          create: () => controller.create(WS, DOC, { name: 'X' }),
          rename: () => controller.rename(WS, DOC, 'tab-1', { name: 'X' }),
        }[op];

        await expect(call()).rejects.toBeInstanceOf(BadRequestException);
        expect(withDocument).not.toHaveBeenCalled();
      },
    );
  });

  describe('initialRoot seeds a fresh, never-opened doc', () => {
    const lastInitialRoot = () =>
      withDocument.mock.calls.at(-1)?.[2]?.initialRoot as
        | SpreadsheetDocument
        | undefined;

    it('create seeds the canonical tab-1 root', async () => {
      await controller.create(WS, DOC, { name: 'X' });
      expect(lastInitialRoot()?.tabOrder).toEqual(['tab-1']);
    });

    it('rename seeds the canonical tab-1 root', async () => {
      await controller.rename(WS, DOC, 'tab-1', { name: 'X' });
      expect(lastInitialRoot()?.tabOrder).toEqual(['tab-1']);
    });

    it('list (read) is readonly and does NOT seed', async () => {
      await controller.list(WS, DOC);
      const opts = withDocument.mock.calls.at(-1)?.[2];
      expect(opts?.initialRoot).toBeUndefined();
      expect(opts?.syncMode).toBe('readonly');
    });
  });
});

/**
 * The delete / move / duplicate arms. `tab-ops.spec.ts` covers the pure
 * resolvers and appliers over plain objects; what is only reachable here is
 * the controller's own work — the 404/409 mapping, and the `unwrapJson`
 * proxy-detach that exists so a duplicated worksheet is stored as a grid
 * rather than as Yorkie's own JSON string.
 */
describe('ApiV1TabsController delete/move/duplicate', () => {
  let controller: ApiV1TabsController;
  let root: SpreadsheetDocument;
  let documentService: { getDocumentOrThrow: jest.Mock };
  let withDocument: jest.Mock;

  /** Add a second tab so the last-tab refusal is not in the way. */
  function addTab(name: string): string {
    const id = `tab-${name.toLowerCase()}`;
    root.tabs[id] = { id, name, type: 'sheet' };
    root.tabOrder.push(id);
    root.sheets[id] = createSpreadsheetDocument().sheets['tab-1'];
    return id;
  }

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
    controller = new ApiV1TabsController(
      { withDocument } as never,
      documentService as never,
    );
  });

  describe('remove', () => {
    it('deletes the metadata, order entry and worksheet', async () => {
      const second = addTab('History');
      expect(await controller.remove(WS, DOC, second)).toEqual({
        id: second,
        name: 'History',
        deleted: true,
      });
      expect(root.tabs[second]).toBeUndefined();
      expect(root.sheets[second]).toBeUndefined();
      expect(root.tabOrder).toEqual(['tab-1']);
    });

    it('404s an unknown tab', async () => {
      await expect(controller.remove(WS, DOC, 'nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('409s the last remaining tab', async () => {
      await expect(controller.remove(WS, DOC, 'tab-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(root.tabOrder).toEqual(['tab-1']);
    });

    it('409s a tab a pivot output tab reads from, naming the dependents', async () => {
      const output = addTab('Pivot');
      root.sheets[output].pivotTable = {
        sourceTabId: 'tab-1',
      } as never;
      await expect(
        controller.remove(WS, DOC, 'tab-1'),
      ).rejects.toMatchObject({
        message: expect.stringContaining(output),
      });
      expect(root.tabs['tab-1']).toBeDefined();
    });

    it('refuses a non-sheet document before opening Yorkie', async () => {
      documentService.getDocumentOrThrow.mockResolvedValue({
        id: DOC,
        workspaceId: WS,
        type: 'slides',
      });
      await expect(controller.remove(WS, DOC, 'tab-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(withDocument).not.toHaveBeenCalled();
    });
  });

  describe('move', () => {
    it('reorders tabOrder and reports the 1-based landing position', async () => {
      const second = addTab('History');
      expect(await controller.move(WS, DOC, second, { index: 1 })).toEqual({
        id: second,
        index: 1,
      });
      expect(root.tabOrder).toEqual([second, 'tab-1']);
    });

    it('clamps a position past the end', async () => {
      const second = addTab('History');
      expect(await controller.move(WS, DOC, 'tab-1', { index: 99 })).toEqual({
        id: 'tab-1',
        index: 2,
      });
      expect(root.tabOrder).toEqual([second, 'tab-1']);
    });

    it('400s a non-positive or non-integer index without opening Yorkie', async () => {
      for (const index of [0, -1, 1.5, '2', undefined]) {
        await expect(
          controller.move(WS, DOC, 'tab-1', { index }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(withDocument).not.toHaveBeenCalled();
    });

    it('404s an unknown tab', async () => {
      await expect(
        controller.move(WS, DOC, 'nope', { index: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('duplicate', () => {
    it('copies the grid under a new id and a uniqued name', async () => {
      root.sheets['tab-1'].cells = { '1:1': { v: 'kept' } } as never;

      const res = (await controller.duplicate(WS, DOC, 'tab-1', {})) as {
        id: string;
        name: string;
        type: string;
      };

      expect(res.id).not.toBe('tab-1');
      expect(res.name).toBe('Sheet1 (copy)');
      expect(root.tabOrder).toEqual(['tab-1', res.id]);
      expect(root.sheets[res.id].cells).toEqual({ '1:1': { v: 'kept' } });
      // A copy, not a shared reference.
      expect(root.sheets[res.id]).not.toBe(root.sheets['tab-1']);
    });

    it('detaches the source worksheet through the proxy’s own toJSON', async () => {
      // A Yorkie worksheet is a proxy whose `toJSON()` answers a JSON
      // *string*; assigning it straight into a new key would store that
      // string instead of a grid.
      const plain = root.sheets['tab-1'];
      const proxied = {
        ...plain,
        toJSON: () => JSON.stringify({ ...plain, cells: { '1:1': { v: 1 } } }),
      };
      root.sheets['tab-1'] = proxied as never;

      const res = (await controller.duplicate(WS, DOC, 'tab-1', {})) as {
        id: string;
      };

      expect(root.sheets[res.id].cells).toEqual({ '1:1': { v: 1 } });
      expect(typeof root.sheets[res.id]).toBe('object');
    });

    it('survives a grid holding an unescaped control character', async () => {
      // Yorkie's raw JSON path leaves control characters inside string
      // values unescaped, so a multi-line cell made bare `JSON.parse` throw
      // — a 500 on a tab that duplicates fine in the editor.
      const plain = root.sheets['tab-1'];
      const raw = `{"cells":{"1:1":{"v":"one\ntwo"}},"rowOrder":[],"colOrder":[]}`;
      root.sheets['tab-1'] = { ...plain, toJSON: () => raw } as never;

      const res = (await controller.duplicate(WS, DOC, 'tab-1', {})) as {
        id: string;
      };

      expect(root.sheets[res.id].cells).toEqual({ '1:1': { v: 'one\ntwo' } });
    });

    it('honours a requested name and uniques a collision', async () => {
      addTab('Backup');
      const res = (await controller.duplicate(WS, DOC, 'tab-1', {
        name: 'Backup',
      })) as { name: string };
      expect(res.name).toBe('Backup (2)');
    });

    it('404s an unknown tab', async () => {
      await expect(
        controller.duplicate(WS, DOC, 'nope', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('400s a tab with no worksheet (datasource / lakehouse)', async () => {
      root.tabs['ds-1'] = { id: 'ds-1', name: 'DS', type: 'datasource' };
      root.tabOrder.push('ds-1');
      await expect(
        controller.duplicate(WS, DOC, 'ds-1', {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
