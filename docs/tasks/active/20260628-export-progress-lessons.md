# Export Progress Reporting — Lessons

## What worked

- **The freeze fix is yielding, not progress.** Reporting `onProgress` alone
  would never repaint a Sonner toast — the heavy export loops hold the main
  thread synchronously. The load-bearing change is `await yieldToPaint()`
  (a `MessageChannel` macrotask, no `setTimeout` 4ms clamp) *between* units.
  Progress reporting is the visible half; the yield is what unblocks paint.
- **Phase string as the unit label.** Emitting `'slides'`/`'pages'`/`'images'`
  and forwarding it straight into `updateExportToast(..., unit)` removed any
  per-export mapping table in the frontend — one less thing to keep in sync.
- **Per-task reviewers instructed to verify guessed identifiers against source.**
  The plan's test fixtures guessed import paths; the dispatch prompts told each
  implementer to confirm against the real model files. This caught
  `BUILT_IN_THEMES` living in `src/themes/index.ts`, not `src/model/theme`
  (Task 2), and the inline image style shape (Task 4) — before a red build.

## Gotchas worth remembering

- **PPTX export has no browser trigger.** `exportPptx` is unreferenced in
  `packages/frontend` (CLI/Node only). We still added the library-level
  `onProgress` for parity/future, but there is no toast wiring — there was no
  UI freeze to fix. Surface "is this even reachable from the UI?" during
  planning, not after.
- **Frontend consumes built dist, not src.** New exporter options
  (`onProgress`) were invisible to the frontend typecheck until
  `pnpm --filter @wafflebase/docs build && pnpm --filter @wafflebase/slides build`
  ran. The frontend task's first step had to be the rebuild.
  (See memory: packages-consume-built-dist.)
- **DOCX needs no yield.** Its bottleneck is per-image `await imageFetcher()`,
  genuine async I/O that already cedes the loop — so DOCX is progress-only,
  mirroring the import "Embedding images X/Y" UX. Don't add a yield where the
  await already exists.
- **Count must equal fetch calls.** DOCX `total` = unique srcs *per part*
  (body/header/footer have separate dedupe arrays), matching `collectImages`'s
  per-part `entries.some(...)`. A global dedupe would have under-counted and
  left `done > total`.

## Known minor limitations (non-blocking, from final review)

- `exportPdfAndDownload`'s `metadata` param is now unreachable via the UI
  (onProgress inserted before it); harmless, candidate for a tidy-up.
- `yieldToPaint()` allocates a fresh `MessageChannel` per call (GC-eligible;
  React's scheduler reuses one — optional micro-opt).
- PPTX/Docs-PDF progress tests assert the contract loosely (no exact call
  count / `>0` not `>1`); fixtures make them pass reliably.
