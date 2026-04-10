import type { Document as DocsDocument } from "@wafflebase/docs";

/**
 * Module-level registry for pending DOCX imports.
 *
 * When the user imports a .docx from the document list, the flow is:
 *   1. Parse the .docx into a Docs `Document`.
 *   2. Create an empty backend document.
 *   3. Stash the parsed `Document` here, keyed by the new document's id.
 *   4. Navigate to `/d/:id`.
 *   5. After the editor mounts and the Yorkie Tree is initialized,
 *      the editor pulls the pending `Document` from this registry and
 *      applies it via `store.setDocument()`.
 *
 * A simple in-memory Map is sufficient — the import lives only for the
 * short window between navigation and editor mount within the same SPA
 * session. If the user reloads, the import is lost (acceptable trade-off
 * vs. persisting large documents in localStorage).
 */
const pendingImports = new Map<string, DocsDocument>();

export function setPendingImport(docId: string, doc: DocsDocument): void {
  pendingImports.set(docId, doc);
}

/**
 * Read a pending import without consuming it. Callers should prefer this
 * over `takePendingImport` when the apply step can fail, so the entry
 * can be retried (or explicitly dropped) after the failure is handled.
 */
export function peekPendingImport(docId: string): DocsDocument | undefined {
  return pendingImports.get(docId);
}

export function takePendingImport(docId: string): DocsDocument | undefined {
  const doc = pendingImports.get(docId);
  if (doc) pendingImports.delete(docId);
  return doc;
}

/**
 * Explicitly drop a pending import after it has been successfully applied.
 */
export function clearPendingImport(docId: string): void {
  pendingImports.delete(docId);
}
