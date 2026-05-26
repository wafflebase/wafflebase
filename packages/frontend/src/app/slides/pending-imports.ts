import type { SlidesDocument } from "@wafflebase/slides";

/**
 * Module-level registry for pending PPTX imports — mirrors the docs
 * package's `docs/pending-imports.ts`.
 *
 * Flow:
 *   1. User picks a .pptx from the document list; `importPptx` parses
 *      it client-side and uploads embedded images to /images.
 *   2. The list creates a new backend slides document (empty).
 *   3. The parsed `SlidesDocument` is stashed here by the new doc id.
 *   4. Navigation to `/p/:id` mounts `SlidesView`.
 *   5. Before `ensureSlidesRoot` runs, the view consumes the pending
 *      entry and pushes the imported deck onto the Yorkie root.
 *
 * A reload between steps 4 and 5 loses the in-memory entry — the
 * trade-off is no large objects in localStorage.
 */
const pendingImports = new Map<string, SlidesDocument>();

export function setPendingImport(docId: string, doc: SlidesDocument): void {
  pendingImports.set(docId, doc);
}

/**
 * Read a pending entry without consuming it. The caller takes it only
 * after a successful apply so a partial failure can be retried on the
 * next mount.
 */
export function peekPendingImport(docId: string): SlidesDocument | undefined {
  return pendingImports.get(docId);
}

export function clearPendingImport(docId: string): void {
  pendingImports.delete(docId);
}
