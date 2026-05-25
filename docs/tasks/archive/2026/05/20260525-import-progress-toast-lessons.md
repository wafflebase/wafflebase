---
title: Import progress toast — lessons
date: 2026-05-25
---

# Lessons — Import progress toast (PPTX + DOCX)

## What worked

- **Wrap the injected callback once, don't thread a counter.** The first
  design instinct was to pass a shared progress counter through every
  `ImageParseContext` / `uploadImages` / `parseHeaderFooter` call. Tracing
  the upload paths showed both importers inject their uploader from a
  *single* point (`importPptx` → `loadMasterAndLayouts`/`parseSlide`;
  `DocxImporter.import` → `uploadImages`/`parseHeaderFooter`). Wrapping the
  callback there — increment `done` in a `finally`, emit `(done, total)` —
  delivered identical behavior while touching far fewer files. Refining the
  spec away from the threaded-counter approach before writing the plan saved
  the implementers from a much larger change.

- **`finally` is the load-bearing detail.** PPTX soft-fails uploads
  per-image (`parseBlipFill` catches), so the increment must run on both
  success and throw or the bar stalls. The code-quality reviewer correctly
  insisted on a regression test that throws from `uploadImage` and asserts
  progress still advances — without it, moving the increment out of
  `finally` would have stayed green.

- **Pragmatic denominator beats exact.** Counting `*/media/` image files
  for `total` avoided a "collect-then-upload" refactor of the PPTX parser.
  Drift (reused/unreferenced images) is clamped with `Math.min(done,total)`
  and overridden by the final success toast — invisible for real files.

- **Lazy toast keyed on the first `onProgress(0,total)` tick** cleanly
  solves "no toast if the picker is cancelled": the tick only fires after a
  file is chosen, and both importers emit it before any upload, so the
  toast always exists by the time success/error needs to morph it in place.

## Gotchas

- **Commit hooks.** A `commit-msg` hook enforces a ≤70-char subject and a
  `pre-commit` hook runs the full `pnpm verify:fast`. An early commit failed
  only because the subject was 72 chars — the harness had truncated the long
  hook output, which made it look like a test failure. Lesson: when a commit
  fails after a long hook run, check the *last* lines (the hook's own
  message), not the truncated test stream.

- **`pickAndImport*` returns the filename only at the end**, but the progress
  toast wants the title *during* upload. Solved by enriching the package-level
  `(done, total)` callback with `file.name` in the frontend action layer
  (which knows it), keeping the package API filename-agnostic.

## Follow-ups (optional, not blocking)

- Add a DOCX test for the abort-on-upload-error toast path (PPTX soft-fail
  is tested; DOCX hard-fails).
- Add a test for "onProgress set but uploader omitted while images exist".
