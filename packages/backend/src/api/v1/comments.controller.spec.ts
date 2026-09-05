import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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
 * How an **API key** caller arrives: `api-key.strategy.ts` returns only
 * `{ id, workspaceId, scopes, isApiKey }`, with no username and no photo.
 */
const API_KEY_REQ = {
  user: { id: 7, workspaceId: WS, scopes: ['read', 'write'], isApiKey: true },
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
  const userService = {
    user: jest
      .fn()
      .mockResolvedValue({ id: 7, username: 'ada-from-db', photo: null }),
  };
  const notificationService = {
    createFromComment: jest.fn().mockResolvedValue({ created: 1 }),
  };
  const controller = new ApiV1CommentsController(
    documentService as never,
    { withDocument } as never,
    userService as never,
    notificationService as never,
  );
  return {
    controller,
    withDocument,
    documentService,
    userService,
    notificationService,
  };
}

/**
 * A two-tab workbook whose A1..B2 axes are materialized on both tabs, so the
 * cross-tab thread walk (`tabIdOfThread`, `list`'s `tabOrder` loop) is
 * actually exercised rather than passing on a single-tab fixture.
 */
function sheetRoot(): SpreadsheetDocument {
  const root = createSpreadsheetDocument();
  const [firstTab] = root.tabOrder;
  const second = structuredClone(root.sheets[firstTab]);
  root.sheets['tab-2'] = second;
  root.tabs['tab-2'] = { ...root.tabs[firstTab], name: 'Sheet2' };
  root.tabOrder.push('tab-2');
  for (const tabId of root.tabOrder) {
    const ws = root.sheets[tabId];
    ws.rowOrder = ['r1', 'r2'];
    ws.colOrder = ['c1', 'c2'];
  }
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
    // The body is stored verbatim, matching `assertNonEmpty` in
    // `@wafflebase/sheets` — the same rule the editor writes under.
    expect(thread.comments[0].body).toBe('  check this  ');
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
    const second = await controller.createThread(
      WS,
      DOC,
      { body: 'two', tabId: 'tab-2', ref: 'B2' },
      REQ,
    );

    const { threads } = await controller.list(WS, DOC);
    // Both tabs are walked, in `tabOrder`, and each thread's `ref` is
    // resolved against the worksheet it actually lives on.
    expect(threads.map((t) => t.id)).toEqual([first.id, second.id]);
    expect(threads.map((t) => t.anchor.tabId)).toEqual(['tab-1', 'tab-2']);
    expect(threads.map((t) => t.anchor.ref)).toEqual(['A1', 'B2']);
    expect(threads[0].createdAt).toEqual(expect.any(Number));
  });

  it('resolves the ref when the axis orders are Yorkie array proxies', async () => {
    // A Yorkie array proxy is iterable and has a numeric `length`, but it is
    // not an array — handing one straight to `cellAnchorToSref`, which does
    // `rowOrder.indexOf(...)`, is not the lookup the engine expects. Both
    // editor call sites detach with `Array.from` first; so does `withSref`.
    const root = sheetRoot();
    const { controller } = harness('sheet', root as never);
    await controller.createThread(
      WS,
      DOC,
      { body: 'one', tabId: 'tab-1', ref: 'B2' },
      REQ,
    );
    const arrayProxy = (items: string[]) => ({
      length: items.length,
      ...Object.fromEntries(items.map((v, i) => [i, v])),
      [Symbol.iterator]: () => items[Symbol.iterator](),
    });
    for (const tabId of root.tabOrder) {
      const ws = root.sheets[tabId];
      ws.rowOrder = arrayProxy(['r1', 'r2']) as never;
      ws.colOrder = arrayProxy(['c1', 'c2']) as never;
    }

    const { threads } = await controller.list(WS, DOC);
    expect(threads.map((t) => t.anchor.ref)).toEqual(['B2']);
  });

  it('finds a thread on a non-first tab by id alone', async () => {
    // `tabIdOfThread` is what makes the tab absent from the route path; a
    // single-tab fixture would pass whether or not it walked past tab one.
    const root = sheetRoot();
    const { controller } = harness('sheet', root as never);
    const thread = await controller.createThread(
      WS,
      DOC,
      { body: 'on the second tab', tabId: 'tab-2', ref: 'A1' },
      REQ,
    );

    await controller.reply(WS, DOC, thread.id, { body: 'seen' }, REQ);
    const resolved = await controller.setResolved(
      WS,
      DOC,
      thread.id,
      { resolved: true },
      REQ,
    );

    expect(resolved.comments.map((c) => c.body)).toEqual([
      'on the second tab',
      'seen',
    ]);
    expect(Object.keys(root.sheets['tab-1'].comments ?? {})).toEqual([]);
    expect(Object.keys(root.sheets['tab-2'].comments ?? {})).toEqual([
      thread.id,
    ]);

    expect(await controller.deleteThread(WS, DOC, thread.id, REQ)).toEqual({
      id: thread.id,
      deleted: 'thread',
    });
    expect(root.sheets['tab-2'].comments).toEqual({});
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
    // `buildReply` stores `createdAt` as a Long (a JS `bigint`), which
    // `res.json()` refuses outright — so the response has to carry a plain
    // number or every reply is a 500. Assert the whole payload survives
    // serialisation, not just its type.
    expect(typeof reply.comment.createdAt).toBe('number');
    expect(() => JSON.stringify(reply)).not.toThrow();
    expect(JSON.parse(JSON.stringify(reply)).comment).toMatchObject({
      id: reply.comment.id,
      body: 'two',
      createdAt: reply.comment.createdAt,
    });

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
      REQ,
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

    expect(await controller.deleteThread(WS, DOC, thread.id, REQ)).toEqual({
      id: thread.id,
      deleted: 'thread',
    });
    await expect(
      controller.deleteThread(WS, DOC, thread.id, REQ),
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

describe('ApiV1CommentsController author identity', () => {
  it('resolves the username from the User row for an API-key caller', async () => {
    // `api-key.strategy.ts` puts no username on the request, so reading
    // `req.user.username` straight off it stored `username: undefined` for
    // every agent-authored comment.
    const { controller, userService } = harness('sheet', sheetRoot() as never);

    const thread = await controller.createThread(
      WS,
      DOC,
      { body: 'from an agent', tabId: 'tab-1', ref: 'A1' },
      API_KEY_REQ,
    );

    expect(userService.user).toHaveBeenCalledWith({ id: 7 });
    expect(thread.comments[0].author).toEqual({
      userId: '7',
      username: 'ada-from-db',
    });
  });

  it('does not hit the database for a JWT caller', async () => {
    const { controller, userService } = harness('sheet', sheetRoot() as never);
    await controller.createThread(
      WS,
      DOC,
      { body: 'from a browser', tabId: 'tab-1', ref: 'A1' },
      REQ,
    );
    expect(userService.user).not.toHaveBeenCalled();
  });

  it('refuses the write when the key’s creator no longer exists', async () => {
    const { controller, userService } = harness('sheet', sheetRoot() as never);
    userService.user.mockResolvedValue(null);
    await expect(
      controller.createThread(
        WS,
        DOC,
        { body: 'orphan', tabId: 'tab-1', ref: 'A1' },
        API_KEY_REQ,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ApiV1CommentsController edit / delete authorship', () => {
  /** A second workspace member, holding their own key. */
  const PEER = {
    user: { id: 9, username: 'grace' },
  } as unknown as AuthenticatedRequest;

  async function seededThread() {
    const root = sheetRoot();
    const harnessed = harness('sheet', root as never);
    const thread = await harnessed.controller.createThread(
      WS,
      DOC,
      { body: 'mine', tabId: 'tab-1', ref: 'A1' },
      REQ,
    );
    const reply = await harnessed.controller.reply(
      WS,
      DOC,
      thread.id,
      { body: 'theirs' },
      PEER,
    );
    return { ...harnessed, root, thread, replyId: reply.comment.id };
  }

  it('refuses to delete a comment the caller did not write', async () => {
    const { controller, root, thread, replyId } = await seededThread();
    await expect(
      controller.deleteComment(WS, DOC, thread.id, replyId, REQ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // Nothing was written: the check runs before the CRDT transaction opens.
    expect(root.sheets['tab-1'].comments![thread.id].comments).toHaveLength(2);
  });

  it('lets the author delete their own reply', async () => {
    const { controller, thread, replyId } = await seededThread();
    expect(
      await controller.deleteComment(WS, DOC, thread.id, replyId, PEER),
    ).toEqual({ id: replyId, threadId: thread.id, deleted: 'comment' });
  });

  it('refuses to delete a thread the caller did not open', async () => {
    const { controller, root, thread } = await seededThread();
    await expect(
      controller.deleteThread(WS, DOC, thread.id, PEER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(root.sheets['tab-1'].comments![thread.id]).toBeDefined();
  });

  it('edits a comment body and stamps editedAt, author only', async () => {
    const { controller, root, thread } = await seededThread();
    const commentId = thread.comments[0].id;

    await expect(
      controller.editComment(WS, DOC, thread.id, commentId, { body: 'no' }, PEER),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const edited = await controller.editComment(
      WS,
      DOC,
      thread.id,
      commentId,
      { body: 'mine, revised' },
      REQ,
    );
    expect(edited.comment).toMatchObject({ id: commentId, body: 'mine, revised' });
    expect(typeof edited.comment!.editedAt).toBe('number');
    // Written onto the stored comment, not just reported back.
    expect(
      root.sheets['tab-1'].comments![thread.id].comments[0].body,
    ).toBe('mine, revised');
  });

  it('refuses an empty edit body', async () => {
    const { controller, thread } = await seededThread();
    await expect(
      controller.editComment(
        WS,
        DOC,
        thread.id,
        thread.comments[0].id,
        { body: '  ' },
        REQ,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe.each([
  ['doc', 'doc-'],
  ['pdf', 'pdf-'],
])(
  'ApiV1CommentsController edit / delete authorship on a %s',
  (type, docKeyPrefix) => {
    /**
     * The flat-root branch of `mutateMap` — `root.comments`, no tab walk — is a
     * separate code path from the sheet one, including its own
     * `authorize?.(doc.getRoot().comments)` call. A `doc` root additionally
     * cannot be seeded through `createThread` (it refuses, for want of a tree
     * anchor), so the fixture is written the way an editor session would have
     * left it: an opening comment by the caller, a reply by a peer.
     */
    const PEER = {
      user: { id: 9, username: 'grace' },
    } as unknown as AuthenticatedRequest;

    function flatRoot(): Record<string, unknown> {
      return {
        comments: {
          t1: {
            id: 't1',
            anchor:
              type === 'pdf'
                ? { kind: 'pdf-region', pageIndex: 0, rect: { x: 0, y: 0, w: 1, h: 1 } }
                : { kind: 'docs-range', blockId: 'b1' },
            comments: [
              {
                id: 'c1',
                author: { userId: '7', username: 'ada' },
                body: 'mine',
                createdAt: 5,
              },
              {
                id: 'c2',
                author: { userId: '9', username: 'grace' },
                body: 'theirs',
                createdAt: 6,
              },
            ],
            resolved: false,
            createdAt: 5,
          },
        },
      };
    }

    const threadsOf = (root: Record<string, unknown>) =>
      root.comments as Record<string, { comments: { id: string; body: string }[] }>;

    it('edits a comment body and stamps editedAt, author only', async () => {
      const root = flatRoot();
      const { controller, withDocument } = harness(type, root);

      await expect(
        controller.editComment(WS, DOC, 't1', 'c1', { body: 'no' }, PEER),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(threadsOf(root).t1.comments[0].body).toBe('mine');

      const edited = await controller.editComment(
        WS,
        DOC,
        't1',
        'c1',
        { body: 'mine, revised' },
        REQ,
      );
      expect(edited.comment).toMatchObject({ id: 'c1', body: 'mine, revised' });
      expect(typeof edited.comment!.editedAt).toBe('number');
      // Written onto the stored comment in the type's own Yorkie document.
      expect(threadsOf(root).t1.comments[0].body).toBe('mine, revised');
      expect(withDocument.mock.calls[0][2]).toMatchObject({ docKeyPrefix });
    });

    it('refuses an empty edit body', async () => {
      const { controller } = harness(type, flatRoot());
      await expect(
        controller.editComment(WS, DOC, 't1', 'c1', { body: '  ' }, REQ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to delete a comment the caller did not write', async () => {
      const root = flatRoot();
      const { controller } = harness(type, root);

      await expect(
        controller.deleteComment(WS, DOC, 't1', 'c2', REQ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      // Nothing was written: the check runs before the CRDT transaction opens.
      expect(threadsOf(root).t1.comments).toHaveLength(2);
    });

    it('lets the author delete their own reply', async () => {
      const root = flatRoot();
      const { controller } = harness(type, root);

      expect(await controller.deleteComment(WS, DOC, 't1', 'c2', PEER)).toEqual({
        id: 'c2',
        threadId: 't1',
        deleted: 'comment',
      });
      expect(threadsOf(root).t1.comments.map((c) => c.id)).toEqual(['c1']);
    });

    it('reports that deleting the opening comment deleted the thread', async () => {
      const root = flatRoot();
      const { controller } = harness(type, root);

      const res = await controller.deleteComment(WS, DOC, 't1', 'c1', REQ);
      expect(res.deleted).toBe('thread');
      expect(threadsOf(root)).toEqual({});
    });

    it('refuses to delete a thread the caller did not open', async () => {
      const root = flatRoot();
      const { controller } = harness(type, root);

      await expect(
        controller.deleteThread(WS, DOC, 't1', PEER),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(threadsOf(root).t1).toBeDefined();
    });

    it('lets the thread’s opener delete it', async () => {
      const root = flatRoot();
      const { controller } = harness(type, root);

      expect(await controller.deleteThread(WS, DOC, 't1', REQ)).toEqual({
        id: 't1',
        deleted: 'thread',
      });
      expect(threadsOf(root)).toEqual({});
      await expect(
        controller.deleteThread(WS, DOC, 't1', REQ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s an edit or a delete of a thread that does not exist', async () => {
      const { controller } = harness(type, flatRoot());
      await expect(
        controller.editComment(WS, DOC, 'nope', 'c1', { body: 'hi' }, REQ),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        controller.deleteComment(WS, DOC, 'nope', 'c1', REQ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  },
);

describe('ApiV1CommentsController notifications', () => {
  const mention = (id: number) => `@[peer](${id})`;

  it('reports a mention in a new thread', async () => {
    const { controller, notificationService } = harness(
      'sheet',
      sheetRoot() as never,
    );
    const body = `look at this ${mention(9)}`;

    const thread = await controller.createThread(
      WS,
      DOC,
      { body, tabId: 'tab-1', ref: 'A1' },
      REQ,
    );

    expect(notificationService.createFromComment).toHaveBeenCalledWith(7, {
      type: 'comment_mention',
      documentId: DOC,
      threadId: thread.id,
      commentId: thread.comments[0].id,
      recipientUserIds: [9],
      // Flattened through the shared planner, so a raw `@[peer](9)` token
      // never reaches an inbox — the same excerpt the editor would report.
      preview: 'look at this @peer',
    });
  });

  it('reports a reply to the thread’s earlier participants', async () => {
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
    const { controller, notificationService } = harness('doc', root);

    await controller.reply(WS, DOC, 't1', { body: 'fixed' }, REQ);

    expect(notificationService.createFromComment).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        type: 'comment_reply',
        threadId: 't1',
        recipientUserIds: [9],
      }),
    );
  });

  it('notifies a mentioned participant once, not twice', async () => {
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
    const { controller, notificationService } = harness('doc', root);

    await controller.reply(WS, DOC, 't1', { body: mention(9) }, REQ);

    const types = notificationService.createFromComment.mock.calls.map(
      (call) => (call[1] as { type: string }).type,
    );
    expect(types).toEqual(['comment_mention']);
  });

  it('reports a resolve, and nothing on a reopen', async () => {
    const root = sheetRoot();
    const { controller, notificationService } = harness('sheet', root as never);
    const thread = await controller.createThread(
      WS,
      DOC,
      { body: 'one', tabId: 'tab-1', ref: 'A1' },
      { user: { id: 9, username: 'grace' } } as unknown as AuthenticatedRequest,
    );
    notificationService.createFromComment.mockClear();

    await controller.setResolved(WS, DOC, thread.id, { resolved: true }, REQ);
    expect(notificationService.createFromComment).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        type: 'thread_resolved',
        threadId: thread.id,
        recipientUserIds: [9],
      }),
    );

    notificationService.createFromComment.mockClear();
    await controller.setResolved(WS, DOC, thread.id, { resolved: false }, REQ);
    expect(notificationService.createFromComment).not.toHaveBeenCalled();
  });

  it('never notifies the actor about their own comment', async () => {
    const { controller, notificationService } = harness(
      'sheet',
      sheetRoot() as never,
    );
    await controller.createThread(
      WS,
      DOC,
      { body: `note to self ${mention(7)}`, tabId: 'tab-1', ref: 'A1' },
      REQ,
    );
    expect(notificationService.createFromComment).not.toHaveBeenCalled();
  });

  it('swallows a notification failure — the comment is already committed', async () => {
    const root = sheetRoot();
    const { controller, notificationService } = harness('sheet', root as never);
    notificationService.createFromComment.mockRejectedValue(
      new Error('database down'),
    );

    const thread = await controller.createThread(
      WS,
      DOC,
      { body: `hi ${mention(9)}`, tabId: 'tab-1', ref: 'A1' },
      REQ,
    );

    expect(Object.keys(root.sheets['tab-1'].comments ?? {})).toEqual([
      thread.id,
    ]);
  });
});
