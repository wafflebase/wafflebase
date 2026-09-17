import { Client, Document, Text } from "@yorkie-js/sdk";
import { fetchYorkieToken } from "@/api/auth";
import type { DocumentType } from "@/types/documents";
import { createDocument } from "@/api/documents";
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
  source: { title: string; type: DocumentType },
): Promise<RecoveryOutcome> {
  const rebuilt = await rehydrateArchive<never>(store, work.id);
  if (!rebuilt) {
    return { complete: false, refused: "unreadable" };
  }

  const title = offlineCopyTitle(source.title);

  if (source.type === "note") {
    const markdown = readNote(rebuilt.doc);
    if (!markdown) {
      return { complete: rebuilt.complete, refused: "empty" };
    }
    const created = await createDocument({ title, type: "note" });
    await writeNote(created.id, markdown);
    await store.dropArchive(work.id);
    return { documentId: created.id, title, complete: rebuilt.complete };
  }

  const content = readContent(source.type, rebuilt.doc);
  if (!content) {
    return { complete: rebuilt.complete, refused: "unsupported-type" };
  }

  const created = await createDocument({ title, type: source.type });
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
