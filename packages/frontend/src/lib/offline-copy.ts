import { Document } from "@yorkie-js/sdk";
import type { WafflebaseDocStore } from "./wafflebase-doc-store";

/**
 * Giving back work the SDK could not reconcile.
 *
 * Design: `docs/design/offline-local-persistence.md` § Losing work anyway.
 *
 * `LocalChangesDropped` fires on three unrecoverable paths: the document was
 * force-compacted while we were away, it was deleted or GC'd upstream, or the
 * stored envelope belongs to another identity. The SDK does not replay those
 * changes — it reports them and calls `remove`. The store archives rather than
 * deleting, and this turns those bytes back into content.
 *
 * Rather than a dialog offering a JSON download, the user gets a document, the
 * way Google Docs hands back a "(Conflicted copy)" file. Nothing here needs an
 * SDK change: `Document.fromBytes` and `restoreAppendedChanges` are both public.
 */

const SUFFIX = "(offline copy)";

/**
 * What a recovered document is called.
 *
 * Idempotent, because recovery can happen twice from one archive and a
 * recovered document can itself be archived — and "x (offline copy) (offline
 * copy)" tells the user nothing the first suffix did not.
 */
export function offlineCopyTitle(title: string): string {
  const base = title.trim() || "Untitled";
  return base.endsWith(SUFFIX) ? base : `${base} ${SUFFIX}`;
}

/** One archived document, as something the app can offer to restore. */
export interface RecoverableWork {
  /** The archive row this came from. */
  id: number;
  /** The SDK store key, `apiKey/clientKey/docKey`. */
  docKey: string;
  /** Just the document id, which is what routes and titles care about. */
  documentId: string;
  archivedAt: number;
}

/**
 * The document id inside an SDK store key.
 *
 * Keys are `apiKey/clientKey/docKey`, and only the last segment is the thing a
 * user recognises or a route can use. A key with no separators is already just
 * the document.
 */
function documentIdOf(docKey: string): string {
  const parts = docKey.split("/");
  return parts[parts.length - 1] || docKey;
}

/** Everything the store kept because it could not be reconciled. */
export async function listRecoverableWork(
  store: WafflebaseDocStore,
): Promise<Array<RecoverableWork>> {
  const archives = await store.listArchives();
  return archives.map((archive) => ({
    id: archive.id,
    docKey: archive.docKey,
    documentId: documentIdOf(archive.docKey),
    archivedAt: archive.archivedAt,
  }));
}

/** The shape the SDK's `restoreAppendedChanges` accepts. */
type ChangeStruct = Parameters<
  Document<unknown>["restoreAppendedChanges"]
>[0][number];

/** An archived document, rebuilt. */
export interface RehydratedArchive<R> {
  docKey: string;
  documentId: string;
  /** The content, including the edits made after the snapshot was taken. */
  root: R;
  /**
   * Whether the whole log made it in.
   *
   * False when replay stopped at a gap or an unreadable entry. The content is
   * then a true prefix of the user's work rather than all of it, and the
   * caller owes them that fact — a copy silently missing an edit is worse than
   * one labelled incomplete.
   */
  complete: boolean;
  /** How many log entries were replayed, of how many were stored. */
  replayed: number;
  of: number;
}

/**
 * Rebuilds an archived document from its snapshot and log.
 *
 * Replaying the log is the point, not an optimization: the snapshot alone is
 * the document as it stood *before* the unsent work, so a recovery that
 * replayed nothing would hand back precisely what the user did not lose.
 *
 * Answers `undefined` when the archive is missing or its bytes cannot be read.
 * A corrupt archive is one lost document; throwing would take the listing of
 * every other recoverable document with it.
 */
export async function rehydrateArchive<R>(
  store: WafflebaseDocStore,
  id: number,
): Promise<RehydratedArchive<R> | undefined> {
  const summaries = await store.listArchives();
  const summary = summaries.find((archive) => archive.id === id);
  if (!summary) {
    return undefined;
  }

  const stored = await store.loadArchive(id);
  if (!stored) {
    return undefined;
  }

  let doc: Document<R>;
  try {
    doc = Document.fromBytes<R>(summary.docKey, stored.snapshot);
  } catch {
    // Without a readable snapshot there is nothing to build on. One corrupt
    // archive is one lost document; throwing would take the listing of every
    // other recoverable document with it.
    return undefined;
  }

  // Replay stops at the first gap or unreadable entry rather than skipping it.
  // The SDK is explicit that the log must be contiguous and ascending, and the
  // reason is what makes truncation the only honest option here: a document
  // rebuilt from 2 and 4 is not the document the user had with 2, 3 and 4 —
  // it is a plausible-looking one missing an edit, handed back with no sign
  // that anything is absent. A prefix is at least true as far as it goes.
  const decoder = new TextDecoder();
  const replayable: Array<ChangeStruct> = [];
  let expected: number | undefined;
  let truncatedAt: number | undefined;

  for (const change of stored.changes) {
    if (expected !== undefined && change.clientSeq !== expected) {
      truncatedAt = change.clientSeq;
      break;
    }
    let struct: ChangeStruct;
    try {
      struct = JSON.parse(decoder.decode(change.bytes)) as ChangeStruct;
    } catch {
      truncatedAt = change.clientSeq;
      break;
    }
    replayable.push(struct);
    expected = change.clientSeq + 1;
  }

  try {
    if (replayable.length) {
      doc.restoreAppendedChanges(replayable);
    }
  } catch {
    // A run that decoded but would not apply. The snapshot alone still is the
    // document as the server last knew it, which is worth more than nothing.
    return {
      docKey: summary.docKey,
      documentId: documentIdOf(summary.docKey),
      root: Document.fromBytes<R>(
        summary.docKey,
        stored.snapshot,
      ).getRoot() as R,
      complete: false,
      replayed: 0,
      of: stored.changes.length,
    };
  }

  return {
    docKey: summary.docKey,
    documentId: documentIdOf(summary.docKey),
    root: doc.getRoot() as R,
    complete: truncatedAt === undefined,
    replayed: replayable.length,
    of: stored.changes.length,
  };
}
