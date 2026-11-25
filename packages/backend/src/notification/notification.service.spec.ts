import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { NotificationHub } from './notification-hub';
import { NotificationService } from './notification.service';

const WORKSPACE = 'ws-1';
const DOCUMENT = 'doc-1';

function createMockPrisma() {
  return {
    document: {
      findUnique: jest.fn(),
    },
    workspaceMember: {
      findMany: jest.fn(),
    },
    chatChannel: {
      findUnique: jest.fn(),
    },
    chatChannelMember: {
      findMany: jest.fn(),
    },
    chatMessage: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    notification: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
}

/** Rows returned by the membership lookup, in the shape the service reads. */
function members(...userIds: number[]) {
  return userIds.map((userId) => ({ userId, role: 'member' }));
}

function commentDto(over: Partial<Record<string, unknown>> = {}) {
  return {
    type: 'comment_mention',
    documentId: DOCUMENT,
    threadId: 'thread-1',
    commentId: 'comment-1',
    recipientUserIds: [2],
    preview: 'hello',
    ...over,
  } as never;
}

describe('NotificationService', () => {
  let service: NotificationService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let hub: NotificationHub;

  beforeEach(() => {
    prisma = createMockPrisma();
    hub = new NotificationHub();
    service = new NotificationService(prisma as unknown as PrismaService, hub);
    prisma.document.findUnique.mockResolvedValue({
      id: DOCUMENT,
      workspaceId: WORKSPACE,
    });
    prisma.workspaceMember.findMany.mockResolvedValue(members(1, 2, 3));
    prisma.notification.createMany.mockResolvedValue({ count: 1 });
    prisma.notification.count.mockResolvedValue(1);
    prisma.notification.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** The rows the service asked Prisma to insert. */
  function insertedRows(): Array<Record<string, unknown>> {
    expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
    const [arg] = prisma.notification.createMany.mock.calls[0] as [
      { data: Array<Record<string, unknown>> },
    ];
    return arg.data;
  }

  describe('createTemplateNeedsReview', () => {
    const LISTING = {
      id: 'tpl-1',
      createdBy: 5,
      workspaceId: WORKSPACE,
      documentId: DOCUMENT,
    };

    it('addresses the publisher with no actor', async () => {
      // Nobody acted on their behalf — the document changed. Every other type
      // here has an actor, so this is the first row that renders without one.
      await service.createTemplateNeedsReview({
        listing: LISTING,
        at: new Date('2026-09-02T10:00:00Z'),
      });
      expect(insertedRows()[0]).toMatchObject({
        type: 'template_needs_review',
        recipientId: 5,
        actorId: null,
        preview: null,
      });
    });

    it('dedupes per day, since editing is not one event', async () => {
      // A key on the listing alone would notify once ever; a per-edit key
      // would notify on every keystroke burst.
      await service.createTemplateNeedsReview({
        listing: LISTING,
        at: new Date('2026-09-02T10:00:00Z'),
      });
      const morning = insertedRows()[0].dedupeKey;
      prisma.notification.createMany.mockClear();
      await service.createTemplateNeedsReview({
        listing: LISTING,
        at: new Date('2026-09-02T23:59:00Z'),
      });
      expect(insertedRows()[0].dedupeKey).toBe(morning);

      prisma.notification.createMany.mockClear();
      await service.createTemplateNeedsReview({
        listing: LISTING,
        at: new Date('2026-09-03T00:01:00Z'),
      });
      expect(insertedRows()[0].dedupeKey).not.toBe(morning);
    });
  });

  describe('createTemplateReviewed', () => {
    const LISTING = {
      id: 'tpl-1',
      createdBy: 5,
      workspaceId: WORKSPACE,
      documentId: DOCUMENT,
    };

    it('makes the decision the type', async () => {
      // "Your template was reviewed" would make the reader open it to learn
      // the one thing they wanted to know, which is why there are three types
      // rather than one carrying a field.
      for (const [decision, type] of [
        ['approve', 'template_approved'],
        ['reject', 'template_rejected'],
        ['takedown', 'template_removed'],
      ] as const) {
        prisma.notification.createMany.mockClear();
        await service.createTemplateReviewed({
          listing: LISTING,
          reviewerId: 9,
          decision,
          decidedAt: new Date('2026-09-02T00:00:00Z'),
        });
        expect(insertedRows()[0].type).toBe(type);
      }
    });

    it('addresses the publisher and carries the reason', async () => {
      await service.createTemplateReviewed({
        listing: LISTING,
        reviewerId: 9,
        decision: 'reject',
        note: 'too thin',
        decidedAt: new Date('2026-09-02T00:00:00Z'),
      });
      expect(insertedRows()[0]).toMatchObject({
        recipientId: 5,
        actorId: 9,
        preview: 'too thin',
      });
    });

    it('keys dedupe on the decision instant, so a second decision notifies', async () => {
      // A listing rejected, revised and rejected again is exactly the sequence
      // a publisher most needs to hear about — and the one the unique index
      // would absorb if the key were the listing id alone.
      await service.createTemplateReviewed({
        listing: LISTING,
        reviewerId: 9,
        decision: 'reject',
        decidedAt: new Date('2026-09-02T00:00:00Z'),
      });
      const first = insertedRows()[0].dedupeKey;
      prisma.notification.createMany.mockClear();
      await service.createTemplateReviewed({
        listing: LISTING,
        reviewerId: 9,
        decision: 'reject',
        decidedAt: new Date('2026-09-03T00:00:00Z'),
      });
      expect(insertedRows()[0].dedupeKey).not.toBe(first);
    });

    it('does not notify a reviewer who decided their own listing', async () => {
      await service.createTemplateReviewed({
        listing: LISTING,
        reviewerId: 5,
        decision: 'approve',
        decidedAt: new Date('2026-09-02T00:00:00Z'),
      });
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
    });
  });

  describe('createFromComment', () => {
    it('reads the document live-only, so a trashed one is NotFound', async () => {
      prisma.document.findUnique.mockResolvedValue(null);

      await expect(service.createFromComment(1, commentDto())).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.document.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: DOCUMENT, deletedAt: null },
        }),
      );
    });

    it('throws NotFound when the document does not exist', async () => {
      prisma.document.findUnique.mockResolvedValue(null);

      await expect(service.createFromComment(1, commentDto())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws Forbidden when the actor is not a member of the workspace', async () => {
      prisma.workspaceMember.findMany.mockResolvedValue(members(2, 3));

      await expect(service.createFromComment(1, commentDto())).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('drops recipients who are not members of the workspace', async () => {
      prisma.workspaceMember.findMany.mockResolvedValue(members(1, 2));

      await service.createFromComment(
        1,
        commentDto({ recipientUserIds: [2, 99] }),
      );

      expect(insertedRows().map((r) => r.recipientId)).toEqual([2]);
    });

    it('never notifies the actor about their own comment', async () => {
      await service.createFromComment(
        1,
        commentDto({ recipientUserIds: [1, 2] }),
      );

      expect(insertedRows().map((r) => r.recipientId)).toEqual([2]);
    });

    it('writes no rows and touches no hub when every recipient is filtered out', async () => {
      const publish = jest.spyOn(hub, 'publish');

      const result = await service.createFromComment(
        1,
        commentDto({ recipientUserIds: [1] }),
      );

      expect(result).toEqual({ created: 0 });
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    });

    it('deduplicates repeated recipients in one request', async () => {
      await service.createFromComment(
        1,
        commentDto({ recipientUserIds: [2, 2, 3] }),
      );

      expect(insertedRows().map((r) => r.recipientId)).toEqual([2, 3]);
    });

    it('keys mention and reply rows on the comment id', async () => {
      await service.createFromComment(1, commentDto({ type: 'comment_reply' }));

      expect(insertedRows()[0].dedupeKey).toBe('comment-1');
    });

    it('keys a resolve on the thread, since it has no comment of its own', async () => {
      await service.createFromComment(
        1,
        commentDto({ type: 'thread_resolved', commentId: undefined }),
      );

      expect(insertedRows()[0].dedupeKey).toBe('thread-1:resolved');
    });

    it('lets the unique index absorb a duplicate report', async () => {
      await service.createFromComment(1, commentDto());

      expect(prisma.notification.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ skipDuplicates: true }),
      );
    });

    it('truncates a long preview to 200 characters', async () => {
      await service.createFromComment(
        1,
        commentDto({ preview: 'x'.repeat(500) }),
      );

      expect(insertedRows()[0].preview).toHaveLength(200);
    });

    it('collapses newlines and strips control characters from the preview', async () => {
      await service.createFromComment(
        1,
        commentDto({ preview: 'line one\n\nline\u0000 two' }),
      );

      expect(insertedRows()[0].preview).toBe('line one line two');
    });

    it('strips bidi overrides, which could reverse how a preview reads', async () => {
      await service.createFromComment(
        1,
        commentDto({ preview: 'ship ‮it now‬' }),
      );

      expect(insertedRows()[0].preview).toBe('ship it now');
    });

    it('strips zero-width characters', async () => {
      await service.createFromComment(1, commentDto({ preview: 'ap​pro‌ved' }));

      expect(insertedRows()[0].preview).toBe('approved');
    });

    it('caps a single report at 20 recipients', async () => {
      const many = Array.from({ length: 30 }, (_, i) => i + 100);
      prisma.workspaceMember.findMany.mockResolvedValue(members(1, ...many));

      await service.createFromComment(
        1,
        commentDto({ recipientUserIds: many }),
      );

      expect(insertedRows()).toHaveLength(20);
    });

    it('publishes a fresh unread count to each connected recipient', async () => {
      const seen: Array<[number, unknown]> = [];
      const subs = [2, 3].map((id) =>
        hub.subscribe(id).subscribe((s) => seen.push([id, s])),
      );
      prisma.notification.count.mockResolvedValue(4);
      prisma.notification.findMany.mockResolvedValue([{ id: 'n-latest' }]);

      await service.createFromComment(
        1,
        commentDto({ recipientUserIds: [2, 3] }),
      );

      expect(seen).toEqual([
        [2, { unreadCount: 4, latestId: 'n-latest' }],
        [3, { unreadCount: 4, latestId: 'n-latest' }],
      ]);
      subs.forEach((s) => s.unsubscribe());
    });

    it('does not compute a summary for a recipient with no connection here', async () => {
      // Two queries per summary, and `publish` only reaches this replica —
      // recipients elsewhere learn about it from their own poll tick.
      await service.createFromComment(
        1,
        commentDto({ recipientUserIds: [2, 3] }),
      );

      expect(prisma.notification.count).not.toHaveBeenCalled();
    });

    it('publishes nothing when every row was an absorbed duplicate', async () => {
      const seen: unknown[] = [];
      const sub = hub.subscribe(2).subscribe((s) => seen.push(s));
      prisma.notification.createMany.mockResolvedValue({ count: 0 });

      const result = await service.createFromComment(1, commentDto());

      expect(result).toEqual({ created: 0 });
      expect(seen).toEqual([]);
      sub.unsubscribe();
    });

    it('stores the document and workspace the comment belongs to', async () => {
      await service.createFromComment(1, commentDto());

      expect(insertedRows()[0]).toMatchObject({
        actorId: 1,
        documentId: DOCUMENT,
        workspaceId: WORKSPACE,
        threadId: 'thread-1',
        commentId: 'comment-1',
        type: 'comment_mention',
      });
    });
  });

  describe('createMemberJoined', () => {
    it('notifies the workspace owners and the invite creator', async () => {
      prisma.workspaceMember.findMany.mockResolvedValue([
        { userId: 10, role: 'owner' },
        { userId: 11, role: 'member' },
      ]);

      await service.createMemberJoined({
        workspaceId: WORKSPACE,
        joinerId: 12,
        inviteCreatorId: 11,
      });

      expect(
        insertedRows()
          .map((r) => r.recipientId)
          .sort(),
      ).toEqual([10, 11]);
      expect(insertedRows()[0]).toMatchObject({
        type: 'workspace_member_joined',
        actorId: 12,
        workspaceId: WORKSPACE,
        documentId: null,
        dedupeKey: null,
      });
    });

    it('does not notify the joiner even when they created the invite', async () => {
      prisma.workspaceMember.findMany.mockResolvedValue([
        { userId: 12, role: 'owner' },
      ]);

      const result = await service.createMemberJoined({
        workspaceId: WORKSPACE,
        joinerId: 12,
        inviteCreatorId: 12,
      });

      expect(result).toEqual({ created: 0 });
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
    });
  });

  describe('createWebhookAlert', () => {
    it('notifies every owner, keyed on the webhook and the streak', async () => {
      prisma.workspaceMember.findMany.mockResolvedValue([
        { userId: 10 },
        { userId: 13 },
      ]);
      const since = new Date('2026-11-20T00:00:00.000Z');

      await service.createWebhookAlert({
        workspaceId: WORKSPACE,
        webhook: { id: 'wh1', name: 'Zapier' },
        type: 'webhook_failing',
        reason: 'Last response: 502',
        since,
      });

      expect(prisma.workspaceMember.findMany).toHaveBeenCalledWith({
        where: { workspaceId: WORKSPACE, role: 'owner' },
        select: { userId: true },
      });
      expect(
        insertedRows()
          .map((r) => r.recipientId)
          .sort(),
      ).toEqual([10, 13]);
      expect(insertedRows()[0]).toMatchObject({
        type: 'webhook_failing',
        actorId: null,
        documentId: null,
        threadId: 'wh1',
        dedupeKey: 'wh1:webhook_failing:2026-11-20T00:00:00.000Z',
        preview: 'Zapier: Last response: 502',
      });
    });

    it('does not notify the owner who disabled it themselves', async () => {
      prisma.workspaceMember.findMany.mockResolvedValue([{ userId: 10 }]);

      const result = await service.createWebhookAlert({
        workspaceId: WORKSPACE,
        webhook: { id: 'wh1', name: 'Zapier' },
        type: 'webhook_disabled',
        reason: 'Turned off',
        since: new Date(),
        actorId: 10,
      });

      expect(result).toEqual({ created: 0 });
    });
  });

  describe('markRead', () => {
    it('marks only the caller rows, so one user cannot read another inbox', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 2 });

      await service.markRead(7, ['a', 'b']);

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { recipientId: 7, readAt: null, id: { in: ['a', 'b'] } },
        data: { readAt: expect.any(Date) as Date },
      });
    });

    it('marks every unread row when no ids are given', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 5 });

      await service.markRead(7);

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { recipientId: 7, readAt: null },
        data: { readAt: expect.any(Date) as Date },
      });
    });

    it('publishes the recomputed count so the user other tabs update', async () => {
      const seen: unknown[] = [];
      const sub = hub.subscribe(7).subscribe((s) => seen.push(s));
      prisma.notification.updateMany.mockResolvedValue({ count: 2 });
      prisma.notification.count.mockResolvedValue(0);
      prisma.notification.findMany.mockResolvedValue([]);

      await service.markRead(7);

      expect(seen).toEqual([{ unreadCount: 0, latestId: null }]);
      sub.unsubscribe();
    });
  });

  describe('list', () => {
    it('returns the caller most recent notifications, newest first', async () => {
      prisma.notification.findMany.mockResolvedValue([]);

      await service.list(7);

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { recipientId: 7 },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 20,
        }),
      );
    });

    it('pages backwards from a timestamp-only cursor', async () => {
      prisma.notification.findMany.mockResolvedValue([]);
      const before = new Date('2026-08-10T00:00:00.000Z');

      await service.list(7, { before });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { recipientId: 7, OR: [{ createdAt: { lt: before } }] },
        }),
      );
    });

    it('also returns rows at the boundary instant that sort after the cursor id', async () => {
      prisma.notification.findMany.mockResolvedValue([]);
      const before = new Date('2026-08-10T00:00:00.000Z');

      await service.list(7, { before, id: 'n-5' });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            recipientId: 7,
            OR: [
              { createdAt: { lt: before } },
              { createdAt: before, id: { lt: 'n-5' } },
            ],
          },
        }),
      );
    });

    it('selects the workspace, which is all a join notification has to name itself by', async () => {
      prisma.notification.findMany.mockResolvedValue([]);

      await service.list(7);

      const calls = prisma.notification.findMany.mock.calls as Array<
        [{ select: Record<string, unknown> }]
      >;
      const { select } = calls[0][0];
      expect(select.workspace).toEqual({
        select: { id: true, name: true },
      });
      // Still no internal bookkeeping: the unique index shape stays server-side.
      expect(select.dedupeKey).toBeUndefined();
      expect(select.recipientId).toBeUndefined();
    });
  });

  describe('syncChatMessage', () => {
    function edit(over: Partial<Record<string, unknown>> = {}) {
      return {
        workspaceId: WORKSPACE,
        actorId: 1,
        channelId: 'ch-1',
        messageId: 'msg-1',
        threadRootId: null,
        recipients: [2],
        preview: 'now @[bob](2)',
        ...over,
      } as Parameters<NotificationService['syncChatMessage']>[0];
    }

    it('rewrites the preview of every row quoting the message', async () => {
      await service.syncChatMessage(edit());

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: {
          workspaceId: WORKSPACE,
          threadId: 'ch-1',
          commentId: 'msg-1',
          type: { in: ['chat_mention', 'chat_thread_reply'] },
        },
        data: { preview: 'now @bob' },
      });
    });

    it('drops the mention rows of people edited out of the message', async () => {
      prisma.notification.findMany.mockResolvedValue([
        { id: 'n-3', recipientId: 3 },
      ]);

      await service.syncChatMessage(edit({ recipients: [2] }));

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: {
          workspaceId: WORKSPACE,
          threadId: 'ch-1',
          commentId: 'msg-1',
          type: 'chat_mention',
          recipientId: { notIn: [2] },
        },
        select: { id: true, recipientId: true },
      });
      expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['n-3'] } },
      });
    });

    it('notifies people the edit mentions, keyed so existing rows stay', async () => {
      await service.syncChatMessage(edit({ recipients: [2, 3] }));

      // `skipDuplicates` on the message key leaves an existing row (and its
      // read state) alone; only a new recipient gets a new row.
      expect(prisma.notification.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ recipientId: 2, dedupeKey: 'msg-1' }),
          expect.objectContaining({ recipientId: 3, dedupeKey: 'msg-1' }),
        ],
        skipDuplicates: true,
      });
    });

    it('refreshes the badge of somebody edited out of the message', async () => {
      const seen: unknown[] = [];
      const sub = hub.subscribe(3).subscribe((s) => seen.push(s));
      // The mention lookup answers with the dropped row first; later reads
      // are the recipient's fresh summary, which no longer counts it.
      prisma.notification.findMany
        .mockResolvedValueOnce([{ id: 'n-3', recipientId: 3 }])
        .mockResolvedValue([{ id: 'n-older' }]);
      prisma.notification.count.mockResolvedValue(0);

      await service.syncChatMessage(edit({ recipients: [2] }));

      expect(seen).toEqual([{ unreadCount: 0, latestId: 'n-older' }]);
      sub.unsubscribe();
    });

    it('deletes nothing when every mention is still there', async () => {
      await service.syncChatMessage(edit());

      expect(prisma.notification.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('createChatMention', () => {
    function mention(over: Partial<Record<string, unknown>> = {}) {
      return {
        workspaceId: WORKSPACE,
        actorId: 1,
        channelId: 'ch-1',
        messageId: 'msg-1',
        threadRootId: null,
        recipients: [2],
        preview: 'hi @[bob](2)',
        ...over,
      } as Parameters<NotificationService['createChatMention']>[0];
    }

    it('writes one chat_mention row keyed on the message', async () => {
      await service.createChatMention(mention());

      expect(insertedRows()).toEqual([
        {
          type: 'chat_mention',
          recipientId: 2,
          actorId: 1,
          workspaceId: WORKSPACE,
          documentId: null,
          // The existing opaque columns carry the chat location, so the
          // schema needs no chat-specific fields.
          threadId: 'ch-1',
          commentId: 'msg-1',
          dedupeKey: 'msg-1',
          // The raw mention token must not leak into the dropdown line.
          preview: 'hi @bob',
        },
      ]);
    });

    it('notifies every authorized recipient, as in a group DM', async () => {
      await service.createChatMention(mention({ recipients: [2, 3] }));

      expect(insertedRows().map((r) => r.recipientId)).toEqual([2, 3]);
    });

    it('never notifies the actor about mentioning themselves', async () => {
      const result = await service.createChatMention(
        mention({ recipients: [1] }),
      );

      expect(result).toEqual({ created: 0 });
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
    });

    // Defense in depth: the caller authorized these through mentionOutcome,
    // but a workspace membership revoked since must still be honoured here.
    it('drops a recipient who is not a workspace member', async () => {
      prisma.workspaceMember.findMany.mockResolvedValue(members(1, 2));

      await service.createChatMention(mention({ recipients: [2, 9] }));

      expect(insertedRows().map((r) => r.recipientId)).toEqual([2]);
    });

    it('writes nothing when no recipient was authorized', async () => {
      const result = await service.createChatMention(
        mention({ recipients: [] }),
      );

      expect(result).toEqual({ created: 0 });
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
    });

    it('caps one message at 20 recipients', async () => {
      const ids = Array.from({ length: 30 }, (_, i) => i + 2);
      prisma.workspaceMember.findMany.mockResolvedValue(members(1, ...ids));

      await service.createChatMention(mention({ recipients: ids }));

      expect(insertedRows()).toHaveLength(20);
    });
  });

  describe('createChatThreadReply', () => {
    function reply(over: Partial<Record<string, unknown>> = {}) {
      return {
        workspaceId: WORKSPACE,
        actorId: 1,
        channelId: 'ch-1',
        messageId: 'msg-9',
        threadRootId: 'root-1',
        preview: 'agreed',
        excludeUserIds: [],
        ...over,
      } as Parameters<NotificationService['createChatThreadReply']>[0];
    }

    beforeEach(() => {
      jest.useFakeTimers({ now: new Date('2026-11-21T09:41:00.000Z') });
      prisma.chatChannel.findUnique.mockResolvedValue({ kind: 'public' });
      prisma.chatChannelMember.findMany.mockResolvedValue([]);
      prisma.chatMessage.findUnique.mockResolvedValue({ authorId: 2 });
      prisma.chatMessage.findMany.mockResolvedValue([
        { authorId: 1 },
        { authorId: 3 },
      ]);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('notifies the root author and prior repliers, never the actor', async () => {
      await service.createChatThreadReply(reply());

      const rows = insertedRows();
      expect(rows.map((r) => r.recipientId)).toEqual([2, 3]);
      expect(rows[0]).toEqual({
        type: 'chat_thread_reply',
        recipientId: 2,
        actorId: 1,
        workspaceId: WORKSPACE,
        documentId: null,
        threadId: 'ch-1',
        commentId: 'msg-9',
        dedupeKey: 'root-1:2026-11-21T09',
        preview: 'agreed',
      });
    });

    it('reads repliers of this thread only', async () => {
      await service.createChatThreadReply(reply());

      expect(prisma.chatMessage.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'root-1' } }),
      );
      const [arg] = prisma.chatMessage.findMany.mock.calls[0] as [
        { where: { threadRootId: string } },
      ];
      expect(arg.where.threadRootId).toBe('root-1');
    });

    // A mentioned user already has a chat_mention row for this message; a
    // second row about the same reply would be noise.
    it('skips users the caller already notified by mention', async () => {
      await service.createChatThreadReply(reply({ excludeUserIds: [3] }));

      expect(insertedRows().map((r) => r.recipientId)).toEqual([2]);
    });

    it('keys a second reply in the same hour onto the same row', async () => {
      await service.createChatThreadReply(reply({ messageId: 'msg-9' }));
      jest.setSystemTime(new Date('2026-11-21T09:59:00.000Z'));
      await service.createChatThreadReply(reply({ messageId: 'msg-10' }));
      jest.setSystemTime(new Date('2026-11-21T10:00:00.000Z'));
      await service.createChatThreadReply(reply({ messageId: 'msg-11' }));

      const calls = prisma.notification.createMany.mock.calls as Array<
        [{ data: Array<Record<string, unknown>> }]
      >;
      const keys = calls.map(([arg]) => arg.data[0].dedupeKey);
      // Same key → the unique index absorbs the second insert.
      expect(keys).toEqual([
        'root-1:2026-11-21T09',
        'root-1:2026-11-21T09',
        'root-1:2026-11-21T10',
      ]);
    });

    it('drops a participant who has left the workspace', async () => {
      prisma.workspaceMember.findMany.mockResolvedValue(members(1, 3));

      await service.createChatThreadReply(reply());

      expect(insertedRows().map((r) => r.recipientId)).toEqual([3]);
    });

    // A participant who left a private channel must not keep receiving its
    // content as previews.
    it('drops a participant who can no longer read a private channel', async () => {
      prisma.chatChannel.findUnique.mockResolvedValue({ kind: 'private' });
      prisma.chatChannelMember.findMany.mockResolvedValue([{ userId: 3 }]);

      await service.createChatThreadReply(reply());

      expect(insertedRows().map((r) => r.recipientId)).toEqual([3]);
    });

    it('writes nothing for a reply to a root the actor wrote alone', async () => {
      prisma.chatMessage.findUnique.mockResolvedValue({ authorId: 1 });
      prisma.chatMessage.findMany.mockResolvedValue([{ authorId: 1 }]);

      const result = await service.createChatThreadReply(reply());

      expect(result).toEqual({ created: 0 });
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
    });

    it('survives a root whose author was deleted', async () => {
      prisma.chatMessage.findUnique.mockResolvedValue({ authorId: null });

      await service.createChatThreadReply(reply());

      expect(insertedRows().map((r) => r.recipientId)).toEqual([3]);
    });

    it('writes nothing when the channel is gone', async () => {
      prisma.chatChannel.findUnique.mockResolvedValue(null);

      const result = await service.createChatThreadReply(reply());

      expect(result).toEqual({ created: 0 });
    });
  });
});
