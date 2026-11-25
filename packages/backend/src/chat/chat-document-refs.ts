import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatChannel, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  decodeAnchor,
  DOCUMENT_ID_SOURCE,
  DOCUMENT_PATH_SOURCE,
} from '@wafflebase/core/document-link';
import {
  ChatDocumentAnchor,
  ChatDocumentRefDto,
  ChatFileDto,
  ChatSharedInDto,
  ChatUserSummary,
} from './chat.types';

/**
 * Document cards (`docs/design/chat.md` § Document Cards and Anchors): the
 * Wafflebase document URLs in a message body, stored as `ChatDocumentRef`
 * rows when — and only when — they name a live document of the channel's
 * own workspace. The URL carries no workspace, so the document is looked up;
 * a link to another workspace, a trashed document, or one that does not
 * exist stays a plain link.
 */

/** A body names at most this many cards; the rest stay plain links. */
export const MAX_REFS_PER_MESSAGE = 10;

export interface DocumentLink {
  documentId: string;
  /** The raw `?at=` value, undecoded; null when absent. */
  at: string | null;
}

/**
 * The frontend's public origin from `FRONTEND_URL`, or undefined when it is
 * unset or not http(s). Only the origin: CORS compares `FRONTEND_URL` with
 * the browser's `Origin` header (`main.ts`), so a working deployment never
 * sets a path there, and the router basename its links carry
 * (`VITE_FRONTEND_BASENAME`) is not known to the backend.
 */
export function frontendOrigin(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Document links in `body`, first occurrence of each document only, in body
 * order, at most `MAX_REFS_PER_MESSAGE`. Two shapes count: an absolute URL on
 * this deployment's frontend `origin`, under any path prefix (the router
 * basename, which the backend does not know), and a root-relative path
 * standing on its own (`/s/<id>` at the start of the body or after
 * whitespace or an opening bracket). Any other origin is somebody else's
 * site — its `/s/<id>` names nothing here. A prefix accepts no more than an
 * origin-only rule would: the id is still looked up, in this workspace.
 */
export function extractDocumentLinks(
  body: string,
  origin: string | undefined,
): DocumentLink[] {
  // Whole path segments after the origin, so `:port`, `@host` or `.host`
  // right after it never pass, and the shortest prefix wins.
  const prefix = origin
    ? `(?:${escapeRegExp(origin)}(?:/[^\\s<>"?#/]+)*?|(?<=^|[\\s(<]))`
    : '(?<=^|[\\s(<])';
  const re = new RegExp(
    `${prefix}${DOCUMENT_PATH_SOURCE}(?![0-9A-Za-z-])([?#][^\\s<>"]*)?`,
    'g',
  );
  const out: DocumentLink[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(re)) {
    // Ids are stored lowercase (Prisma's `uuid()`); compare that way.
    const documentId = match[2].toLowerCase();
    if (seen.has(documentId)) continue;
    // An absolute URL whose host merely ends like ours, e.g.
    // `https://evil.test/https://ours.test/s/…`, is matched from its tail;
    // refuse when the match is glued to the text before it.
    const start = match.index ?? 0;
    if (origin && start > 0 && match[0].startsWith(origin)) {
      if (!/[\s(<]/.test(body[start - 1])) continue;
    }
    seen.add(documentId);
    out.push({ documentId, at: atParam(match[3]) });
    if (out.length === MAX_REFS_PER_MESSAGE) break;
  }
  return out;
}

function atParam(tail: string | undefined): string | null {
  if (!tail || !tail.startsWith('?')) return null;
  const query = tail.slice(1).split('#')[0];
  // Trailing sentence punctuation is not part of the link.
  const params = new URLSearchParams(query.replace(/[.,!?;:'")\]]+$/, ''));
  return params.get('at');
}

/** The ref relation a message read includes, live documents only. */
export const REFS_INCLUDE = {
  where: { document: { deletedAt: null } },
  orderBy: { createdAt: 'asc' },
  select: {
    documentId: true,
    anchor: true,
    document: { select: { type: true, title: true, workspaceId: true } },
  },
} satisfies Prisma.ChatMessage$refsArgs;

export type RefRow = {
  documentId: string;
  anchor: Prisma.JsonValue;
  document: { type: string; title: string; workspaceId: string };
};

/**
 * Refs as the DTO carries them. A document moved to another workspace since
 * the message was posted drops out — its title is no longer this channel's
 * to show.
 */
export function toRefDtos(
  rows: RefRow[] | undefined,
  workspaceId: string,
): ChatDocumentRefDto[] {
  return (rows ?? [])
    .filter((r) => r.document.workspaceId === workspaceId)
    .map((r) => ({
      documentId: r.documentId,
      type: r.document.type,
      title: r.document.title,
      anchor: (r.anchor as ChatDocumentAnchor | null) ?? null,
    }));
}

const FILES_DEFAULT_LIMIT = 50;
const FILES_MAX_LIMIT = 100;
/** More channels than a switcher would ever weigh. */
const SHARED_IN_LIMIT = 20;

@Injectable()
export class ChatDocumentRefService {
  private readonly logger = new Logger(ChatDocumentRefService.name);
  private readonly origin: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.origin = frontendOrigin(config.get<string>('FRONTEND_URL'));
  }

  /**
   * Makes a message's refs match its body: the links it names now, each to a
   * live document of `channel`'s workspace. Run after a post or an edit has
   * committed. A failure is logged and answers no refs — the message stands
   * and its links render as plain links, which is what a retry would not
   * improve on. The stored refs are cleared to match, best effort, so an
   * edit whose sync failed does not keep a card (or a Files entry) for a
   * link its new body may no longer name.
   */
  async sync(
    messageId: string,
    channel: Pick<ChatChannel, 'id' | 'workspaceId'>,
    body: string,
  ): Promise<ChatDocumentRefDto[]> {
    try {
      const links = extractDocumentLinks(body, this.origin);
      const docs =
        links.length === 0
          ? []
          : await this.prisma.document.findMany({
              where: {
                id: { in: links.map((l) => l.documentId) },
                workspaceId: channel.workspaceId,
                deletedAt: null,
              },
              select: { id: true, type: true, title: true },
            });
      const byId = new Map(docs.map((d) => [d.id, d]));
      const refs = links.flatMap((link) => {
        const doc = byId.get(link.documentId);
        if (!doc) return [];
        // An `?at=` that is malformed, or not this type's shape, makes a
        // document-level card rather than a refused message.
        return [{ doc, anchor: decodeAnchor(link.at, doc.type) }];
      });
      const keep = refs.map((r) => r.doc.id);
      await this.prisma.$transaction([
        // An empty keep-list clears every row, said outright rather than
        // left to how an empty `notIn` compiles.
        this.prisma.chatDocumentRef.deleteMany({
          where:
            keep.length === 0
              ? { messageId }
              : { messageId, documentId: { notIn: keep } },
        }),
        // An edit that keeps a link keeps its `createdAt`, so the Files list
        // does not move a document to the top for a typo fix.
        ...refs.map(({ doc, anchor }) =>
          this.prisma.chatDocumentRef.upsert({
            where: { messageId_documentId: { messageId, documentId: doc.id } },
            create: {
              messageId,
              documentId: doc.id,
              channelId: channel.id,
              anchor: anchor ?? Prisma.DbNull,
            },
            update: { anchor: anchor ?? Prisma.DbNull },
          }),
        ),
      ]);
      return refs.map(({ doc, anchor }) => ({
        documentId: doc.id,
        type: doc.type,
        title: doc.title,
        anchor,
      }));
    } catch (err) {
      // The class and code only: a Prisma validation error renders the
      // arguments it was given, and those carry the anchor — a doc excerpt
      // of up to 200 characters of document content.
      this.logger.warn(
        `chat refs sync failed for ${messageId}: ${describeError(err)}`,
      );
      try {
        await this.prisma.chatDocumentRef.deleteMany({ where: { messageId } });
      } catch (clearErr) {
        this.logger.warn(
          `chat refs clear failed for ${messageId}: ${describeError(clearErr)}`,
        );
      }
      return [];
    }
  }

  /**
   * A channel's Files: each live document of its workspace that a visible
   * message names, once, at its most recent share, newest first. The caller
   * must already have passed `ChatChannelService.resolve` for the channel.
   * `before` is the `cursor` of the previous page's last row.
   */
  async files(
    channel: Pick<ChatChannel, 'id' | 'workspaceId'>,
    query: { limit?: number; before?: string },
  ): Promise<{ files: ChatFileDto[]; cursor: string | null }> {
    const limit = Math.min(
      Math.max(query.limit ?? FILES_DEFAULT_LIMIT, 1),
      FILES_MAX_LIMIT,
    );
    const cursor = parseCursor(query.before);
    const after = cursor
      ? Prisma.sql`WHERE (x."createdAt", x."documentId") < (${cursor.at}, ${cursor.documentId})`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      {
        documentId: string;
        messageId: string;
        anchor: Prisma.JsonValue;
        createdAt: Date;
        authorId: number | null;
        title: string;
        type: string;
      }[]
    >`
      SELECT * FROM (
        SELECT DISTINCT ON (r."documentId")
          r."documentId", r."messageId", r.anchor, r."createdAt",
          m."authorId", d.title, d.type
        FROM "ChatDocumentRef" r
        JOIN "ChatMessage" m
          ON m.id = r."messageId" AND m."channelId" = r."channelId"
        JOIN "Document" d ON d.id = r."documentId"
        WHERE r."channelId" = ${channel.id}
          AND m."deletedAt" IS NULL
          AND d."deletedAt" IS NULL
          AND d."workspaceId" = ${channel.workspaceId}
        ORDER BY r."documentId", r."createdAt" DESC
      ) x
      ${after}
      ORDER BY x."createdAt" DESC, x."documentId" DESC
      LIMIT ${limit + 1}`;
    const page = rows.slice(0, limit);
    const authorIds = [
      ...new Set(
        page.flatMap((r) => (r.authorId === null ? [] : [r.authorId])),
      ),
    ];
    const authors =
      authorIds.length === 0
        ? []
        : await this.prisma.user.findMany({
            where: { id: { in: authorIds } },
            select: { id: true, username: true, photo: true },
          });
    const byId = new Map<number, ChatUserSummary>(
      authors.map((a) => [a.id, a]),
    );
    const files = page.map((r) => ({
      documentId: r.documentId,
      type: r.type,
      title: r.title,
      anchor: (r.anchor as ChatDocumentAnchor | null) ?? null,
      messageId: r.messageId,
      sharedBy: r.authorId === null ? null : (byId.get(r.authorId) ?? null),
      sharedAt: r.createdAt.toISOString(),
    }));
    const last = page[page.length - 1];
    return {
      files,
      cursor:
        rows.length > limit && last
          ? `${last.createdAt.toISOString()}_${last.documentId}`
          : null,
    };
  }

  /**
   * The channels `documentId` was shared in that `userId` belongs to, each at
   * its latest share, most recent first. Membership is the whole gate past
   * the workspace check the caller makes: a channel member can read it, and a
   * public channel the user never joined is not "theirs" to open on. Archived
   * channels are left out — the panel cannot post in them — and so is a
   * document that is trashed or not in `workspaceId`, so the answer never
   * says more than the channel's own Files list would.
   */
  async sharedIn(
    userId: number,
    workspaceId: string,
    documentId: string,
  ): Promise<ChatSharedInDto[]> {
    const rows = await this.prisma.$queryRaw<
      { channelId: string; sharedAt: Date }[]
    >`
      SELECT r."channelId", MAX(r."createdAt") AS "sharedAt"
      FROM "ChatDocumentRef" r
      JOIN "ChatMessage" m
        ON m.id = r."messageId" AND m."channelId" = r."channelId"
      JOIN "ChatChannel" c ON c.id = r."channelId"
      JOIN "ChatChannelMember" cm
        ON cm."channelId" = c.id AND cm."userId" = ${userId}
      JOIN "Document" d ON d.id = r."documentId"
      WHERE r."documentId" = ${documentId}
        AND c."workspaceId" = ${workspaceId}
        AND c."archivedAt" IS NULL
        AND m."deletedAt" IS NULL
        AND d."workspaceId" = ${workspaceId}
        AND d."deletedAt" IS NULL
      GROUP BY r."channelId"
      ORDER BY "sharedAt" DESC, r."channelId"
      LIMIT ${SHARED_IN_LIMIT}`;
    return rows.map((r) => ({
      channelId: r.channelId,
      sharedAt: r.sharedAt.toISOString(),
    }));
  }
}

/** An error's class, plus its `code` when it has one — never its message. */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return typeof err;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? `${err.name} ${code}` : err.name;
}

const DOCUMENT_ID = new RegExp(`^${DOCUMENT_ID_SOURCE}$`);

/**
 * The instant shape `Date.toISOString` issues for a four-digit year. A cursor
 * is only ever one the server wrote, and the bound matters: JS dates reach
 * years Postgres's `timestamp` refuses, which would answer a 500.
 */
const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** `<ISO time>_<documentId>`, or undefined when absent or malformed. */
export function parseCursor(
  raw: string | undefined,
): { at: Date; documentId: string } | undefined {
  if (!raw) return undefined;
  const i = raw.indexOf('_');
  if (i <= 0) return undefined;
  if (!CURSOR_TIME.test(raw.slice(0, i))) return undefined;
  const at = new Date(raw.slice(0, i));
  const documentId = raw.slice(i + 1);
  if (Number.isNaN(at.getTime()) || !DOCUMENT_ID.test(documentId)) {
    return undefined;
  }
  return { at, documentId };
}
