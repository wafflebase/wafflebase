# Design docs archive cleanup — Todo

## Goal

Audit `docs/design/` for duplicates, task-character single-PR notes, and
docs whose content is absorbed elsewhere. Archive single-PR shipped notes,
merge two docs into their successor, keep the main index focused on
load-bearing subsystem references.

## Findings

- No true duplicates. Overlapping pairs are layered/complementary
  (formula vs formula-coverage, collaboration vs axis-id-selection,
  rest-api vs cli, the three docs collaboration/intent/caret layers).
- Several single-PR / issue-number notes act as de-facto task records
  while `docs/tasks/active/` is empty.

## Plan

### Tier 1 — archive (single-PR issue/viewport fixes)
- [x] `docs/docs-ime-undo-history.md` → archive/ (issue #318)
- [x] `docs/docs-list-item-backspace-exit.md` → archive/ (issue #338)
- [x] `docs/docs-mobile-zoom-to-fit.md` → archive/

### Tier 2 — archive (self-contained UX details)
- [x] `slides/slides-shift-modifiers.md` → archive/
- [x] `slides/slides-pasteboard.md` → archive/
- [x] `slides/slides-color-picker.md` → archive/
- [x] `docs/tables/docs-table-ui.md` → archive/
- [~] `context-menu.md` → **KEPT** (reversed): 6 active docs cite it as the
  canonical shared menu pattern → load-bearing, not single-PR. Removing it
  from the index would hurt, not help, TOC clarity.

### Tier 3 — merge into successor, then delete original
- [x] `slides/slides-toolbar-tier1.md` → folded into `slides-toolbar-redesign.md`
  (new "Tier 1 universal controls" section), original deleted
- [~] `slides/slides-layout-change.md` → **KEPT** (reversed): full read shows it
  defines the `placeholderRef` model + `applyLayoutToSlide` algorithm + ghost
  text — a load-bearing reference, not a UX note. themes doc confirmed to NOT
  cover this surface, so a merge would lose the algorithm. Cross-link added
  from toolbar-redesign instead.

### Index updates
- [x] Removed 7 rows from `docs/design/README.md` (3 docs + 3 slides archived + 1 merged tier1)
- [x] Added 7 archive rows to `docs/design/archive/README.md`
- [x] Fixed 3 cross-doc links (docs-tables→table-ui, multi-select-resize→shift-modifiers, keyboard-shortcuts→shift-modifiers)
- [x] Verified all README + archive links resolve; no dangling references

## Rejected from agent over-recommendations
- Kept: slides-group, slides-tables, slides-multi-select-resize (subsystem refs)
- Kept: sharing.md, batch-transactions.md (load-bearing mechanisms)
- Kept: homepage.md, docs-font-controls.md (living/shared surfaces)

## Review

**Outcome:** 7 docs archived (git mv, history preserved), 1 doc merged+deleted
(`slides-toolbar-tier1` → `slides-toolbar-redesign`). Main `docs/design/`
index dropped from 77 → 69 docs, focusing the TOC on load-bearing references.

**No true duplicates** were found — overlapping pairs are layered/complementary
(formula vs formula-coverage, collaboration vs axis-id-selection, rest-api vs
cli, the docs collaboration/intent/caret trio).

**Two agent recommendations reversed after closer reading** (judgment over
mechanical execution): `context-menu.md` (cited as canonical pattern by 6 docs)
and `slides-layout-change.md` (defines a model + algorithm, not a UX note) are
both load-bearing and were kept.

**Verification:** all README/archive links checked to resolve; no dangling
references after moves. Docs-only change.
