import { mapMiroItems } from "@wafflebase/board";
import { isAuthExpiredError } from "@/api/auth";
import {
  openMiroImportStream,
  readMiroImportStream,
  type MiroImportProgress,
} from "@/api/miro";
import { deleteDocument } from "@/api/documents";
import { createWorkspaceDocument } from "@/api/workspaces";
import { resolveImageUrl } from "@/app/spreadsheet/image-upload";
import { applyImportedContent } from "./apply-imported-content";
import { getDocumentPath } from "./document-list-utils";
import { describeImportProgress } from "./miro-import-progress";
import { summarizeImport } from "./miro-import-summary";
import {
  enqueueExternal,
  patchItem,
  removeItem,
  settleExternal,
} from "./upload-queue";

/**
 * Run a Miro import in the background, reporting into the upload panel.
 *
 * ## Why this is a module function and not a hook/effect
 *
 * A 3000-element board takes 30-60s. The point of moving the readout to the
 * panel is that the user can close the dialog, navigate away, and keep
 * working while it finishes — so the thing driving the import must not be
 * owned by any component. Anything anchored to the dialog (component state, an
 * effect, an `AbortController` torn down on unmount) would cancel the import
 * the moment the dialog it was started from went away, which is precisely the
 * behavior being removed. This lives at module scope for the same reason the
 * queue's own worker does.
 *
 * ## Where the token lives
 *
 * In this function's arguments, for exactly as long as it takes to open the
 * request — and nowhere else. It is never written into the queue item: the
 * queue is a module singleton whose rows outlive the dialog by design, so
 * parking a credential there would extend its lifetime from "one request" to
 * "until the tab closes". `drive()` below takes the already-opened response,
 * so the long-lived half of this flow never closes over the token at all, and
 * cannot start a second request with it.
 */

/** Panel label for the row. Also the title of the document it creates. */
export const MIRO_ITEM_LABEL = "Miro board";
const MIRO_DOCUMENT_TITLE = "Imported Miro board";

const FALLBACK_ERROR = "Failed to import the Miro board";

export interface MiroImportRunnerDeps {
  openStream: typeof openMiroImportStream;
  readStream: typeof readMiroImportStream;
  mapItems: typeof mapMiroItems;
  resolveImageUrl: (url: string) => string;
  createDoc: (
    workspaceId: string,
    payload: { title: string; type: "board"; folderId?: string },
  ) => Promise<{ id: string; type?: string }>;
  applyContent: typeof applyImportedContent;
  deleteDoc: typeof deleteDocument;
  getDocumentPath: typeof getDocumentPath;
  enqueue: typeof enqueueExternal;
  patch: typeof patchItem;
  remove: typeof removeItem;
  settle: typeof settleExternal;
  isAuthExpired: typeof isAuthExpiredError;
}

const defaultDeps: MiroImportRunnerDeps = {
  openStream: openMiroImportStream,
  readStream: readMiroImportStream,
  mapItems: mapMiroItems,
  resolveImageUrl,
  createDoc: createWorkspaceDocument,
  applyContent: applyImportedContent,
  deleteDoc: deleteDocument,
  getDocumentPath,
  enqueue: enqueueExternal,
  patch: patchItem,
  remove: removeItem,
  settle: settleExternal,
  isAuthExpired: isAuthExpiredError,
};

export interface StartMiroImportInput {
  workspaceId: string;
  folderId?: string | null;
  token: string;
  boardUrl: string;
}

export interface StartedMiroImport {
  /** The upload-panel row now reporting this import. */
  itemId: string;
  /**
   * Resolves when the background half has reached a terminal state. Never
   * rejects — every failure is reported on the row instead. Production callers
   * ignore it; tests await it instead of polling.
   */
  finished: Promise<void>;
}

/**
 * Start an import and resolve once it is genuinely underway.
 *
 * The await boundary here is the same one the backend controller draws: the
 * server does board-id parsing and the first authenticated Miro call with the
 * status still open, so an empty/invalid token, a board the user cannot read,
 * and a board that does not exist all arrive as a rejected promise from
 * `openStream` — BEFORE any row exists. Those belong in the form the user
 * still has open, so they are thrown back to the caller and no panel row is
 * created for them. Once the response has committed to a 200 the import is
 * running and every later failure is reported on the row.
 */
export async function startMiroImport(
  input: StartMiroImportInput,
  overrides: Partial<MiroImportRunnerDeps> = {},
): Promise<StartedMiroImport> {
  const deps = { ...defaultDeps, ...overrides };

  // --- pre-stream: the caller is still awaiting, errors go back to the form
  const stream = await deps.openStream(input.workspaceId, {
    token: input.token,
    boardUrl: input.boardUrl,
  });

  // --- committed: the token has been sent and is not referenced again below
  const itemId = deps.enqueue({
    fileName: MIRO_ITEM_LABEL,
    kind: "board",
    workspaceId: input.workspaceId,
    folderId: input.folderId,
  });

  const finished = drive(
    stream,
    { itemId, workspaceId: input.workspaceId, folderId: input.folderId },
    deps,
  );
  return { itemId, finished };
}

/** The long-running half. Owns the row from the first progress line onward. */
async function drive(
  stream: Response,
  ctx: { itemId: string; workspaceId: string; folderId?: string | null },
  deps: MiroImportRunnerDeps,
): Promise<void> {
  const { itemId } = ctx;
  try {
    const result = await deps.readStream(stream, (progress) =>
      deps.patch(itemId, toItemProgress(progress)),
    );

    const { inits, skipped, approximated } = deps.mapItems({
      items: result.items,
      connectors: result.connectors,
      // The backend hands back root-relative image URLs; the API is on
      // another origin, so they have to be absolute before they are
      // persisted. Same resolver the native image upload applies.
      resolveImageUrl: deps.resolveImageUrl,
    });

    deps.patch(itemId, {
      status: "uploading",
      detail: "Creating…",
      done: 0,
      total: 0,
    });
    const doc = await deps.createDoc(ctx.workspaceId, {
      title: MIRO_DOCUMENT_TITLE,
      type: "board",
      folderId: ctx.folderId ?? undefined,
    });
    const docId = String(doc.id);
    // Persist the id before the apply, so a failure that skips the cleanup
    // below (an auth expiry, a reload) still leaves the panel row able to
    // clean the orphan up on dismiss.
    deps.patch(itemId, { docId });

    let applied;
    try {
      applied = await deps.applyContent(docId, {
        type: "board",
        elements: inits,
      });
    } catch (applyErr) {
      // The document exists but is empty. Leaving it behind means every
      // attempt adds another orphaned "Imported Miro board" to the user's
      // list, so clean it up before surfacing the real error. The delete is
      // best-effort: its failure must not replace the error worth reporting.
      try {
        await deps.deleteDoc(docId);
        // Deleted, so the row must stop claiming a document — otherwise
        // dismissing it would try to delete the same id a second time.
        deps.patch(itemId, { docId: undefined });
      } catch {
        /* best-effort cleanup */
      }
      throw applyErr;
    }

    // Everything the import did not carry over faithfully. Reported through
    // the row's `warning` — the same channel a lossy PPTX import uses — so the
    // host's settled callback surfaces it in one place for every import kind,
    // rather than this module growing its own toast.
    const summary = summarizeImport({
      skipped,
      approximated,
      droppedConnectors: applied.droppedConnectors,
      notes: result.notes ?? [],
    });

    deps.patch(itemId, {
      status: "done",
      docId,
      docPath: deps.getDocumentPath({ id: docId, type: "board" }),
      detail: undefined,
      warning: summary ?? undefined,
    });
    deps.settle(itemId);
  } catch (err) {
    if (deps.isAuthExpired(err)) {
      // The session expired and the app is already redirecting to login. A
      // row shouting about a failed import is noise about the wrong problem,
      // and it would outlive the redirect in the panel.
      deps.remove(itemId);
      return;
    }
    deps.patch(itemId, {
      status: "error",
      detail: undefined,
      reason: err instanceof Error ? err.message : FALLBACK_ERROR,
    });
    deps.settle(itemId);
  }
}

/**
 * Map one streamed progress line onto the row.
 *
 * `images` is the only stage whose size is known up front, so it is the only
 * one that can drive the panel's `done/total` fraction; the earlier stages
 * report a running count with no denominator and rely on `detail`. Reading the
 * board is reported as `parsing` and writing it as `uploading`, matching what
 * those statuses mean for a file.
 */
function toItemProgress(progress: MiroImportProgress) {
  return {
    status: progress.stage === "images" ? ("uploading" as const) : ("parsing" as const),
    done: progress.done,
    total: progress.total ?? 0,
    detail: describeImportProgress(progress),
  };
}
