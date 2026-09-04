import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ApiKeyWriteScopeGuard } from './api-key-write-scope.guard';
import { DocumentService } from '../../document/document.service';
import { UserService } from '../../user/user.service';
import { NotificationService } from '../../notification/notification.service';
import type { CommentNotificationDto } from '../../notification/notification.dto';
import { YorkieService } from '../../yorkie/yorkie.service';
import { YORKIE_DOC_KEY_PREFIXES } from '../../yorkie/yorkie-doc-key';
import type { AuthenticatedRequest } from '../../auth/auth.types';
import {
  AnyAnchor,
  AnyThread,
  ThreadMap,
  applyAddReply,
  applyAddThread,
  applyDeleteComment,
  applyDeleteThread,
  applySetResolved,
  buildReply,
  buildThread,
  copyThread,
  findThread,
  listThreads,
  normalizeBody,
} from '../../yorkie/comment-ops';
import {
  cellAnchorToSref,
  initialSpreadsheetDocument,
  parseRef,
} from '@wafflebase/sheets';
import type { CommentAuthor, Worksheet } from '@wafflebase/sheets';
import type { SpreadsheetDocument } from '../../yorkie/yorkie.types';

/** The document types that store comment threads. */
const COMMENTABLE = ['sheet', 'doc', 'pdf'] as const;
type CommentableType = (typeof COMMENTABLE)[number];

/** A root that keeps its threads at the top level (`doc`, `pdf`). */
type FlatCommentRoot = Record<string, unknown> & { comments?: ThreadMap };

/**
 * Comment threads, per document.
 *
 * Comments are the one document feature that lives *entirely* in the Yorkie
 * CRDT: no Postgres table, no service, and — until this controller — no route,
 * which is why the capability audit in
 * `docs/design/agentic-office-workflow.md` filed them under class B rather
 * than "a command is missing". The editor is the only thing that has ever
 * written them.
 *
 * Storage differs by type but the thread shape does not:
 *
 * - `sheet` → `root.sheets[tabId].comments[threadId]`, anchored on a cell's
 *   axis ids, so a thread belongs to a tab.
 * - `doc` / `pdf` → `root.comments[threadId]`, anchored on a text range and
 *   on page geometry respectively.
 *
 * **Creating** a thread therefore needs a constructible anchor, and only two
 * of the three have one. A sheet anchor is an `A1` reference resolved through
 * the worksheet's `rowOrder`/`colOrder`; a PDF anchor is a page index plus a
 * normalized rectangle. A docs anchor is a pair of Yorkie tree positions that
 * only a session holding the tree can mint, so `POST` refuses on a `doc` and
 * says so. Listing, replying, resolving and deleting work on all three.
 *
 * The author is the authenticated caller — an API key resolves to the user
 * who minted it, which is the same identity the notification routes hold a
 * comment reporter to.
 *
 * Writes **notify** like the editor's do. `docs/design/notifications.md` was
 * written when the client was the only party that could observe a comment, so
 * `POST /notifications/comment` exists for the browser to report one; these
 * routes are the second writer, and an agent-authored mention that told nobody
 * would be a silently dropped notification rather than a deferred feature. The
 * planning rule is the same one `packages/frontend/src/components/comments/notify.ts`
 * applies (see {@link planCommentNotifications}), and it goes through the same
 * `NotificationService.createFromComment`, so membership authorization, the
 * recipient cap and the dedupe keys are one implementation.
 */
@Controller('api/v1/workspaces/:workspaceId/documents/:documentId/comments')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard, ApiKeyWriteScopeGuard)
export class ApiV1CommentsController {
  private readonly logger = new Logger(ApiV1CommentsController.name);

  constructor(
    private readonly documentService: DocumentService,
    private readonly yorkieService: YorkieService,
    private readonly userService: UserService,
    private readonly notificationService: NotificationService,
  ) {}

  private async loadCommentableType(
    workspaceId: string,
    documentId: string,
  ): Promise<CommentableType> {
    const meta = await this.documentService.getDocumentOrThrow({
      id: documentId,
      workspaceId,
    });
    if (!COMMENTABLE.includes(meta.type as CommentableType)) {
      throw new BadRequestException(
        `Comments are available on ${COMMENTABLE.join(' / ')} documents; ` +
          `"${documentId}" is a "${meta.type}" document.`,
      );
    }
    return meta.type as CommentableType;
  }

  /**
   * The comment author for the authenticated caller.
   *
   * `req.user` is only a full `User` row for a **JWT** caller: the API-key
   * strategy returns `{ id, workspaceId, scopes, isApiKey }`
   * (`api-key.strategy.ts`), with no `username` and no `photo` — and an API
   * key is the primary way these routes are reached. Reading `req.user.username`
   * straight off the request therefore stored `username: undefined` for every
   * agent-authored comment, so the id is resolved against the `User` table
   * whenever the request does not already carry a name.
   */
  private async author(req: AuthenticatedRequest): Promise<CommentAuthor> {
    const userId = req.user.id;
    if (typeof req.user.username === 'string' && req.user.username.length > 0) {
      const author: CommentAuthor = {
        userId: String(userId),
        username: req.user.username,
      };
      if (req.user.photo) author.photo = req.user.photo;
      return author;
    }

    const user = await this.userService.user({ id: userId });
    if (!user) {
      // The key's creator was deleted. Storing an anonymous author would put
      // an unattributable comment in the document, so refuse the write.
      throw new BadRequestException(
        'The user this API key was created by no longer exists, so a comment ' +
          'cannot be attributed to an author.',
      );
    }
    const author: CommentAuthor = {
      userId: String(user.id),
      username: user.username,
    };
    if (user.photo) author.photo = user.photo;
    return author;
  }

  /**
   * Report a comment event to the notification pipeline.
   *
   * Fire-and-forget, exactly like `notifyCommentEvent` in the frontend and for
   * the same reason: the comment is already committed to the CRDT, so a failed
   * notification must never turn a successful write into an error for the
   * caller.
   */
  private async notify(
    documentId: string,
    actor: CommentAuthor,
    event: CommentEventKind,
    thread: AnyThread,
    comment?: { id: string; body: string },
  ): Promise<void> {
    const actorId = toUserId(actor.userId);
    if (actorId === null) return;
    const plans = planCommentNotifications({
      documentId,
      actorId,
      event,
      thread,
      comment,
    });
    for (const plan of plans) {
      try {
        await this.notificationService.createFromComment(actorId, plan);
      } catch (err) {
        this.logger.warn(
          `comment notification (${plan.type}) failed for document ${documentId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  @Get()
  async list(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
  ): Promise<{ threads: AnyThread[] }> {
    const type = await this.loadCommentableType(workspaceId, documentId);

    if (type === 'sheet') {
      const threads = await this.yorkieService.withDocument<
        AnyThread[],
        SpreadsheetDocument
      >(
        documentId,
        (doc) => {
          const root = doc.getRoot();
          const out: AnyThread[] = [];
          // Walk `tabOrder` rather than the `sheets` keys: a Yorkie object
          // proxy answers `toJSON`/`getID` with truthy functions, so a raw
          // key walk can surface entries that are not worksheets.
          for (const tabId of root.tabOrder ?? []) {
            const worksheet = root.sheets?.[tabId] as Worksheet | undefined;
            if (!worksheet) continue;
            for (const thread of listThreads(worksheet.comments as ThreadMap)) {
              out.push(withSref(thread, worksheet));
            }
          }
          return out;
        },
        { syncMode: 'readonly' },
      );
      return { threads };
    }

    const threads = await this.yorkieService.withDocument<
      AnyThread[],
      FlatCommentRoot
    >(documentId, (doc) => listThreads(doc.getRoot().comments), {
      docKeyPrefix: prefixFor(type),
      syncMode: 'readonly',
    });
    return { threads };
  }

  @Post()
  async createThread(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<AnyThread> {
    const type = await this.loadCommentableType(workspaceId, documentId);
    const input = asObject(body, 'body');
    const text = normalizeBody(input.body);
    if (!text) {
      throw new BadRequestException("'body' must be a non-empty string");
    }
    const author = await this.author(req);
    const now = Date.now();

    if (type === 'doc') {
      // A `docs-range` anchor is `{ blockId, posRange, quotedText }` where
      // `posRange` is a pair of Yorkie `TreePos` structs — positions inside
      // the live tree, not offsets. Nothing outside a session that holds the
      // tree can produce one, and a fabricated pair would create a thread the
      // editor immediately shows as orphaned. So this refuses instead of
      // storing something that cannot be anchored.
      throw new BadRequestException(
        'Creating a comment thread on a word-processor document requires a ' +
          'text-range anchor minted by an editor session (a pair of CRDT tree ' +
          'positions), so it cannot be created through the API. Listing, ' +
          'replying, resolving and deleting its threads are supported.',
      );
    }

    if (type === 'pdf') {
      const anchor = parsePdfAnchor(input);
      const created = await this.yorkieService.withDocument<
        AnyThread,
        FlatCommentRoot
      >(
        documentId,
        (doc) => {
          const thread = buildThread({ anchor, body: text, author, now });
          doc.update((root) => {
            if (!root.comments) root.comments = {};
            applyAddThread(root.comments, thread);
          });
          return copyThread(thread);
        },
        { docKeyPrefix: prefixFor(type), initialRoot: { comments: {} } },
      );
      await this.notify(documentId, author, 'thread', created, {
        id: created.comments[0].id,
        body: text,
      });
      return created;
    }

    const tabId = requireString(input, 'tabId');
    const ref = requireString(input, 'ref');
    const created = await this.yorkieService.withDocument<
      AnyThread,
      SpreadsheetDocument
    >(
      documentId,
      (doc) => {
        const worksheet = doc.getRoot().sheets?.[tabId] as
          | Worksheet
          | undefined;
        if (!worksheet) throw new NotFoundException('Tab not found');
        const anchor = sheetCellAnchor(worksheet, tabId, ref);
        const thread = buildThread({ anchor, body: text, author, now });
        doc.update((root) => {
          const ws = root.sheets[tabId];
          if (!ws.comments) ws.comments = {};
          applyAddThread(ws.comments as ThreadMap, thread);
        });
        return withSref(copyThread(thread), worksheet);
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
    await this.notify(documentId, author, 'thread', created, {
      id: created.comments[0].id,
      body: text,
    });
    return created;
  }

  @Post(':threadId/replies')
  async reply(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('threadId') threadId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    const type = await this.loadCommentableType(workspaceId, documentId);
    const text = normalizeBody(asObject(body, 'body').body);
    if (!text) {
      throw new BadRequestException("'body' must be a non-empty string");
    }
    const author = await this.author(req);
    const reply = buildReply({ body: text, author, now: Date.now() });

    const updated = await this.mutateThread(
      documentId,
      type,
      threadId,
      (thread) => {
        applyAddReply(thread, reply);
      },
    );
    await this.notify(documentId, author, 'reply', updated, {
      id: reply.id,
      body: text,
    });
    return { threadId, comment: { ...reply, createdAt: Number(reply.createdAt) } };
  }

  @Patch(':threadId')
  async setResolved(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('threadId') threadId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<AnyThread> {
    const type = await this.loadCommentableType(workspaceId, documentId);
    const { resolved } = asObject(body, 'body');
    if (typeof resolved !== 'boolean') {
      throw new BadRequestException("'resolved' must be a boolean");
    }
    const author = await this.author(req);
    const updated = await this.mutateThread(
      documentId,
      type,
      threadId,
      (thread) => {
        applySetResolved(thread, resolved, author, Date.now());
      },
    );
    // Only resolving is an event anyone is waiting on — reopening notifies
    // nobody, matching the editor's controllers.
    if (resolved) {
      await this.notify(documentId, author, 'resolve', updated);
    }
    return updated;
  }

  @Delete(':threadId')
  async deleteThread(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('threadId') threadId: string,
  ) {
    const type = await this.loadCommentableType(workspaceId, documentId);
    await this.mutateMap(documentId, type, threadId, (map) => {
      if (!applyDeleteThread(map, threadId)) {
        throw new NotFoundException('Thread not found');
      }
    });
    return { id: threadId, deleted: 'thread' as const };
  }

  @Delete(':threadId/comments/:commentId')
  async deleteComment(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('threadId') threadId: string,
    @Param('commentId') commentId: string,
  ) {
    const type = await this.loadCommentableType(workspaceId, documentId);
    let response!: {
      id: string;
      threadId: string;
      deleted: 'comment' | 'thread';
    };
    await this.mutateMap(documentId, type, threadId, (map) => {
      const result = applyDeleteComment(map, threadId, commentId);
      if (result === 'not_found') {
        throw new NotFoundException('Comment not found');
      }
      // Deleting the opening comment deletes the conversation it opened, the
      // same rule the editor's stores follow. Say which happened rather than
      // reporting a bare success for what was in fact a thread deletion.
      response = {
        id: commentId,
        threadId,
        deleted: result === 'thread_deleted' ? 'thread' : 'comment',
      };
    });
    return response;
  }

  /**
   * Run `mutate` against the thread map, whichever root holds it. The tab a
   * sheet thread lives under is not in the path — a thread id is unique
   * across the document, and making the caller repeat the tab would let them
   * name the wrong one.
   */
  private async mutateMap(
    documentId: string,
    type: CommentableType,
    threadId: string,
    mutate: (map: ThreadMap) => void,
  ): Promise<void> {
    if (type === 'sheet') {
      await this.yorkieService.withDocument<void, SpreadsheetDocument>(
        documentId,
        (doc) => {
          const tabId = tabIdOfThread(doc.getRoot(), threadId);
          if (!tabId) throw new NotFoundException('Thread not found');
          doc.update((root) => {
            const ws = root.sheets[tabId];
            mutate(ws.comments as ThreadMap);
          });
        },
        { initialRoot: initialSpreadsheetDocument() },
      );
      return;
    }
    await this.yorkieService.withDocument<void, FlatCommentRoot>(
      documentId,
      (doc) => {
        if (!findThread(doc.getRoot().comments, threadId)) {
          throw new NotFoundException('Thread not found');
        }
        doc.update((root) => {
          mutate(root.comments as ThreadMap);
        });
      },
      { docKeyPrefix: prefixFor(type), initialRoot: { comments: {} } },
    );
  }

  /** `mutateMap` for the operations that edit a thread and return it. */
  private async mutateThread(
    documentId: string,
    type: CommentableType,
    threadId: string,
    mutate: (thread: AnyThread) => void,
  ): Promise<AnyThread> {
    let updated: AnyThread | undefined;
    await this.mutateMap(documentId, type, threadId, (map) => {
      const thread = findThread(map, threadId);
      if (!thread) throw new NotFoundException('Thread not found');
      mutate(thread);
      updated = copyThread(thread);
    });
    return updated!;
  }
}

function prefixFor(type: CommentableType): string {
  return YORKIE_DOC_KEY_PREFIXES[type];
}

/** Which comment write happened — the same three the frontend reports. */
export type CommentEventKind = 'thread' | 'reply' | 'resolve';

/**
 * `@[username](userId)` is how a mention is stored inline in the plain-string
 * comment body (`docs/design/comments-mentions.md`); only the id is read here.
 * Mirrors `MENTION_RE` in `packages/frontend/src/components/comments/mentions.ts`.
 */
const MENTION_RE = /@\[[^\]]*\]\(([^)]*)\)/g;

/**
 * `CommentAuthor.userId` is a string because the comment model is shared with
 * anonymous share-link sessions, but a notification recipient must be a real
 * `User.id`. Anything that is not a plain positive integer is not notifiable.
 */
function toUserId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Decide which notifications a comment write should produce.
 *
 * The rule is the frontend's `planCommentNotifications`, restated for a server
 * caller (which knows the actor as a `User.id` rather than as a
 * `CommentAuthor`): a reply notifies the thread's earlier participants, minus
 * anyone that same reply *mentions* — otherwise one reply lands in the same
 * inbox twice — and the actor is excluded everywhere. Resolving notifies the
 * participants. `NotificationService` re-checks workspace membership and
 * re-applies its own recipient cap, so this only decides intent, and an event
 * with nobody to notify costs no work at all.
 *
 * Exported for its own test: this is the only part of the notification path
 * that is a decision rather than a database write.
 */
export function planCommentNotifications(input: {
  documentId: string;
  actorId: number;
  event: CommentEventKind;
  thread: AnyThread;
  comment?: { id: string; body: string };
}): CommentNotificationDto[] {
  const { documentId, actorId, event, thread, comment } = input;
  const plans: CommentNotificationDto[] = [];

  if (event === 'resolve') {
    const participants = participantIds(thread).filter((id) => id !== actorId);
    if (participants.length > 0) {
      plans.push({
        type: 'thread_resolved',
        documentId,
        threadId: thread.id,
        recipientUserIds: participants,
        preview: thread.comments[0]?.body ?? '',
      });
    }
    return plans;
  }

  if (!comment) return plans;

  const mentioned: number[] = [];
  for (const match of comment.body.matchAll(MENTION_RE)) {
    const id = toUserId(match[1]);
    if (id !== null && id !== actorId && !mentioned.includes(id)) {
      mentioned.push(id);
    }
  }
  if (mentioned.length > 0) {
    plans.push({
      type: 'comment_mention',
      documentId,
      threadId: thread.id,
      commentId: comment.id,
      recipientUserIds: mentioned,
      preview: comment.body,
    });
  }

  if (event === 'reply') {
    const participants = participantIds({
      ...thread,
      comments: thread.comments.filter((c) => c.id !== comment.id),
    }).filter((id) => id !== actorId && !mentioned.includes(id));
    if (participants.length > 0) {
      plans.push({
        type: 'comment_reply',
        documentId,
        threadId: thread.id,
        commentId: comment.id,
        recipientUserIds: participants,
        preview: comment.body,
      });
    }
  }

  return plans;
}

function participantIds(thread: AnyThread): number[] {
  const ids: number[] = [];
  for (const c of thread.comments ?? []) {
    const id = toUserId(String(c.author?.userId ?? ''));
    if (id !== null && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function asObject(body: unknown, name: string): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException(`'${name}' must be a JSON object`);
  }
  return body as Record<string, unknown>;
}

function requireString(
  input: Record<string, unknown>,
  key: string,
): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`'${key}' must be a non-empty string`);
  }
  return value.trim();
}

/**
 * Resolve an `A1` reference to the stable axis ids a sheet thread anchors on.
 *
 * The ids only exist for materialized rows and columns, which is the same
 * reason the editor disables its comment button on an empty far-away cell:
 * there is nothing yet for the thread to survive an insert above it.
 */
function sheetCellAnchor(
  worksheet: Worksheet,
  tabId: string,
  ref: string,
): AnyAnchor {
  let parsed: { r: number; c: number };
  try {
    parsed = parseRef(ref);
  } catch {
    throw new BadRequestException(`Invalid cell reference "${ref}"`);
  }
  const rowId = worksheet.rowOrder?.[parsed.r - 1];
  const colId = worksheet.colOrder?.[parsed.c - 1];
  if (!rowId || !colId) {
    throw new BadRequestException(
      `Cell "${ref}" has no stable row/column id yet, so a comment cannot be ` +
        'anchored to it. Write a value in that row and column first.',
    );
  }
  return { kind: 'sheet-cell', tabId, rowId, colId };
}

/**
 * A PDF region anchor: a page index plus a rectangle in page-relative `0..1`
 * coordinates, which is what makes it zoom-independent (and what the OCR
 * sidecar convention already uses). Text anchors (`pdf-text`) come out of a
 * viewer selection and carry per-line rectangles, so they are not offered
 * here.
 */
function parsePdfAnchor(input: Record<string, unknown>): AnyAnchor {
  const pageIndex = input.pageIndex;
  if (typeof pageIndex !== 'number' || !Number.isInteger(pageIndex) || pageIndex < 0) {
    throw new BadRequestException("'pageIndex' must be a non-negative integer");
  }
  const rect = input.rect;
  if (!rect || typeof rect !== 'object' || Array.isArray(rect)) {
    throw new BadRequestException(
      "'rect' must be an object { x, y, w, h } in 0..1 page-relative units",
    );
  }
  const r = rect as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const key of ['x', 'y', 'w', 'h'] as const) {
    const value = r[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new BadRequestException(
        `'rect.${key}' must be a number between 0 and 1`,
      );
    }
    out[key] = value;
  }
  return { kind: 'pdf-region', pageIndex, rect: out };
}

/**
 * Add the thread's current `A1` position to a sheet thread on the way out.
 *
 * The stored anchor is axis ids, which are stable but unreadable; the `ref` is
 * derived, and `null` once the row or column it pointed at is deleted — which
 * is exactly how the editor tells an orphaned thread from a live one.
 */
function withSref(thread: AnyThread, worksheet: Worksheet): AnyThread {
  const anchor = thread.anchor;
  if (anchor.kind !== 'sheet-cell') return thread;
  const ref = cellAnchorToSref(
    { rowId: String(anchor.rowId), colId: String(anchor.colId) },
    {
      rowOrder: worksheet.rowOrder ?? [],
      colOrder: worksheet.colOrder ?? [],
    },
  );
  return { ...thread, anchor: { ...anchor, ref } };
}

/** The tab whose worksheet holds `threadId`, or undefined. */
function tabIdOfThread(
  root: SpreadsheetDocument,
  threadId: string,
): string | undefined {
  for (const tabId of root.tabOrder ?? []) {
    const worksheet = root.sheets?.[tabId] as Worksheet | undefined;
    if (findThread(worksheet?.comments as ThreadMap, threadId)) return tabId;
  }
  return undefined;
}
