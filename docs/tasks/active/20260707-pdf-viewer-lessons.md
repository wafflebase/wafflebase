# PDF Viewer — Lessons

Design: `docs/design/pdf.md` · Plan: `20260707-pdf-viewer-todo.md`

## Lessons

- **PDF is a new *category*, not another importer.** The docx/xlsx/pptx
  paths parse a file into a Yorkie CRDT via a pending-import registry. PDF
  instead stores the original blob and references it from
  `Document.fileId` — no CRDT, no pending-import. Forcing it through the
  importer pattern would have been wrong; the static-content shape is
  simpler and is what makes the viewer read-only and cheap.

- **The frontend vitest config only discovers `tests/**`.** Colocated
  `src/**/*.test.ts(x)` files silently never run (`vite.config.ts`
  `test.include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"]`). A
  pre-existing `src/app/slides/theme-fonts.test.ts` is dead for this
  reason. All new frontend tests must live under `packages/frontend/tests/`.
  The plan's colocated paths were wrong; caught during Task 4.

- **Union + exhaustive `Record` must change in one commit.** Adding
  `"pdf"` to `DocumentType` while `TYPE_META: Record<DocumentType, …>`
  lacked the key is a compile error. The union addition therefore had to
  land with its `TYPE_META`/`TYPE_OPTIONS`/`getDocumentPath` handlers
  (Task 5), not with the earlier api-helper task (Task 4). Splitting a
  union change away from its exhaustive consumers breaks the build.

- **pdf.js stays off the main bundle via `await import()` + a lazy route.**
  The engine (`pdfjs-dist`, ~444KB min) is dynamically imported inside
  `PdfViewer`; the worker is a `?url` asset emitted as `.mjs`, which the
  chunk gate (`verify-frontend-chunks.mjs`, `.js`-glob only) doesn't scan.
  The gate change was a **count-only** bump (112→115) with the per-chunk
  KB cap left at 710 — the correct signal that nothing leaked into an
  existing chunk. A KB-cap bump would have masked an engine-in-main
  regression.

- **jsdom canvas has no 2d context.** `HTMLCanvasElement.getContext("2d")`
  returns `null` under jsdom, so the viewer test must stub it
  (`HTMLCanvasElement.prototype.getContext = vi.fn(() => ({}))`) or the
  component skips appending canvases and the render assertion fails.

- **Serve document-scoped, not blob-scoped.** Gating file access on
  `GET /documents/:id/file` (reusing `assertMember`, the same check as
  `GET /documents/:id`) means the PDF inherits the document's read policy
  for free — no parallel permission logic, no `GET /files/:id` to secure.
  The upload endpoint returns an opaque id and there is deliberately no
  read-by-blob-id route.

- **Anonymous/share-token viewing needs its own path (deferred).** Share
  viewers today connect directly to Yorkie; a PDF has no Yorkie doc, so a
  shared-PDF viewer needs a dedicated token-accepting serving endpoint.
  There is no existing "member OR valid share token" check to reuse. This
  is Phase 2, alongside comments/presence.

- **Imperative pdf.js rendering has two easy-to-miss hazards** (caught in
  review, now fixed). (1) pdf.js forbids two concurrent `render()` calls on
  one canvas — a resize/sidebar re-raster firing while a page is still
  rendering throws "Cannot use the same canvas during multiple render()
  operations". Keep the `RenderTask`, `cancel()` it before starting a wider
  render (and on unmount), and catch `RenderingCancelledException`. (2) A
  `PDFDocumentProxy` must be `destroy()`ed on `fileUrl` change / unmount or
  it leaks the worker transport + cached page bitmaps.

## Follow-ups logged (non-blocking, from final review)
- Harden upload: magic-byte `%PDF` sniff (currently trusts client MIME).
- Blob-ownership record so a client can't attach someone else's `fileId`
  (mitigated now by UUIDv4 ids + shape validation, not eliminated).
- Deleted-blob-but-fileId-present serves 500; translate `NoSuchKey`→404.
- FileService happy-path/getObject/delete need an S3-mock test.
- Viewer: loading indicator + zoom/page-indicator/download controls.
- Pre-existing backend `pnpm --filter @wafflebase/backend lint` glob error
  (not in `verify:fast`) — separate ticket.
