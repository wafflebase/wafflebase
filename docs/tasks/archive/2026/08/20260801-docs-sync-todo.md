# Docs sync to developed scope

Audit found documentation drifting behind shipped code. This task closes the
high-confidence, factual gaps (index + stale claims + missing package READMEs).
New design docs and new end-user pages are deferred (need authoring judgment).

## Tier 1 — Index + stale fixes

- [x] Add `export-progress.md` to the Common table in `docs/design/README.md`
- [x] Fix `cli.md` index blurb: 5 namespaces (add slides, notes)
- [x] `frontend/README.md` — multi-engine reality (routes, tech stack, intro)
- [x] `backend/README.md` — Document schema table (type/fileId/updatedAt/workspaceId/folderId) + Module Structure tree (analytics/datasource/file/folder/health/image/share-link/user-doc-styles/workspace)
- [x] `slides/README.md` — 7 element types, 23 themes, Yorkie doc.history undo, exports, Further Reading
- [x] `docs/README.md` — Further Reading (all design docs), Public API note, undo model note
- [x] `sheets/README.md` — Cell type (s + spill fields)
- [x] `slides.md` — mark shipped items in Non-Goals / "Tracked for v2"
- [x] `docs-collaboration.md` + `docs-wordprocessor-roadmap.md` — undo is Yorkie doc.history (#162), not future
- [x] `shared-core-extraction.md` — flag non-existent subpaths as roadmap, add `/url`
- [x] Root `CLAUDE.md` product line — mention Notes/Board/PDF/Image

## Tier 2 — New package READMEs

- [x] `packages/core/README.md`
- [x] `packages/notes/README.md`
- [x] `packages/board/README.md`

## Tier 3 — End-user docs site (VitePress) additions (user-requested)

- [x] `pdf/viewing-images.md` — image viewer user guide
- [x] `pdf/organizing-with-folders.md` — folder management user guide
- [x] Sidebar: rename "PDF" group → "PDF & Files"; add both pages
- [x] `developers/self-hosting.md` — Analytics (Kafka + StarRocks) stack +
      opt-in Docker profile install + env vars

## Code review

- [x] High-effort workflow review: 3 confirmed findings, all in this diff —
      slides README invented `wafflebase` root export (real: streamline/focus/
      material); slides README listed `ChartElement` (not barrel-exported);
      shared-core note mislabeled `/url`. All fixed + re-verified vs code.

## Still deferred (not in this task)

Out of scope here — they need authoring judgment, not a factual sync. Listed
so the gap is on the record; they are not work this task ever intended to do:

- `docs-hyperlinks.md` design doc (#520/#532/#548/#580) + reconcile xlsx `Cell.lk` gap
- Sheets auto-link / header-ref subsections
- Docs find & replace + viewer read-only subsections

## Verify

- [x] Doc-consistency checks pass: every design doc indexed, no dead links,
      every package has a README, new README design-doc links resolve.
- [x] Diff is markdown-only — no source touched, so `verify:fast`
      (build/typecheck/lint/tests) is unaffected.
