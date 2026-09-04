import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createSpreadsheetDocument } from '@wafflebase/sheets';
import type { SpreadsheetDocument } from '@wafflebase/sheets';
import { ApiV1CommentsController } from './comments.controller';
import type { AuthenticatedRequest } from '../../auth/auth.types';

const WS = 'ws-1';
const DOC = 'doc-1';

const REQ = {
  user: { id: 7, username: 'ada', photo: 'https://example.com/a.png' },
} as unknown as AuthenticatedRequest;

/**
 * Fake Yorkie: `getRoot`/`update` both run against the in-memory root, so the
 * controller's mutations execute exactly as they would inside `doc.update`.
 */
function harness(type: string, root: Record<string, unknown>) {
  const doc = {
    getRoot: () => root,
    update: (fn: (r: Record<string, unknown>) => void) => fn(root),
  };
  const withDocument = jest.fn(
    (_id: string, cb: (d: typeof doc) => unknown, _options?: unknown) =>
      Promise.resolve(cb(doc)),
  );
  const documentService = {
    getDocumentOrThrow: jest
      .fn()
      .mockResolvedValue({ id: DOC, workspaceId: WS, type }),
  };
  const controller = new ApiV1CommentsController(
    documentService as never,
    { withDocument } as never,
  );
  return { controller, withDocument, documentService };
}

/** A one-tab workbook whose A1..B2 axes are materialized. */
function sheetRoot(): SpreadsheetDocument {
  const root = createSpreadsheetDocument();
  const ws = root.sheets['tab-1'];
  ws.rowOrder = ['r1', 'r2'];
  ws.colOrder = ['c1', 'c2'];
  return root;
}

describe('ApiV1CommentsController on a sheet', () => {
  it('anchors a new thread on the cell reference’s stable axis ids', async () => {
    const root = sheetRoot();
    const { controller } = harness('sheet', root as never);

    const thread = await controller.createThread(
      WS,
      DOC,
      { body: '  check this  ', tabId: 'tab-1', ref: 'B2' },
      REQ,
    );

    expect(thread.anchor).toMatchObject({
      kind: 'sheet-cell',
      tabId: 'tab-1',
      rowId: 'r2',
      colId: 'c2',
      // Reported back as the A1 position, derived from the ids.
      ref: 'B2',
    });
    expect(thread.comments[0].body).toBe('check this');
    expect(thread.comments[0].author).toEqual({
      userId: '7',
      username: 'ada',
      photo: 'https://example.com/a.png',
    });
    expect(Object.keys(root.sheets['tab-1'].comments ?? {})).toEqual([
      thread.id,
    ]);
  });

  it('refuses a cell whose row or column has no id yet', async () => {
    const { controller } = harness('sheet', sheetRoot() as never);
    await expect(
      controller.createThread(
        WS,
        DOC,
        { body: 'hi', tabId: 'tab-1', ref: 'Z99' },
        REQ,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an empty body', async () => {
    const { controller } = harness('sheet', sheetRoot() as never);
    await expect(
      controller.createThread(
        WS,
        DOC,
        { body: '   ', tabId: 'tab-1', ref: 'A1' },
        REQ,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists threads across every tab', async () => {
    const root = sheetRoot();
    const { controller } = harness('sheet', root as never);
    const first = await controller.createThread(
      WS,
      DOC,
      { body: 'one', tabId: 'tab-1', ref: 'A1' },
      REQ,
    );

    const { threads } = await controller.list(WS, DOC);
    expect(threads.map((t) => t.id)).toEqual([first.id]);
    expect(threads[0].createdAt).toEqual(expect.any(Number));
  });

  it('replies, resolves and reopens a thread found by id alone', async () => {
    const root = sheetRoot();
    const { controller } = harness('sheet', root as never);
    const thread = await controller.createThread(
      WS,
      DOC,
      { body: 'one', tabId: 'tab-1', ref: 'A1' },
      REQ,
    );

    const reply = await controller.reply(
      WS,
      DOC,
      thread.id,
      { body: 'two' },
      REQ,
    );
    expect(reply.threadId).toBe(thread.id);

    const resolved = await controller.setResolved(
      WS,
      DOC,
      thread.id,
      { resolved: true },
      REQ,
    );
    expect(resolved.resolved).toBe(true);
    expect(resolved.resolvedBy).toMatchObject({ username: 'ada' });
    expect(resolved.comments).toHaveLength(2);

    const reopened = await controller.setResolved(
      WS,
      DOC,
      thread.id,
      { resolved: false },
      REQ,
    );
    expect(reopened.resolved).toBe(false);
    expect(reopened.resolvedAt).toBeUndefined();
  });

  it('404s a reply to a thread that does not exist', async () => {
    const { controller } = harness('sheet', sheetRoot() as never);
    await expect(
      controller.reply(WS, DOC, 'nope', { body: 'hi' }, REQ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reports that deleting the opening comment deleted the thread', async () => {
    const root = sheetRoot();
    const { controller } = harness('sheet', root as never);
    const thread = await controller.createThread(
      WS,
      DOC,
      { body: 'one', tabId: 'tab-1', ref: 'A1' },
      REQ,
    );

    const res = await controller.deleteComment(
      WS,
      DOC,
      thread.id,
      thread.comments[0].id,
    );
    expect(res.deleted).toBe('thread');
    expect(root.sheets['tab-1'].comments).toEqual({});
  });

  it('deletes a whole thread', async () => {
    const root = sheetRoot();
    const { controller } = harness('sheet', root as never);
    const thread = await controller.createThread(
      WS,
      DOC,
      { body: 'one', tabId: 'tab-1', ref: 'A1' },
      REQ,
    );

    expect(await controller.deleteThread(WS, DOC, thread.id)).toEqual({
      id: thread.id,
      deleted: 'thread',
    });
    await expect(
      controller.deleteThread(WS, DOC, thread.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ApiV1CommentsController on a PDF', () => {
  it('anchors a thread on a page region in 0..1 units', async () => {
    const root: Record<string, unknown> = {};
    const { controller, withDocument } = harness('pdf', root);

    const thread = await controller.createThread(
      WS,
      DOC,
      { body: 'illegible', pageIndex: 2, rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } },
      REQ,
    );

    expect(thread.anchor).toEqual({
      kind: 'pdf-region',
      pageIndex: 2,
      rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    });
    // The PDF's own Yorkie document, not the sheet default.
    expect(withDocument.mock.calls[0][2]).toMatchObject({
      docKeyPrefix: 'pdf-',
    });
    expect(Object.keys(root.comments as object)).toEqual([thread.id]);
  });

  it('refuses a rectangle outside the page', async () => {
    const { controller } = harness('pdf', {});
    await expect(
      controller.createThread(
        WS,
        DOC,
        { body: 'x', pageIndex: 0, rect: { x: 0, y: 0, w: 2, h: 1 } },
        REQ,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a negative page index', async () => {
    const { controller } = harness('pdf', {});
    await expect(
      controller.createThread(
        WS,
        DOC,
        { body: 'x', pageIndex: -1, rect: { x: 0, y: 0, w: 1, h: 1 } },
        REQ,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ApiV1CommentsController on other document types', () => {
  it('refuses to create a docs thread and says why', async () => {
    const { controller } = harness('doc', {});
    await expect(
      controller.createThread(WS, DOC, { body: 'hi' }, REQ),
    ).rejects.toThrow(/editor session/);
  });

  it('still lists, replies to and resolves docs threads', async () => {
    const root: Record<string, unknown> = {
      comments: {
        t1: {
          id: 't1',
          anchor: { kind: 'docs-range', blockId: 'b1' },
          comments: [
            {
              id: 'c1',
              author: { userId: '9', username: 'grace' },
              body: 'typo',
              createdAt: 5,
            },
          ],
          resolved: false,
          createdAt: 5,
        },
      },
    };
    const { controller } = harness('doc', root);

    expect((await controller.list(WS, DOC)).threads.map((t) => t.id)).toEqual([
      't1',
    ]);
    await controller.reply(WS, DOC, 't1', { body: 'fixed' }, REQ);
    const resolved = await controller.setResolved(
      WS,
      DOC,
      't1',
      { resolved: true },
      REQ,
    );
    expect(resolved.comments.map((c) => c.body)).toEqual(['typo', 'fixed']);
    expect(resolved.resolved).toBe(true);
  });

  it('refuses a document type that stores no comments', async () => {
    const { controller } = harness('slides', {});
    await expect(controller.list(WS, DOC)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
