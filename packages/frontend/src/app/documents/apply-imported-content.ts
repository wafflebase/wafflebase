import { Client, Document } from "@yorkie-js/sdk";
import { fetchYorkieToken } from "@/api/auth";
import { initialSpreadsheetDocument } from "@wafflebase/sheets";
import type { SpreadsheetDocument } from "@wafflebase/sheets";
import type { Document as DocsDocument } from "@wafflebase/docs";
import type { SlidesDocument } from "@wafflebase/slides";
import { initialDocsRoot, type YorkieDocsRoot } from "@/types/docs-document";
import type { YorkieSlidesRoot } from "@/types/slides-document";
import { YorkieDocStore } from "@/app/docs/yorkie-doc-store";
import { ensureSlidesRoot } from "@/app/slides/yorkie-slides-store";

/**
 * A parsed, client-side import ready to be written into its Yorkie document.
 * PDF is intentionally absent — its bytes are stored server-side at create
 * time via `fileId`, so it needs no CRDT content application.
 */
export type ImportedContent =
  | { type: "sheet"; document: SpreadsheetDocument }
  | { type: "doc"; document: DocsDocument }
  | { type: "slides"; document: SlidesDocument };

/**
 * The docKey Yorkie attaches to for each editable document type. Mirrors the
 * inline template literals the editor `DocumentProvider`s use
 * (`document-detail.tsx`, `docs-detail.tsx`, `slides-detail.tsx`).
 */
function buildDocKey(type: ImportedContent["type"], docId: string): string {
  switch (type) {
    case "doc":
      return `doc-${docId}`;
    case "slides":
      return `slides-${docId}`;
    case "sheet":
      return `sheet-${docId}`;
  }
}

/**
 * Persist parsed import content directly into its Yorkie document, headlessly.
 *
 * Historically this happened lazily: the upload flow stashed the parsed object
 * in an in-memory `pendingImports` map and the editor applied it on mount
 * (after `navigate`). With the deferred multi-file upload queue there is no
 * navigate — a batch can complete without any editor ever mounting — so the
 * stash-and-apply-on-mount model would leave the backend document empty and
 * silently lose the content on reload. Instead the worker calls this to attach
 * to the freshly-created document, apply the same root mutation the editor
 * would, and detach — so "done" means the content is actually persisted
 * server-side, independent of whether the user ever opens the document.
 *
 * The attach uses the same `initialRoot` the editor's `DocumentProvider` seeds,
 * so the subsequent apply behaves identically to the on-mount path. `detach`
 * flushes the pending local change to the server before the client is
 * deactivated.
 *
 * The per-type root writes below are intentionally kept in step with the
 * editor mount paths they mirror — sheets `document-detail.tsx`, docs
 * `docs-view.tsx` (`YorkieDocStore.setDocument`), slides `slides-view.tsx`
 * (`doc.update` + `ensureSlidesRoot`). If a new root field is added to one of
 * those overwrites, add it here too or queue-imported docs will silently drop
 * it on reload.
 *
 * A deliberate simplicity trade-off: one Yorkie `Client` is created per file
 * rather than shared across a batch. Imports are infrequent, user-initiated,
 * and capped at 2 concurrent, so the extra handshakes are acceptable next to
 * the race/lifecycle complexity a ref-counted shared client would add.
 *
 * Note: if `createDoc` already succeeded but this apply fails (transient Yorkie
 * outage / auth webhook not yet resolving write on the new docKey), the backend
 * document exists but is empty. The item lands in "error" (surfaced + retryable)
 * and a retry re-applies the content — the same create-then-populate exposure
 * the pre-queue single-file flow had.
 */
export async function applyImportedContent(
  docId: string,
  content: ImportedContent,
): Promise<void> {
  const client = new Client({
    rpcAddr: import.meta.env.VITE_YORKIE_RPC_ADDR,
    apiKey: import.meta.env.VITE_YORKIE_PUBLIC_KEY,
    authTokenInjector: fetchYorkieToken,
  });
  // activate() is intentionally outside the try/finally: if it throws there is
  // no active client to deactivate, and the caller sees the real activation
  // error rather than a masking cleanup error.
  await client.activate();
  try {
    const docKey = buildDocKey(content.type, docId);

    if (content.type === "sheet") {
      const parsed = content.document;
      const doc = new Document<SpreadsheetDocument>(docKey);
      await client.attach(doc, { initialRoot: initialSpreadsheetDocument() });
      // Same overwrite the sheets editor applies on mount
      // (document-detail.tsx).
      doc.update((r) => {
        r.tabs = parsed.tabs;
        r.tabOrder = parsed.tabOrder;
        r.sheets = parsed.sheets;
      });
      await client.detach(doc);
    } else if (content.type === "doc") {
      const doc = new Document<YorkieDocsRoot>(docKey);
      await client.attach(doc, { initialRoot: initialDocsRoot() });
      // Reuse the exact writer the docs editor uses on mount
      // (docs-view.tsx: `new YorkieDocStore(doc).setDocument(pending)`).
      new YorkieDocStore(doc).setDocument(content.document);
      await client.detach(doc);
    } else {
      const parsed = content.document;
      const doc = new Document<YorkieSlidesRoot>(docKey);
      await client.attach(doc, { initialRoot: {} });
      // Same overwrite the slides editor applies on mount (slides-view.tsx),
      // followed by the idempotent root backfill.
      doc.update((r) => {
        r.meta = { ...parsed.meta };
        r.themes = parsed.themes;
        r.masters = parsed.masters;
        r.layouts = parsed.layouts as unknown as YorkieSlidesRoot["layouts"];
        r.slides = parsed.slides as unknown as YorkieSlidesRoot["slides"];
      });
      ensureSlidesRoot(doc);
      await client.detach(doc);
    }
  } finally {
    // Never let a cleanup failure mask the real apply/attach error.
    try {
      await client.deactivate();
    } catch {
      /* best-effort teardown */
    }
  }
}
