import { Client, Document } from "@yorkie-js/sdk";
import { fetchYorkieToken } from "@/api/auth";
import { initialSpreadsheetDocument } from "@wafflebase/sheets";
import type { SpreadsheetDocument } from "@wafflebase/sheets";
import type { Document as DocsDocument } from "@wafflebase/docs";
import type {
  ElementInit,
  Endpoint,
  SlidesDocument,
  SlidesStore,
} from "@wafflebase/slides";
import { SYNTHETIC_SLIDE_ID } from "@wafflebase/board";
import { initialDocsRoot, type YorkieDocsRoot } from "@/types/docs-document";
import type { YorkieSlidesRoot } from "@/types/slides-document";
import { initialBoardRoot, type YorkieBoardRoot } from "@/types/board-document";
import { YorkieDocStore } from "@/app/docs/yorkie-doc-store";
import { ensureSlidesRoot } from "@/app/slides/yorkie-slides-store";
import { YorkieBoardStore } from "@/app/board/yorkie-board-store";

/**
 * A parsed, client-side import ready to be written into its Yorkie document.
 * PDF is intentionally absent — its bytes are stored server-side at create
 * time via `fileId`, so it needs no CRDT content application.
 */
export type ImportedContent =
  | { type: "sheet"; document: SpreadsheetDocument }
  | { type: "doc"; document: DocsDocument }
  | { type: "slides"; document: SlidesDocument }
  | { type: "board"; elements: ElementInit[] };

/**
 * The docKey Yorkie attaches to for each editable document type. Mirrors the
 * inline template literals the editor `DocumentProvider`s use
 * (`document-detail.tsx`, `docs-detail.tsx`, `slides-detail.tsx`,
 * `board-detail.tsx`).
 */
function buildDocKey(type: ImportedContent["type"], docId: string): string {
  switch (type) {
    case "doc":
      return `doc-${docId}`;
    case "slides":
      return `slides-${docId}`;
    case "sheet":
      return `sheet-${docId}`;
    case "board":
      return `board-${docId}`;
  }
}

/** An init carrying the mapper's local handle, as `mapMiroItems` emits them. */
type MappedInit = ElementInit & { __id?: string };

/**
 * Rewrite a connector endpoint from the mapper's local handle onto the id the
 * store actually minted. Returns null when the handle has no real id, which
 * means the connector cannot be written honestly.
 */
function remapEndpoint(
  endpoint: Endpoint,
  realIds: Map<string, string>,
): Endpoint | null {
  if (endpoint.kind !== "attached") return endpoint;
  const elementId = realIds.get(endpoint.elementId);
  return elementId ? { ...endpoint, elementId } : null;
}

/**
 * Write every mapped element onto the board in ONE batch — a single Yorkie
 * change and a single undo unit. Driving the store (rather than assigning
 * `root.elements` directly) reuses its connector-frame computation and
 * text/connector normalization.
 *
 * Two passes, because the ids the mapper wired connectors to are NOT the ids
 * the document gets. `mapMiroItems` mints its own handles and records them on
 * `__id`; `addElement` mints a fresh id of its own and returns it, and that one
 * wins. Writing the mapper's `__id` through verbatim produced connectors
 * anchored to elements no document ever contained — `resolveEndpoint` falls
 * back to (0, 0) for an unresolvable attached id, so every arrow collapsed into
 * a ~1x1 frame at the world origin: invisible, nowhere near the content, and
 * reported to the user as a clean import.
 *
 * So: pass 1 writes every non-connector element and builds `__id → real id`
 * from `addElement`'s return value; pass 2 writes the connectors with their
 * endpoints rewritten through that map. The split is driven off
 * `el.type === "connector"`, never off array order — connectors arrive from a
 * separate Miro feed, so nothing orders them after their targets.
 *
 * A connector whose endpoint fails to remap is DROPPED and counted rather than
 * written dangling. The mapper already guarantees both ends resolve, so the
 * count should always be zero; it is returned anyway because a silent drop is
 * the exact failure mode this import is built to avoid, and the caller folds a
 * non-zero count into the user-facing summary.
 *
 * `__id` is not part of the model, so it is stripped on the way in.
 */
export function applyBoardElements(
  store: Pick<SlidesStore, "batch" | "addElement">,
  elements: ElementInit[],
): { droppedConnectors: number } {
  if (elements.length === 0) return { droppedConnectors: 0 };

  let droppedConnectors = 0;
  store.batch(() => {
    const realIds = new Map<string, string>();
    const connectors: MappedInit[] = [];

    // Pass 1 — every non-connector element, recording the id the store minted.
    for (const element of elements) {
      const mapped = element as MappedInit;
      if (mapped.type === "connector") {
        connectors.push(mapped);
        continue;
      }
      const { __id, ...init } = mapped;
      const realId = store.addElement(SYNTHETIC_SLIDE_ID, init as ElementInit);
      if (__id) realIds.set(__id, realId);
    }

    // Pass 2 — connectors, with endpoints pointed at the real elements.
    for (const connector of connectors) {
      const { __id, ...init } = connector as MappedInit & {
        start: Endpoint;
        end: Endpoint;
      };
      void __id;
      const start = remapEndpoint(init.start, realIds);
      const end = remapEndpoint(init.end, realIds);
      if (!start || !end) {
        droppedConnectors++;
        continue;
      }
      store.addElement(SYNTHETIC_SLIDE_ID, {
        ...init,
        start,
        end,
      } as unknown as ElementInit);
    }
  });

  return { droppedConnectors };
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
/**
 * What the apply had to give up on, for callers that report it.
 *
 * Only the board branch can currently drop anything; every other type is
 * a whole-root overwrite that either lands or throws. The queue-driven
 * callers ignore this — the Miro dialog folds it into its summary.
 */
export interface ImportApplyResult {
  droppedConnectors: number;
}

export async function applyImportedContent(
  docId: string,
  content: ImportedContent,
): Promise<ImportApplyResult> {
  let result: ImportApplyResult = { droppedConnectors: 0 };
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
    } else if (content.type === "board") {
      const doc = new Document<YorkieBoardRoot>(docKey);
      await client.attach(doc, { initialRoot: initialBoardRoot() });
      const store = new YorkieBoardStore(doc);
      try {
        result = applyBoardElements(store, content.elements);
      } finally {
        // The store subscribes to the doc in its constructor — release it
        // before detaching.
        store.dispose();
      }
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
    return result;
  } finally {
    // Never let a cleanup failure mask the real apply/attach error.
    try {
      await client.deactivate();
    } catch {
      /* best-effort teardown */
    }
  }
}
