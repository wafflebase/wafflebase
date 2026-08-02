# Design Doc Audit — Lessons

## What this task was

Audited all 100 `docs/design/*.md` docs against the shipped codebase (one
subagent per doc), then fixed the 27 significant-drift docs (one subagent per
doc) to match reality.

## Key findings about the doc corpus

- **The systemic problem is tense, not accuracy.** 45 of 57 high-severity
  findings were `roadmap-shipped`: docs written as forward-looking proposals
  ("This doc adds X", "X is a Non-Goal / deferred / Phase N") for features that
  shipped and were never flipped to present tense. The *designs* were accurate;
  the *framing* misled readers into thinking features don't exist.
- **`slides/*` is the worst-drifted area** — 10 significant-drift docs. The
  slides package ships fast and its docs lag: native undo, PDF export, image
  crop, ruler, theme catalog, tables, fonts, background, format-options were all
  built but documented as unbuilt.
- **A handful are genuine factual bugs, not just tense** — worth prioritizing
  because they mislead about security/storage/access:
  - `sheets/datasource.md` claimed per-user `authorID` access; code enforces
    workspace-member access (`assertMember`).
  - `sharing.md` claimed writes are client-side-only; the Yorkie auth webhook
    enforces viewer/editor roles server-side (403 on viewer write).
  - `sheets/sheet-image.md` described a Prisma `Image` model + local FS that were
    never built (it's S3/MinIO, no DB row).
  - `docs/docs-intent-preserving-edits.md` (minor-drift, not fixed here)
    describes a native CRDT split/merge the code deliberately abandoned.

## Process lessons

- **Workflow args arrive as a JSON *string*, not a parsed value.** Passing
  `args: [...]` reached the script as a string and `DOCS.map` threw. Fix:
  `const DOCS = Array.isArray(args) ? args : JSON.parse(args)`. Do this in every
  workflow that takes array/object args.
- **Session limits kill in-flight subagents.** 28 of 100 audit agents failed on
  a mid-run limit reset. `resumeFromRunId` replayed the 72 cached results for
  free and only re-ran the 28 — cheap recovery. Always resume rather than re-run.
- **Verify agent-added specifics before trusting a fix.** The fix agents were
  told to verify findings against code themselves, and spot-checks (throttler
  120/min, `datasourceTypeParser`, `hasAccess` return, `units.ts`, 105-entry
  font catalog, `VALID_IMAGE_ID_PATTERN`) all held — but I still confirmed the
  4 factual-bug corrections by hand. Cheap insurance on a 27-file batch.
- **Match the gate to the change.** `verify:fast` is all code; markdown isn't
  linted. Running it for a docs-only change is pure waste — the pre-push hook
  (`verify:self`) covers the push anyway.

## Scope note

Fixed the 27 significant-drift docs. The 57 minor-drift docs are mostly cosmetic
(stale file paths, renamed symbols, shipped-but-future-tense on low-stakes
items) and were left as an optional follow-up.
