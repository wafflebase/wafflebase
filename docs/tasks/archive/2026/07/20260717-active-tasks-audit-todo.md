# Active Tasks Audit — Archivability Review (2026-07-17)

Investigated every task in `docs/tasks/active/` against the actual codebase
(not just checkbox state) to record whether it can be archived. Each task was
cross-checked by reading its todo/lessons file and verifying the described
features exist in `packages/`, `git log`, and released artifacts.

## How archiving works (important)

`pnpm tasks:archive` (`scripts/tasks-archive.mjs`) is purely mechanical: it
moves a task to `archive/YYYY/MM/` **only if its `-todo.md` has zero unchecked
`- [ ]` lines** (`uncheckedTodoPattern`, line 12/94). It does not read the
Review section or judge real completion. Consequences found during this audit:

- Several **shipped** tasks left their checkboxes unticked (bookkeeping miss),
  so the script will keep them active until the boxes are ticked.
- `20260711-sheets-date-validation-plan.md` is named `-plan.md`, which does
  **not** match the `-(todo|lessons)\.md$` pattern — it is invisible to both
  `tasks:archive` and `tasks:index` (also absent from the README index).

## Summary

| Task | Verdict | Checklist | Blocker to archive |
|---|---|---|---|
| 20260716-release-v0.6.0 | ✅ ARCHIVE-READY | 7/15 | boxes unticked; v0.6.0 tag + GitHub Release published, all pkgs at 0.6.0 |
| 20260716-notes-cli | ✅ ARCHIVE-READY | 34/37 | 3 open items are deliberate non-actions; merged 672bb2ee5 |
| 20260715-notes-markdown-type | ✅ ARCHIVE-READY | 0/86 | boxes unticked; P1 merged PR #480, follow-up #483 |
| 20260712-slides-background | ✅ ARCHIVE-READY | 0/47 | boxes unticked; merged PR #475 |
| 20260711-sheets-date-validation | ✅ ARCHIVE-READY (already archived) | 0/47 | stray duplicate `-plan.md`; the real task was already archived by PR #470 — orphan deleted |
| 20260710-docs-list-updatedat-webhook | ✅ ARCHIVE-READY | 8/9 | 1 open item is an out-of-band ops registration follow-up |
| 20260712-yorkie-auth-webhook | 🟡 PARTIAL | 18/21 | code merged, but shadow→enforce rollout not yet flipped/validated |
| 20260711-slides-gradient-editing | 🟡 PARTIAL | 26/44 | PR1 (linear) shipped; PR2 (radial render/import/export/UI) unbuilt |
| 20260714-shared-core-extraction | ⛔ NOT-READY | 8/25 | only PR1 of 3 merged (#477); OOXML + DrawingML unstarted |
| 20260325-docs-wordprocessor | ⛔ NOT-READY | 23/31 + backlog | open-ended parity roadmap tracker with large A–F backlog |
| 20260708-devops-storage-secrets | ⛔ NOT-READY | 0/4 | external `yorkie-team/devops` PR not landed; key rotation open |
| 20260625-sheets-external-data-sources | ⛔ NOT-READY | 0/3 (umbrella) | unstarted epic; four sub-connectors all 0% |
| 20260625-sheets-file-import | ⛔ NOT-READY | 0/18 | only pre-existing XLSX baseline; CSV/Parquet/JSON unbuilt |
| 20260625-sheets-lakehouse-connector | ⛔ NOT-READY | 0/31 | no DuckDB/Iceberg/Delta code exists |
| 20260625-sheets-bigquery-connector | ⛔ NOT-READY | 0/14 | no `@google-cloud/bigquery`, no module, no model |
| 20260625-sheets-mysql-connector | ⛔ NOT-READY | 0/8 | no `mysql2`, no engine discriminator, no code |
| 20260625-docs-collaboration-convergence | ⛔ NOT-READY | 0/8 | five CRDT convergence bugs still `{ skip: KNOWN_BUG }`, untouched |

**Tally:** 6 archive-ready · 2 partial (keep active) · 9 not-ready.

## Per-task detail

### ✅ Archive-ready (6)

- **20260716-release-v0.6.0** — Annotated tag `v0.6.0` → `434385564`, GitHub
  Release published 2026-07-16 (Latest), all 9 packages + root at `0.6.0`. No
  CHANGELOG by project convention. Unticked boxes are done-via-git or parked
  under other active tasks.
- **20260716-notes-cli** — `notes` CLI namespace (`commands/notes.ts`,
  `notes/content.ts`, `notes/import.ts`, `bin.ts` register), backend
  `note-content.ts` + `docs-content.controller.ts` note arm, full test suite
  incl. live-Yorkie e2e; merged 672bb2ee5. 3 open items deliberate non-actions.
- **20260715-notes-markdown-type** — `@wafflebase/notes` package complete
  (store/view/preview/commands), backend `note-` docKey + dto, frontend
  `/n/:id` route + `yorkie-note-store.ts`, wired into `verify:fast`. P1 merged
  PR #480 (+#483). Only deferred: interactive 2-browser smoke; P2/P3 out of scope.
- **20260712-slides-background** — `Background.fill: Fill` + `migrateBackground`,
  renderer `resolveFillStyle` both paint sites, PPTX `<a:gradFill>` import+export
  round-trip, `use-slide-background.ts` full hook, `background-side-panel.tsx`
  (Reset-to-theme / Apply-to-all / image opacity). Merged PR #475.
- **20260711-sheets-date-validation** — Model (`isValidDateValue`,
  `dateValidationOperandCount`, `DataValidationOperator`), render marker
  (`gridcanvas.ts` `kind === 'date'`), calendar picker (`datePopover`,
  `chooseDateValue`), panel (`data-validation-panel.tsx`). Shipped PR #470
  (`a0882824d`). **Surprise found during archiving**: the canonical task was
  *already* archived by PR #470 — `archive/2026/07/20260711-sheets-date-validation-todo.md`
  (64-line, boxes ticked) + its `-lessons.md`. The file sitting in `active/` was a
  stray orphaned `-plan.md` (1144-line detailed TDD plan) that was never cleaned up.
  Resolution: deleted the orphan (redundant with the archived pair; content preserved
  in git history), left the canonical archive untouched.
- **20260710-docs-list-updatedat-webhook** — `yorkie-event.controller.ts`
  handles `DocumentRootChanged` + `touchUpdatedAt`, HMAC `yorkie-signature.guard.ts`,
  `Document.updatedAt` migration `20260710000000_add_document_updated_at`, both
  list endpoints sort by `updatedAt desc`, full spec coverage. Only open item is
  post-merge Yorkie-project webhook registration (ops runbook, not code).

### 🟡 Partial — keep active (2)

- **20260712-yorkie-auth-webhook** — All code merged: `POST /internal/yorkie/auth`,
  HMAC guard, `YORKIE_AUTH_WEBHOOK_ENFORCE` shadow/enforce gate, `WorkspaceMember`
  + `ShareLink` role resolution, frontend `authTokenInjector`. **Remaining**: the
  shadow→enforce operational rollout (manual smoke, then flip `ENFORCE=true` and
  validate) — the task's stated final deliverable. Archive once enforcement is on.
- **20260711-slides-gradient-editing** — PR1 (linear) fully shipped: `fill-picker/`
  (FillPicker Solid|Gradient, `gradient-editor.tsx` stops-bar, `gradient-helpers.ts`),
  `GradientFill.type`, `migrateGradientFill`. **Remaining (PR2, radial)**: render
  `createRadialGradient` branch, PPTX `<a:path circle>` import + export round-trip,
  Linear|Radial toggle + center-preset UI. ~40% of checklist. Keep active until PR2
  ships or radial scope is formally dropped.

### ⛔ Not-ready (9)

- **20260714-shared-core-extraction** — Only PR1 merged (#477): `@wafflebase/core`
  with `/geometry` + `/tokens`. PR1 canvas leftover, all of PR2 (`ooxml/*`) and PR3
  (`ooxml/drawingml/*`) unstarted.
- **20260325-docs-wordprocessor** — Living parity-roadmap tracker, not a discrete
  task; entire A–F "Parity Gap Backlog" open. (Note: 6.3 spell-check is actually
  shipped under `packages/docs/src/spell/` but left unticked — tracker is stale.)
- **20260708-devops-storage-secrets** — Deliverable lives in external
  `yorkie-team/devops` repo (`k8s/wafflebase/deployment.yaml`), not present here;
  0/4, and the security-critical key rotation is open.
- **20260625-sheets-external-data-sources** — Unstarted umbrella epic. The
  PostgreSQL datasource/ReadOnlyStore/SQL-editor spine it builds on pre-exists,
  but none of this epic's four connector roadmaps have code.
- **20260625-sheets-file-import** — 0/18. Only the already-shipped XLSX importer
  exists (explicitly excluded as a subtask); CSV/Parquet/JSON/Connect all unbuilt.
  (`papaparse` is in deps but unused.)
- **20260625-sheets-lakehouse-connector** — 0/31. Zero lakehouse/DuckDB/Iceberg/
  Delta code; no duckdb dependency; no `LakehouseSource` model.
- **20260625-sheets-bigquery-connector** — 0/14. No `@google-cloud/bigquery` dep,
  no backend module, no `BigQuerySource` model, no frontend.
- **20260625-sheets-mysql-connector** — 0/8. No `mysql2` dep, no `engine`
  discriminator on `DataSource` (still Postgres-only), no code, no commits.
- **20260625-docs-collaboration-convergence** — 0/8. All five convergence bugs
  still guarded by `{ skip: KNOWN_BUG }` in
  `yorkie-doc-store-concurrent.integration.ts` at the exact named lines; lessons
  Findings "(none yet)". Untouched deep CRDT work.

## Follow-up actions

- [x] Ticked completed checkboxes + appended an honest "Audit closure" note (naming
      each deferred/not-executed item) on the 5 archive-ready tasks so
      `pnpm tasks:archive` would move them
- [x] Resolved `20260711-sheets-date-validation`: it was already archived by PR #470;
      deleted the stray orphan `-plan.md` in `active/` (canonical archive left intact)
- [x] Ran `pnpm tasks:archive && pnpm tasks:index` (12 active, 368 archived)
- [x] Left the 2 partial + 9 not-ready tasks in `active/`

## Review

Archived 5 tasks (10 files: `docs-list-updatedat-webhook`, `slides-background`,
`notes-markdown-type`, `notes-cli` — each todo+lessons — plus `release-v0.6.0` todo)
into `archive/2026/07/`, and cleaned up the `date-validation` orphan (its real record
was already archived). Active count 17 → 12.

**Gotcha hit during archiving:** `pnpm tasks:archive` uses `rename()`, so moving a
renamed active file whose basename already exists in the archive **silently overwrites**
the archived copy. That happened once (date-validation): the orphan clobbered the
canonical 64-line archived todo; restored via `git checkout HEAD -- <archived file>`.
Lesson: before archiving, check the target archive dir for a same-named file.

This audit task stays active as the visible record until reviewed; archive it later.

## Second pass (2026-07-17, after `git pull` — main at `d7cf8d5c2`)

Pulled 2 new commits that each shipped a feature **and** added its own new active
task. Both verified shipped and archived:

| Task | Verdict | Evidence |
|---|---|---|
| 20260717-documentation-0.6.0-update | ✅ ARCHIVE-READY | 0 unchecked; merged PR #485 (`d7cf8d5c2`) — 3 new doc pages (Notes/PDF/Data-Validation) to v0.6.0 parity |
| 20260717-share-link-permissions | ✅ ARCHIVE-READY | 22/23 → ticked; merged PR #484 (`cb188500a`), `document-access.ts` + specs, 8 self-review findings fixed; only a deferred manual smoke was open |

- [x] Discarded my generated `README.md`/archive index (regenerate deterministically), `git pull --ff-only` main
- [x] Assessed + closed the 2 new tasks; ticked + appended closure notes
- [x] Re-ran `pnpm tasks:archive && pnpm tasks:index` to reconcile (my 5 + these 2)
- [x] Reviewed; archive moves committed + PR #486 opened

**Running total this session:** 7 tasks archived (5 first pass + 2 second pass).
Remaining active: the 2 partial + 9 not-ready + this audit record.
