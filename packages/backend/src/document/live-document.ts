import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * The trash invariant (docs/design/document-trash.md): a document whose
 * `deletedAt` is set is **invisible everywhere a live one is visible**. It is
 * not listed, not readable, not writable, not copyable and not reachable
 * through a share link, the Yorkie auth webhook, a template, or `/api/v1` —
 * every one of those answers as if the row did not exist (404 / deny). The
 * only routes that see it are the trash itself: the workspace trash list,
 * restore, and permanent delete.
 *
 * Read paths enforce it with these two helpers rather than an ad-hoc
 * `deletedAt` check, so a grep for `LIVE_DOCUMENT` / `isLiveDocument` is the
 * audit of every gated path:
 *
 * - `LIVE_DOCUMENT` is merged into a Prisma `where` (a `findMany`, or an
 *   extended-unique `findUnique`) when the query itself selects documents.
 * - `isLiveDocument` checks a row that arrived through a relation
 *   (`include: { document: true }`), where the filter cannot be pushed into
 *   the query without changing what the parent lookup returns.
 */
export const LIVE_DOCUMENT = {
  deletedAt: null,
} as const satisfies Prisma.DocumentWhereInput;

/** Trashed documents only — the inverse of {@link LIVE_DOCUMENT}. */
export const TRASHED_DOCUMENT = {
  deletedAt: { not: null },
} as const satisfies Prisma.DocumentWhereInput;

/**
 * Whether a loaded document row is live. `null` / `undefined` (a missing row,
 * or a relation that was not loaded) is not live.
 */
export function isLiveDocument<T extends { deletedAt?: Date | null }>(
  doc: T | null | undefined,
): doc is T {
  return doc != null && doc.deletedAt == null;
}

/**
 * Throw the same 404 a missing document gets when `doc` is absent or trashed.
 * Deliberately indistinguishable from "never existed": whether a document is
 * in the trash is itself information a share-link holder should not learn.
 */
export function assertLiveDocument<T extends { deletedAt?: Date | null }>(
  doc: T | null | undefined,
  message = 'Document not found',
): T {
  if (!isLiveDocument(doc)) throw new NotFoundException(message);
  return doc;
}
