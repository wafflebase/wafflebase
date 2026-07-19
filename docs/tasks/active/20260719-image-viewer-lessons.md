# Image Viewer — Lessons

Task: add an `"image"` document type (upload, `<img>` viewer at `/f/:id` with
zoom/download + workspace prev/next, lazy list thumbnails). Branch
`image-documents`. Executed via subagent-driven development.

## What went well

- **Mirroring PDF was the right spine.** Reusing `Document.fileId`, the
  `wafflebase-files` bucket, and the already-type-agnostic
  `GET /documents/:id/file` meant no migration, no new bucket, and no serving
  change. The bulk of each task was transcription; cheap models handled the
  mechanical ones.
- **Extracting `assertFileIdAllowed` into a pure util** made the security-
  critical "fileId only on pdf/image" gate unit-testable and kept the final
  review's cross-cutting trace clean (no path lets a sheet/doc/slides carry a
  fileId or serve an arbitrary blob).

## Lessons / mistakes caught in review

- **A brief that says "Create <file>" can be wrong when the file already
  exists.** `yorkie-doc-key.spec.ts` pre-existed (from the notes PR) with 10
  tests; the Task-2 implementer took "Create" literally and overwrote it,
  silently dropping unrelated coverage. The task review caught it; restored via
  a fix commit. Lesson: when a plan says create a test file, the implementer
  must still check for an existing one and append; and plan authors should
  verify file existence before writing "Create".

- **Immutable store + closed-over object = stale reads across retries.** The
  upload queue's `patchItem` replaces the `items` array immutably
  (`items.map(... {...it, ...patch})`). The first cut of the 429 retry loop
  re-read `item.fileId`/`item.docId` off the object captured once at
  `runItem` entry — which never updates. A 429 on `createDoc` *after* a
  successful `uploadFile` would therefore re-upload (orphan a blob) and
  re-create the document. The adversarial task review flagged it as PLAUSIBLE;
  a RED test (uploadFile called 2×) confirmed the bug, and the fix (re-read the
  live item each attempt) turned it GREEN. Lesson: with an immutable store,
  never trust a long-lived local reference across `await` + mutation — re-read
  from the source of truth.

- **`.png` was load-bearing as the "unsupported" example.** Multiple existing
  tests (`upload-kind`, `upload-queue`, `upload-panel`, `tests/api/files`) used
  `.png` to mean "skipped/unsupported". Reclassifying png as a supported image
  broke them; the plan pre-identified this and the implementer swept them to
  `.zip`. Lesson: before widening an accept-list, grep the test suite for the
  extension you're promoting.

- **Feature-level rate limiting is easy to forget.** Bulk image upload tripped
  the global 120/min throttler because the new `POST /files`/`POST /documents`
  path never inherited the raised limit the inline-image routes already had.
  Surfaced by the user mid-implementation, not by tests. Lesson: when a feature
  adds a new high-fan-out request path, check the throttler config and the
  precedent set by sibling features.

- **A refactor must resolve type *before* mounting a provider.** `FileDetail`
  gained an image branch, but the first cut fell through to the PDF layout
  (attaching a `pdf-<id>` Yorkie doc) on a document-fetch *error*. Fixed by
  short-circuiting on `docError || !documentData` before choosing a layout.
  Lesson: when one route dispatches to provider-wrapped vs provider-free
  subtrees, gate on the discriminator's resolved (and error) state, not just
  its loading state.

## Deferred (documented, not in this PR)

- `FileDetail` dispatch render-test to lock "image never mounts
  `PdfCollabProvider`" into CI (currently manual-smoke-only).
- Gallery/grid list view (D2), image comments/sharing (`image-<id>` Yorkie),
  server-side thumbnails, SVG/HEIC support.
- Manual smoke (docker + `pnpm dev`): mixed-batch upload, >25 MB rejection,
  lazy thumbnail on scroll, PDF no-regression, arrow-key nav.
