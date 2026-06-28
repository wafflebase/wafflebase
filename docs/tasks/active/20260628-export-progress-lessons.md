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

## Code-review pass (high-effort, 7 finder angles)

After the branch was green, a `/code-review` pass surfaced findings. Fixed the
high-value, low-risk ones in commit "Address export-progress code-review
findings":

- **DOCX stuck at `0/N`**: the initial `(0, N)` emit was gated on `onProgress`
  alone, but fetching is gated on `imageFetcher && onProgress`. A caller with
  `onProgress` but no fetcher emitted `(0, N)` then never advanced. Now both
  the total and the emit are gated on `reportProgress = imageFetcher &&
  onProgress`.
- **Zero-image DOCX toast flash**: `updateExportToast` now returns `undefined`
  (creates no toast) when `total === 0`, so an image-less DOCX no longer
  flashes a descriptionless loading spinner before success.
- **Slides button re-entrancy**: added the `if (exporting) return` guard the
  docs button already had.
- **PPTX loop**: loops on the captured `slideTotal` rather than re-reading
  `deck.slides.length`.

## Known minor limitations (deliberately not fixed)

- **100%-then-save gap**: PDF exporters emit `(total, total)` after the last
  page/slide, but `pdf.save()` still runs for a moment after — the toast reads
  100% during final serialization. Still strictly better than a frozen
  spinner; a true "finalizing" state is out of scope.
- **`exportPdfAndDownload`'s `metadata` param** is unreachable via the UI
  (onProgress inserted before it). No caller passes it; harmless.
- **`yieldToPaint()` allocates a `MessageChannel` per call.** A module-level
  reused channel (React-scheduler style) would save allocations, but the
  queue/state it needs adds more risk than the cheap allocation costs — left
  simple per the design's accepted per-call shape.
- **Cross-part duplicate image** (same src in body + header) counts as 2 and is
  fetched twice — pre-existing per-part dedupe behavior; count still matches
  fetches so the bar is correct.
