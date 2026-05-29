# Design Docs Cleanup

**Status:** Completed 2026-05-30. 8 commits on
`cleanup/design-docs-pr-a-low-risk-wins` (49 files, +3,081 / -4,842).
Lessons captured in
[`20260530-design-docs-cleanup-lessons.md`](20260530-design-docs-cleanup-lessons.md).

Multi-PR cleanup of `docs/design/` based on a 4-area audit (Sheets / Docs /
Slides / Common). Goal: remove duplication, stale "shipped phase" sections,
schema drift, and orphan files; align frontmatter/structure with
`docs/design/template.md`.

The full audit findings live in this todo (per item below). Each checked
section has the rationale inline so the PR author does not need to re-derive.

## PR A — low-risk wins (this branch: `cleanup/design-docs-pr-a-low-risk-wins`)

Semantic content of design unchanged; only metadata, structure, and "shipped
phase" tables are touched.

- [x] **A1** Add `docs/docs-header-footer.md` to README index (orphan).
  - Currently exists but not listed in `docs/design/README.md` Docs table.
- [x] **A2** Normalize `context-menu.md` to template format.
  - Add `--- title / target-version ---` frontmatter; restructure into
    `Summary / Goals / Non-Goals / Proposal Details / Risks and Mitigation`.
    Only `context-menu.md` violates the template among Common docs.
- [x] **A3** Unify `target-version` frontmatter notation across all design docs.
  - `template.md` uses bare `0.2.0`. One outlier: `docs-nested-tables.md` uses
    `v0.3.3`. Drop the `v` prefix to match the template.
- [x] **A4** Trim small shipped phase tables (large `docs-wordprocessor-roadmap.md`
      cleanup deferred to PR D).
  - `slides.md` "Phasing" (P1–P5 all shipped) → demote to "Historical phasing"
    or remove.
  - `slides-shapes.md` Phase roadmap table (P3-A.1/A.2/B/C all strikethrough,
    shipped) → remove strikethrough rows.
  - `slides-themes-layouts-import.md` "PR Plan" → add "Status: PR1/PR2 shipped,
    PR3 deferred" header and collapse historical detail.
  - `pivot-table.md` "IMPLEMENTED" checkboxes → remove (changelog content, not
    design content).
- [x] Run `pnpm verify:fast`, commit.

## PR B — Slides consolidations (`cleanup/design-docs-pr-b-slides`)

- [x] **B1** Archive `slides-text-engine-audit.md` (Phase 5 spike, conclusions
      absorbed; commit `fbd9553a` already signaled archive intent).
- [x] **B2** Merge `slides-textbox-autogrow.md` into `slides-text-autofit.md`
      (autofit absorbs autogrow as `'grow'` mode). Archive autogrow doc.
- [x] **B3** Merge `slides-mobile-view.md` + `slides-mobile-edit.md` →
      `slides-mobile.md` (edit doc already absorbs view via `mode: 'view'`
      fallback).
- [x] **B4** Merge `slides-group-selection-ui.md` into `slides-group.md`
      (selection-ui is overlay-only, depends entirely on group model).
- [x] **B5** Deduplicate Shift-modifiers table from `slides-keyboard-shortcuts.md`
      (keep summary + xref to `slides-shift-modifiers.md`).
- [x] **B6** Update README index for all moves/merges.
- [x] Run `pnpm verify:fast`, commit.

## PR C — Common CLI consolidation (`cleanup/design-docs-pr-c-cli`)

- [x] **C1** Split `rest-api-and-cli.md` into:
  - `rest-api.md` — REST + API key + `/api/v1/*` + workspace scope.
  - `cli.md` — sheets/docs namespaces, OAuth login, context switching,
    DOCX/PDF export.
- [x] **C2** Absorb `docs-cli.md` and `cli-oauth-login.md` into `cli.md`.
- [x] **C3** Update README index.
- [x] Run `pnpm verify:fast`, commit.

## PR D — Docs and Sheets deep restructure (`cleanup/design-docs-pr-d-restructure`)

Largest PR; split further if it grows. Will likely need its own todo file.

### D1 — Docs table cluster (7 → 3)

- [x] Rewrite `docs-tables.md` against current model (block-container cells,
      CRDT tree), absorb `docs-table-crdt.md`.
- [x] Delete deprecated `cellAddress` / `*InCell` / "Cell-Aware Text Selection"
      sections (~220 lines).
- [x] Move `docs-table-ui.md`, `docs-table-resize.md`, `docs-table-copy-paste.md`,
      `docs-table-row-splitting.md`, `docs-nested-tables.md` into
      `docs/design/docs/tables/` subfolder with `docs-tables.md` as index.

### D2 — Docs collaboration cluster

- [x] Rewrite `docs-collaboration.md` against intent-preserving model
      (Phases 1–8 are all shipped). Archive
      `docs-intent-preserving-edits.md` or compress into phase log.
- [x] Merge `docs-remote-cursor.md` + `docs-peer-jump.md` → `docs-presence.md`
      (shared presence state/timers/`buildPeerCursors`).

### D3 — Docs roadmap shrink

- [x] Trim `docs-wordprocessor-roadmap.md` ~70%: drop completed Phase 1.1–2.5
      content, compress unimplemented items to one paragraph each + design doc
      links. Remove stale Non-Goals in `docs.md`.

### D4 — Sheets schema single-source-of-truth

- [x] Designate `collaboration.md` as canonical `Worksheet` /
      `SpreadsheetDocument` source. Convert other docs (comments/pivot/
      datasource/image/charts) to "add this field" patch format.
- [x] Slim `sheet.md` (~612 → index/Store role). Remove duplicated
      style/scroll/batch/formula summaries. Fix grid dimensions to a single
      source of truth (currently 3 different values).
- [x] Designate `formula-coverage.md` as the only home for function counts and
      category tables. Strip from `sheet.md` and `formula.md`.

### D5 — Sheets presence merge

- [x] Absorb `peer-cursor-labels.md` into `axis-id-selection.md` or
      `collaboration.md`. The two presence docs are mutually inconsistent.

### D6 — Archive single-PR notes

- [x] Move to `docs/design/archive/`:
  - `conditional-format-multi-range.md`
  - `peer-cursor-labels.md` (after D5)
  - `docs-frontend-integration.md`
  - `slides-group-selection-ui.md` (after B4)
  - `slides-shape-move.md`

## Cross-cutting (apply throughout)

- Single-PR sketches do not belong in `docs/design/`; route to
  `docs/tasks/active/` or `docs/design/archive/`.
- Type definitions (`Worksheet`, `LayoutBlock`, `PageLine`, `ImageData`,
  `Store`) are canonical in one doc only; other docs show patch form
  (`+ comments?: Comments` etc.).
- Shipped phase tables belong in CHANGELOG or `docs/tasks/archive/`, not in
  design docs.

## Done criteria

- All design docs match `template.md` frontmatter and structure.
- No type/schema definition appears in more than one doc as a full
  re-declaration.
- `README.md` table = `ls docs/design/**/*.md` (no orphans, no broken links).
- All "Phase N — shipped ✅" tables are out of `docs/design/`.
