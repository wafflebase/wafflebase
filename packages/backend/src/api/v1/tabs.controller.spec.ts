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

  beforeEach(() => {
    root = createSpreadsheetDocument(); // { tab-1: "Sheet1" }
    // Fake Yorkie doc: getRoot/update both operate on the in-memory root, so
    // the controller mutations run exactly as they would inside doc.update.
    const doc = {
      getRoot: () => root,
      update: (fn: (r: SpreadsheetDocument) => void) => fn(root),
    };
    const yorkieService = {
      withDocument: jest.fn(async (_id: string, cb: (d: typeof doc) => unknown) =>
        cb(doc),
      ),
    };
    documentService = {
      getDocumentOrThrow: jest.fn().mockResolvedValue({ id: DOC, workspaceId: WS }),
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
      const created = (await controller.create(WS, DOC, { name: 'History' })) as {
        id: string;
      };
      await expect(
        controller.rename(WS, DOC, created.id, { name: 'Sheet1' }),
      ).rejects.toBeInstanceOf(ConflictException);
      // unchanged
      expect(root.tabs[created.id].name).toBe('History');
    });
  });
});
