import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatChannel, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  ChatDocumentAnchor,
  ChatDocumentRefDto,
  ChatFileDto,
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

/** The editor routes in `packages/frontend/src/App.tsx`. */
const ROUTE_PREFIXES = 's|d|p|n|b|f';
/** Document ids are uuids; anything else is not looked up. */
const UUID =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
/** A body names at most this many cards; the rest stay plain links. */
export const MAX_REFS_PER_MESSAGE = 10;
/** An `?at=` longer than this is not decoded. */
const MAX_ANCHOR_PARAM = 2_048;
const MAX_ID = 128;
const MAX_EXCERPT = 200;
const MAX_LABEL = 80;
const MAX_SPAN = 100_000;

export interface DocumentLink {
  documentId: string;
  /** The raw `?at=` value, undecoded; null when absent. */
  at: string | null;
}

/**
 * The frontend's public base — origin plus router basename, no trailing
 * slash — from `FRONTEND_URL`, or undefined when it is unset or not http(s).
 */
export function frontendBase(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
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
 * this deployment's frontend (`base`, which may carry a basename), and a
 * root-relative path standing on its own (`/s/<id>` at the start of the body
 * or after whitespace or an opening bracket). Any other origin is somebody
 * else's site — its `/s/<id>` names nothing here.
 */
export function extractDocumentLinks(
  body: string,
  base: string | undefined,
): DocumentLink[] {
  const prefix = base
    ? `(?:${escapeRegExp(base)}|(?<=^|[\\s(<]))`
    : '(?<=^|[\\s(<])';
  const re = new RegExp(
    `${prefix}/(?:${ROUTE_PREFIXES})/(${UUID})(?![0-9A-Za-z-])([?#][^\\s<>"]*)?`,
    'g',
  );
  const out: DocumentLink[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(re)) {
    // Ids are stored lowercase (Prisma's `uuid()`); compare that way.
    const documentId = match[1].toLowerCase();
    if (seen.has(documentId)) continue;
    // An absolute URL whose host merely ends like ours, e.g.
    // `https://evil.test/https://ours.test/s/…`, is matched from its tail;
    // refuse when the match is glued to the text before it.
    const start = match.index ?? 0;
    if (base && start > 0 && match[0].startsWith(base)) {
      if (!/[\s(<]/.test(body[start - 1])) continue;
    }
    seen.add(documentId);
    out.push({ documentId, at: atParam(match[2]) });
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

/** base64url (no padding) of UTF-8 JSON, as the frontend writes it. */
function decodeAt(raw: string): unknown {
  if (raw.length > MAX_ANCHOR_PARAM || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
}

function isId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID;
}

function isSpan(v: unknown): v is number {
  return (
    typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_SPAN
  );
}

function optionalText(v: unknown, max: number): string | undefined | null {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || v.length > max) return null;
  return v;
}

/**
 * The anchor stored for a document of `type`, or null. Only the fields the
 * type defines are kept, each checked, so a stored anchor is always one the
 * frontend can apply; anything malformed is a document-level link rather
 * than a refused message. `label` is an optional display snapshot taken by
 * the sender (`Sheet1!C3:E7`, `Slide 3`) — the chat cannot resolve axis ids
 * or slide ids to names without loading the document.
 */
export function parseAnchor(
  raw: string | null,
  type: string,
): ChatDocumentAnchor | null {
  if (raw === null) return null;
  const v = decodeAt(raw);
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const a = v as Record<string, unknown>;
  const label = optionalText(a.label, MAX_LABEL);
  if (label === null) return null;
  const withLabel = <T extends object>(o: T) =>
    label === undefined ? o : { ...o, label };
  switch (type) {
    case 'sheet':
      if (
        !isId(a.tabId) ||
        !isId(a.rowId) ||
        !isId(a.colId) ||
        !isSpan(a.rowSpan) ||
        !isSpan(a.colSpan)
      ) {
        return null;
      }
      return withLabel({
        tabId: a.tabId,
        rowId: a.rowId,
        colId: a.colId,
        rowSpan: a.rowSpan,
        colSpan: a.colSpan,
      });
    case 'doc': {
      if (!isId(a.blockId)) return null;
      const excerpt = optionalText(a.excerpt, MAX_EXCERPT);
      if (excerpt === null) return null;
      return withLabel(
        excerpt === undefined
          ? { blockId: a.blockId }
          : { blockId: a.blockId, excerpt },
      );
    }
    case 'slides':
      if (!isId(a.slideId)) return null;
      return withLabel({ slideId: a.slideId });
    default:
      return null;
  }
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

@Injectable()
export class ChatDocumentRefService {
  private readonly logger = new Logger(ChatDocumentRefService.name);
  private readonly base: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.base = frontendBase(config.get<string>('FRONTEND_URL'));
  }

  /**
   * Makes a message's refs match its body: the links it names now, each to a
   * live document of `channel`'s workspace. Run after a post or an edit has
   * committed. A failure is logged and answers no refs — the message stands
   * and its links render as plain links, which is what a retry would not
   * improve on.
   */
  async sync(
    messageId: string,
    channel: Pick<ChatChannel, 'id' | 'workspaceId'>,
    body: string,
  ): Promise<ChatDocumentRefDto[]> {
    try {
      const links = extractDocumentLinks(body, this.base);
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
        return [{ doc, anchor: parseAnchor(link.at, doc.type) }];
      });
      const keep = refs.map((r) => r.doc.id);
      await this.prisma.$transaction([
        this.prisma.chatDocumentRef.deleteMany({
          where: { messageId, documentId: { notIn: keep } },
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
      this.logger.warn(
        `chat refs sync failed for ${messageId}: ${String(err)}`,
      );
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
        JOIN "ChatMessage" m ON m.id = r."messageId"
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
}

/** `<ISO time>_<documentId>`, or undefined when absent or malformed. */
function parseCursor(
  raw: string | undefined,
): { at: Date; documentId: string } | undefined {
  if (!raw) return undefined;
  const i = raw.indexOf('_');
  if (i <= 0) return undefined;
  const at = new Date(raw.slice(0, i));
  const documentId = raw.slice(i + 1);
  if (Number.isNaN(at.getTime()) || !isId(documentId)) return undefined;
  return { at, documentId };
}
