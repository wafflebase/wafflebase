import { Client, Document, Text } from "@yorkie-js/sdk";
import { fetchMe, fetchYorkieToken } from "@/api/auth";
import type { DocumentType } from "@/types/documents";
import {
  createWorkspaceDocument,
  fetchWorkspace,
  fetchWorkspaces,
} from "@/api/workspaces";
import type { ImportedContent } from "@/app/documents/apply-imported-content";
import { applyImportedContent } from "@/app/documents/apply-imported-content";
import { YorkieDocStore } from "@/app/docs/yorkie-doc-store";
import { YorkieSlidesStore } from "@/app/slides/yorkie-slides-store";
import { YorkieBoardStore } from "@/app/board/yorkie-board-store";
import type { WafflebaseDocStore } from "./wafflebase-doc-store";
import {
  offlineCopyTitle,
  rehydrateArchive,
  type RecoverableWork,
} from "./offline-copy";

/**
 * Turning archived bytes into a document the user can open.
 *
 * `offline-copy.ts` rebuilds the content; this puts it somewhere. The two are
 * separate because the rebuild is pure and the placement is not — it creates a
 * document over the network and writes into a live Yorkie client, and it is the
 * half that can half-happen.
 *
 * Design: `docs/design/offline-local-persistence.md` § Losing work anyway.
 */

/**
 * Reads a rehydrated document through the same reader its editor uses.
 *
 * Deliberately not `JSON.parse(doc.toJSON())` plus the snapshot adapters from
 * `components/history/snapshot-adapters.ts`. Those parse the *server's* YSON
 * dialect, which disagrees with the live-proxy dialect in two places — and,
 * as that file says at length, neither disagreement throws: it yields a
 * document whose every block falls back to a plain paragraph, "plausible
 * content that is not what the user wrote". A rehydrated archive is a live
 * document, so the live readers are the correct ones.
 */
/**
 * Whether this is a type an archive can be rebuilt into at all.
 *
 * Asked separately from reading, because `readContent` answers `undefined` to
 * two different questions — "there is no reader for this type" and "the reader
 * found nothing in it" — and the person on the other end needs to be told
 * which. Told the first when it was really the second, they are informed their
 * document is a kind that cannot be recovered, which is both false and
 * unactionable; the archive stays, so the same wrong sentence returns every
 * session.
 */
function canRebuild(type: DocumentType): boolean {
  return (
    type === "sheet" ||
    type === "doc" ||
    type === "slides" ||
    type === "board" ||
    type === "note"
  );
}

function readContent(
  type: DocumentType,
  doc: Document<never>,
): ImportedContent | undefined {
  switch (type) {
    case "sheet": {
      const root = doc.getRoot() as unknown as ImportedContent & {
        tabs?: unknown;
      };
      if (!root.tabs) return undefined;
      return {
        type: "sheet",
        document: JSON.parse(doc.toJSON()),
      } as ImportedContent;
    }
    case "doc": {
      const store = new YorkieDocStore(doc as never);
      try {
        return { type: "doc", document: store.getDocument() };
      } finally {
        store.dispose();
      }
    }
    case "slides": {
      const store = new YorkieSlidesStore(doc as never);
      try {
        return { type: "slides", document: store.read() };
      } finally {
        store.dispose();
      }
    }
    case "board": {
      const store = new YorkieBoardStore(doc as never);
      try {
        return {
          type: "board",
          elements: store.read().slides[0]?.elements ?? [],
        } as ImportedContent;
      } finally {
        store.dispose();
      }
    }
    default:
      // note, pdf, image, file. `pdf` never persists (it is excluded from the
      // opt-in), and the blob types have no CRDT to recover. `note` is handled
      // by the caller, because its content is a string rather than an engine
      // document and `applyImportedContent` has no branch for it.
      return undefined;
  }
}

/** The plain markdown a note's rehydrated root holds. */
function readNote(doc: Document<never>): string {
  const root = doc.getRoot() as unknown as { content?: { toString(): string } };
  return root.content ? root.content.toString() : "";
}

/**
 * The document type prefixes every CRDT docKey carries, and what they mean.
 *
 * `pdf-` is absent deliberately: those documents are excluded from the opt-in,
 * so an archive under that prefix cannot exist — and if one somehow did, there
 * is no document to hand it back as.
 */
const TYPE_PREFIXES: Array<[string, DocumentType]> = [
  ["sheet-", "sheet"],
  ["slides-", "slides"],
  ["board-", "board"],
  ["note-", "note"],
  ["doc-", "doc"],
];

/**
 * What an archived store key is a document of, and which document.
 *
 * Read off the key rather than fetched, because one of the three loss paths is
 * "the document was deleted upstream" — so the server is exactly the thing
 * that may no longer be able to answer. `undefined` for a key that matches
 * nothing, which is left archived rather than guessed at.
 *
 * `doc-` is matched last: every prefix here is distinct, but ordering it after
 * the others keeps the rule readable as "the specific ones, then the general".
 */
export function describeArchivedDocument(
  docKey: string,
): { id: string; type: DocumentType } | undefined {
  const parts = docKey.split("/");
  const key = parts[parts.length - 1] || docKey;
  for (const [prefix, type] of TYPE_PREFIXES) {
    if (key.startsWith(prefix)) {
      const id = key.slice(prefix.length);
      return id ? { id, type } : undefined;
    }
  }
  return undefined;
}

/** Where a recovered copy will be created, and who else will be able to read it. */
export interface RecoveryDestination {
  id: string;
  /** The workspace's name, when the copy is not going back where it came from. */
  name?: string;
  /**
   * Whether anybody other than this user can read what is put there.
   *
   * The caller has to say so before it offers the copy: recovery is the one
   * path that *publishes* local content, and a workspace with other members in
   * it is an audience the archived document never had.
   */
  shared: boolean;
}

/**
 * Which workspace the copy is created in.
 *
 * A document is never workspace-less: `POST /documents` is bound to
 * `CreateDocumentInWorkspaceDto`, whose `workspaceId` is `@IsUUID()` and not
 * optional, so a create without one is a `400` before it reaches any handler.
 * Recovery used to send exactly that, which made "Save a copy" fail every
 * single time — on the one path the whole feature exists to reach.
 *
 * The source document's own workspace is the right answer and the caller
 * supplies it where it still has one. Sending the copy there exposes the
 * content to nobody new — whoever could read the original can read the copy.
 *
 * It may not have one: "the document was deleted upstream" is one of the three
 * ways an archive comes to exist, and a deleted document answers nothing. The
 * fallback used to take `fetchWorkspaces()[0]`, which is *every* workspace the
 * user belongs to — including a shared team one they merely joined. Recovery
 * then republished a private document's full content to that team, silently,
 * with the user told only that a copy had been saved.
 *
 * So the fallback prefers a workspace the user is the **sole member** of,
 * which is an audience of one and therefore no disclosure at all. Only when
 * there is none does it fall back to the first workspace — and it reports
 * `shared: true` for it, which is what obliges the caller to name the
 * destination before the user agrees to the copy. Handing the work back
 * somewhere still beats refusing because its original home was deleted; doing
 * it without saying where is what was wrong.
 */
export async function resolveRecoveryDestination(
  given?: string,
): Promise<RecoveryDestination> {
  if (given) {
    return { id: given, shared: false };
  }
  const workspaces = await fetchWorkspaces();
  if (workspaces.length === 0) {
    throw new Error("no workspace is available to recover this work into");
  }

  // A failure here is not fatal — it only costs the private-workspace search,
  // and the `shared: true` answer below is the safe direction: the caller names
  // the destination rather than assuming it is private.
  let me: string | undefined;
  try {
    me = String((await fetchMe()).id);
  } catch {
    me = undefined;
  }

  if (me !== undefined) {
    for (const workspace of workspaces) {
      const detail = await fetchWorkspace(workspace.id).catch(() => undefined);
      if (!detail) continue;
      const others = detail.members.filter(
        (member) => String(member.user.id) !== me,
      );
      if (others.length === 0) {
        return { id: workspace.id, name: workspace.name, shared: false };
      }
    }
  }

  return { id: workspaces[0].id, name: workspaces[0].name, shared: true };
}

async function destinationWorkspace(given?: string): Promise<string> {
  return (await resolveRecoveryDestination(given)).id;
}

export interface RecoveryOutcome {
  /** The new document, when one was created. */
  documentId?: string;
  title?: string;
  /** Whether the whole archived log made it in. */
  complete: boolean;
  /** Why nothing was created, when nothing was. */
  refused?: "unreadable" | "unsupported-type" | "empty";
}

/**
 * Creates `<title> (offline copy)` and writes the archived work into it.
 *
 * The archive is dropped **only after** the content is written. A crash between
 * the two leaves the archive in place, so the work is offered again rather than
 * lost — the copy is duplicated at worst, and a duplicate document is a far
 * smaller harm than a deleted one.
 */
export async function recoverOfflineCopy(
  store: WafflebaseDocStore,
  work: RecoverableWork,
  source: { title: string; type: DocumentType; workspaceId?: string },
): Promise<RecoveryOutcome> {
  const rebuilt = await rehydrateArchive<never>(store, work.id);
  if (!rebuilt) {
    return { complete: false, refused: "unreadable" };
  }

  const title = offlineCopyTitle(source.title);

  if (!canRebuild(source.type)) {
    return { complete: rebuilt.complete, refused: "unsupported-type" };
  }

  if (source.type === "note") {
    const markdown = readNote(rebuilt.doc);
    if (!markdown) {
      return { complete: rebuilt.complete, refused: "empty" };
    }
    const created: { id: string } = await createWorkspaceDocument(
      await destinationWorkspace(source.workspaceId),
      { title, type: "note" },
    );
    await writeNote(created.id, markdown);
    await store.dropArchive(work.id);
    return { documentId: created.id, title, complete: rebuilt.complete };
  }

  const content = readContent(source.type, rebuilt.doc);
  if (!content) {
    // The type is one we rebuild — `canRebuild` said so above — so a reader
    // that found nothing means the archive held nothing, not that the document
    // is unrecoverable in kind.
    return { complete: rebuilt.complete, refused: "empty" };
  }

  const created: { id: string } = await createWorkspaceDocument(
    await destinationWorkspace(source.workspaceId),
    { title, type: source.type },
  );
  await applyImportedContent(created.id, content);
  await store.dropArchive(work.id);
  return { documentId: created.id, title, complete: rebuilt.complete };
}

/**
 * Writes a note's markdown into a freshly created note document.
 *
 * `applyImportedContent` has no note branch, because a note is not an engine
 * document — it is one Yorkie `Text` at `root.content`, byte-compatible with
 * CodePair. Seeding it is a single edit rather than a store round trip.
 *
 * Mirrors `applyImportedContent`'s own lifecycle: `activate()` sits outside the
 * `try` so an activation failure surfaces as itself rather than as a masking
 * cleanup error.
 */
async function writeNote(docId: string, markdown: string): Promise<void> {
  const client = new Client({
    rpcAddr: import.meta.env.VITE_YORKIE_RPC_ADDR,
    apiKey: import.meta.env.VITE_YORKIE_PUBLIC_KEY,
    authTokenInjector: fetchYorkieToken,
  });
  await client.activate();
  try {
    const doc = new Document<{ content?: Text }>(`note-${docId}`);
    await client.attach(doc);
    doc.update((root) => {
      root.content = new Text();
      root.content.edit(0, 0, markdown);
    });
    await client.detach(doc);
  } finally {
    if (client.isActive()) {
      await client.deactivate();
    }
  }
}
