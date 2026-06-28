---
title: export-progress
target-version: 0.4.9
---

# Export Progress Reporting

## Summary

Large exports (slides PDF/PPTX, docs PDF/DOCX) freeze the UI for several
seconds with only a spinner. The root cause is two-fold: the heavy export
loops run **synchronously on the main thread**, blocking the event loop, and
there is **no progress reporting**. This design adds an `onProgress` callback
to each exporter and inserts cooperative event-loop yields between work units,
then surfaces progress through a Sonner toast that mirrors the existing import
flow ("Exporting … 12 / 50 slides").

## Goals / Non-Goals

**Goals**

- Show incremental progress for slides PDF, slides PPTX, docs PDF, docs DOCX.
- Keep the UI responsive during export (toast actually repaints).
- Reuse the import toast UX for consistency.
- Keep the export libraries (`@wafflebase/docs`, `@wafflebase/slides`) pure —
  no DOM/toast coupling; they only expose callbacks.

**Non-Goals**

- Cancellation (the chosen toast UX has no cancel button, matching import).
- Web workers / off-main-thread export (much larger change; deferred).
- A determinate progress-bar modal (rejected for import/export UX parity).
- Sheets export (out of scope for this task).

## Proposal Details

### A. Progress callback in exporters

Each exporter gains an optional callback, mirroring the import
wrapped-callback pattern (`packages/docs/src/import/docx-importer.ts`,
`packages/slides/src/import/pptx/index.ts`):

```ts
onProgress?: (done: number, total: number, phase: string) => void;
```

Contract: emit `(0, total, phase)` once before work starts, then `(done,
total, phase)` after each unit completes, ending at `(total, total, phase)`.
Wrap emit in `try/finally` so a failing unit still advances `done` and the
toast never sticks.

Per-export progress unit:

| Export        | Unit        | Phase label | Loop location                                          |
| ------------- | ----------- | ----------- | ------------------------------------------------------ |
| Slides PDF    | slide       | `slides`    | `packages/slides/src/export/pdf.ts` per-slide loop     |
| Slides PPTX   | slide       | `slides`    | `packages/slides/src/export/pptx/index.ts` per-slide   |
| Docs PDF      | page        | `pages`     | `packages/docs/src/export/pdf-exporter.ts` per-page    |
| Docs DOCX     | image fetch | `images`    | `packages/docs/src/export/docx-exporter.ts` per-image  |

DOCX reports on image fetches (the actual bottleneck for large files,
identical to import's "Embedding images X / Y"); when a document has no
images, `total` is 0 and the toast shows the indeterminate
`Exporting "…"` form.

### B. Cooperative yield (the real un-freeze)

Reporting alone is insufficient: a blocked event loop never repaints the
toast. Between each unit the loop awaits a macrotask yield:

```ts
// small per-package util, e.g. slides/src/export/yield.ts
export function yieldToPaint(): Promise<void> {
  // MessageChannel macrotask avoids setTimeout's ~4ms clamp
  if (typeof MessageChannel === 'undefined') {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(0);
  });
}
```

`docs` and `slides` each get a tiny local copy (no shared package needed).
In non-DOM contexts (Node CLI export, tests) `MessageChannel` is available in
modern Node; a `setTimeout(0)` fallback guards if it is undefined.

Overhead is negligible: 50 slides → 50 yields; a 500-page doc → a few hundred
zero-delay macrotasks. If profiling shows cost, throttle to "yield every N
units" — but start with per-unit for the smoothest progress.

### C. Frontend toast wiring

A shared `updateExportToast` helper (added to
`packages/frontend/src/app/docs/export-utils.ts`) mirrors `updateImportToast`
in `packages/frontend/src/app/documents/document-list.tsx`:

```ts
function updateExportToast(id, title, done, total, unit): string | number {
  const description = total > 0 ? `${Math.min(done, total)} / ${total} ${unit}` : undefined;
  if (id === undefined) return toast.loading(`Exporting "${title}"…`, { description });
  toast.loading(`Exporting "${title}"…`, { id, description });
  return id;
}
```

Each export button (`packages/frontend/src/app/docs/docs-export-button.tsx`,
`packages/frontend/src/app/slides/slides-export-button.tsx`)
threads an `onProgress` into its export action, which calls
`updateExportToast`. On success the toast becomes `toast.success`; on failure
the existing `toast.error` path is preserved. The current spinner icon and
`disabled` state stay as complementary feedback. The toast is shown always
(matching import) and is immediately replaced by the success toast, so small
exports only flash briefly.

### Data flow (slides PDF example)

```
slides-export-button → exportSlidesPdf(doc, { onProgress })
  loop slides: drawSlide → emit(done, total, 'slides') → await yieldToPaint()
onProgress(done, total, 'slides') → updateExportToast(id, title, done, total, 'slides')
done → toast.success("Exported \"Deck\"")
```

## Risks and Mitigation

- **Yield overhead on huge docs** — per-unit macrotask yields add up on
  500+ page PDFs. Mitigation: MessageChannel (no 4ms clamp); fall back to
  throttled "every N units" if profiling warrants.
- **Node/CLI export path** — exporters run headless in the CLI. Mitigation:
  `MessageChannel` exists in modern Node; guard with `setTimeout` fallback and
  treat `onProgress` as optional (CLI passes none).
- **Toast flash on tiny exports** — accepted; matches import, success toast
  replaces it instantly.
- **Partial-failure stuck toast** — emit in `try/finally`; final throw routes
  to the existing error toast which dismisses the loading toast.

## Testing

- Unit test per exporter: inject an `onProgress` mock, assert it starts at
  `(0, total)`, is monotonically non-decreasing, and ends at `(total, total)`.
- `yieldToPaint` is a pure function with no build impact; smoke-test it
  resolves.
- Manual smoke in `pnpm dev`: export a large deck/doc, confirm the toast
  counts up and the UI stays responsive.
