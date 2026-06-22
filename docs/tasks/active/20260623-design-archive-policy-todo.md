# Design Archive Policy — Redefine & Reorganize

## Problem

The current `docs/design/archive/` policy conflates two independent axes:

- **validity** — does the doc still describe current behavior?
- **load-bearing** — should a new contributor read it first?

It archives docs that are *still valid* (e.g. shipped single-PR UX notes)
merely because they are not load-bearing. That is the source of the
"archive purpose is ambiguous" confusion: archive currently means "valid
but not first-read", which overlaps with "obsolete".

## New model (agreed)

**Decision: remove the `archive/` concept entirely.** Collapse to a
single axis — **validity** — with two outcomes and no archive folder:

| State | Action |
| --- | --- |
| Valid design (describes current behavior) | **Fold** durable design into the canonical subsystem doc; delete the standalone file (git preserves the full PR note) |
| No longer valid (superseded / abandoned) | **Delete**; leave a one-line note in the successor doc / commit message pointing at the git history |

Canonical docs hold all living design. "single-PR-sized" stops being a
filing criterion — durable design lives in its subsystem doc regardless
of how it shipped. The guidance for obsolete docs (note in successor +
trust `git log`) moves into `docs/design/README.md`.

**Fold depth:** durable summary subsection — carry the data model /
behavior / key decision concisely in the canonical doc's own style; drop
the PR narrative (git preserves it).

## Current archive inventory → decision

All 11 current entries describe **still-valid** behavior, so all fold +
delete. Durable content carried into canonical doc; full PR note left to
git history.

| # | Archive doc | Still valid? | Fold target | Carry |
| --- | --- | --- | --- | --- |
| 1 | conditional-format-multi-range | yes | `sheets/sheet-style.md` | `ranges: Range[]` model (multi-range rules); drop migration mechanics |
| 2 | peer-cursor-labels | partial | `sheets/axis-id-selection.md` | transient label UX (4s auto-show, hover, edge clamping); presence-schema half already superseded there |
| 3 | docs-frontend-integration | yes | `frontend.md` | `Document.type` field + `/s/:id` vs `/d/:id` routing + dual-editor mount |
| 4 | slides-shape-move | yes | `slides/slides-shapes.md` | ghost-drag move + `move` cursor + `ghosts[]` render path |
| 5 | docs-ime-undo-history | yes | `docs/docs-intent-preserving-edits.md` | one composition = one undo unit; view-local interim (no interim doc.update) |
| 6 | docs-list-item-backspace-exit | yes | `docs/docs.md` | Backspace on empty list-item exits list (mirror splitBlock) |
| 7 | docs-mobile-zoom-to-fit | yes | `docs/docs.md` | zoom-to-fit `scaleFactor` (`ctx.scale`, hit-test inversion) |
| 8 | docs-table-ui | yes | `docs/docs-tables.md` | toolbar grid picker + cell context menu + IME cell routing |
| 9 | slides-shift-modifiers | yes | `slides/slides-keyboard-shortcuts.md` | Shift drag constraints (square / 15° angle / axis-lock) |
| 10 | slides-pasteboard | yes | `slides/slides.md` | variable pasteboard (canvas fills scrollHost, slideElevation) |
| 11 | slides-color-picker | yes | `slides/slides.md` | commit/record flags + per-doc `Meta.recentColors` |

## Plan

- [x] 1. Write/agree new policy (this file) and confirm fold-target mapping
- [x] 2. Fold each archive doc's durable design into its canonical target (concise subsection, canonical-doc style; no PR narrative)
- [x] 3. Delete the 11 standalone archive files
- [x] 4. Delete the entire `archive/` folder (11 docs + README)
- [x] 5. Update `docs/design/README.md`: remove Archive section; add short "Obsolete docs" policy note (note in successor + git)
- [x] 5b. Fix dead links to the removed archive paths (docs.md, docs-tables.md, slides.md, slides-multi-select-resize.md, slides-native-undo.md)
- [x] 6. Verify each folded fact against current code (caught 2 stale facts — see Review)
- [ ] 7. Self-review diff; `pnpm verify:fast` (running)
- [ ] 8. Update `tasks/README.md` index; lessons file; archive task
- [ ] 9. PR

## Review

### What changed

- Removed `docs/design/archive/` entirely (11 docs + README).
- Folded each doc's durable design as a concise subsection into its
  canonical subsystem doc (see mapping table above).
- Rewrote the design index's "Archive" section into an "Obsolete docs"
  policy: file by validity, fold valid single-PR notes, delete obsolete
  ones with a successor pointer + `git log`.
- Fixed 5 dead `../archive/...` links left in sibling docs.

### Validity audit (key outcome)

The premise "all 11 are still valid" was **not** fully true. Verifying
each folded fact against the code surfaced two stale designs:

1. **docs-table-ui IME cell routing** — claimed `position.cellAddress`
   + `insertTextInCell`/`deleteTextInCell`. The later Block[]-cells
   redesign removed that branch (docs-tables.md Key Decisions explicitly
   says no `cellAddress` on `DocPosition`). Reworded to the current
   no-special-routing reality + a one-line historical note.
2. **frontend dual→multi editor** — the old doc described 2 types
   (sheet/doc). Code now has 3: `sheet`/`doc`/`slides` → `/s/`,`/d/`,`/p/`.
   Updated the folded table to all three.

The other 9 facts were confirmed present in code (`ranges: Range[]`,
`ghosts?: readonly Element[]`, `constraints.ts`, `Meta.recentColors` +
`pushRecentColor`, pasteboard `slideOffsetLogical`/`slideElevation`,
`TableGridPicker`/`isInTable`, list-item Backspace branch, doc
`scaleFactor`, `visiblePeerLabels`/`peerLabelTimers`).
