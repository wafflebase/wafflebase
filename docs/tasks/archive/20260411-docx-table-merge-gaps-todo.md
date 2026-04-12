# DOCX table merge / structure import hardening

**Status:** done
**Branch:** `docx-table-merge-hardening`
**Scope:** `packages/docs/src/import/docx-importer.ts`, `packages/docs/src/import/docx-style-map.ts`

## Background

`a7bac962` fixed horizontal-merge placeholder padding and `40539722`
fixed the nested `tblGrid` leak. A follow-up review of table merge
import surfaced several edge cases that still break the
`cells.length === numCols` contract, plus adjacent table-style gaps.
Fix them one item at a time with a regression test per change.

## Merge correctness (priority: high)

- [x] **1. `w:gridBefore` / `w:gridAfter`** — honor the `trPr` skip
      markers (`gridBefore(w:val=N)` / `gridAfter`) by padding the
      row head or tail with `colSpan=0` placeholders. Without this,
      rows that leave leading/trailing grid columns empty end up
      with `cells.length < numCols` and click/layout misalign.
      Common in Korean government docs.
      → Added a `readGridSkip` helper that reads the trPr skip value
      and pushes covered cells at the row start / end.

- [x] **2. vMerge shape mismatch defense** — if row N declares
      `vMerge=restart` with `gridSpan=3` but row N+1 declares
      `vMerge=continue` with `gridSpan=1`, the placeholder count no
      longer matches the owner's width. Record the owner's
      `gridSpan` on the tracker at restart and widen the
      continue's effective span to that value so the row stays
      rectangular.
      → Added `colSpan` to the vMergeTracker entry and use
      `Math.max(cellSpan, owner.colSpan)` on the continue path.

- [x] **3. Orphan vMerge continue** — a `vMerge=continue` tc that
      has no prior restart (some writers leave these behind when
      the anchor row is deleted) used to silently push covered
      placeholders with no owner, making those grid positions
      unreachable. Promote the first continue to a standalone
      owner instead.
      → When the tracker has no entry for the column, fall through
      from the continue branch to the owner path.

- [x] **4. Clamp out-of-range `gridSpan`** — a tc can declare
      `w:gridSpan` larger than the remaining grid room. Without
      clamping, `colIdx` walks past `numCols` and the row ends
      up longer than every other row. Clamp to
      `Math.min(colSpan, numCols - colIdx)`. Fall back to the
      existing behavior when `tblGrid` is missing.
      → Clamp applies only when `numCols > 0`, on both the owner
      path and the `vMerge=continue` effective-span path.

- [x] **5. Final row-shape normalize** — last-line safety net. At
      the end of each row, pad the tail with placeholders when
      `cells.length < numCols` and truncate when it exceeds
      `numCols`. Downstream layout, rendering, click routing, and
      the exporter all assume rectangular rows, so this guarantees
      the contract even when any of 1–4 misses a case.
      → Only active when `tblGrid` is present; skipped otherwise so
      we do not invent a column count.

## Table style / structure gaps (priority: medium)

- [ ] **6. `w:tcMar`** (cell margin/padding) → map to `CellStyle.padding`
- [ ] **7. `w:vAlign`** (cell vertical alignment) → map to `CellStyle.verticalAlign`
- [ ] **8. `w:tblBorders` inheritance** — fall back to table-level
      `tblBorders` when a cell has no `tcBorders` of its own
- [ ] **9. `w:trHeight`** → map to `TableData.rowHeights`

## Exporter hardening (separate, pre-existing)

- [ ] **E1. Exporter treats every `colSpan === 0` cell as
      `<w:vMerge/>`** — `docx-exporter.ts:211-214` maps any covered
      placeholder to a vertical-merge continuation. The importer
      (and `Doc.mergeCells`) uses `colSpan: 0` for *all* covered
      positions, so horizontal merges already round-trip as bogus
      vMerge markup today. Fix the exporter to disambiguate:
      - a covered position already absorbed by a prior `gridSpan`
        in the same row should not emit a tc at all;
      - a covered position whose owner lives in an earlier row
        (real vertical merge) should emit `<w:vMerge/>`;
      - `gridBefore` / `gridAfter` should be emitted via `trPr`
        skip markers rather than synthetic tcs.
      Not in scope for PR #118 (import-side only), but should land
      before we ship any round-trip story.

## Revisit later

- [ ] **10. `w:tblW` / `w:tcW`** — currently only the `tblGrid`
      ratios are used. Decide whether table/cell width overrides
      need to be honored.
- [ ] **11. Support tables inside header / footer parts**
- [ ] **12. Replace nested-table flattening with native rendering**
      on the word-processor roadmap.

## Working rules

- One vitest fixture per item → implementation → confirm with
  `pnpm --filter @wafflebase/docs test docx-importer`.
- One commit per item (subject ≤70 chars, body explains the *why*).
- After everything is done, update the table section in
  `docs/design/docs/docs-docx-import-export.md`.
- `pnpm verify:fast` must pass before closing the task.

## Review

- Item 1 (`7f9c85c6`): gridBefore/gridAfter padding landed with two
  fixtures (leading and trailing skip markers).
- Item 2 (`ab92105a`): owner `colSpan` is now tracked on the vMerge
  entry; mismatched continue rows widen to the owner's span.
- Item 3 (`c3745b8b`): orphan continue cells become standalone
  owners so their content stays reachable.
- Item 4 (`2efceea0`): gridSpan values that overrun `numCols` are
  clamped on both owner and continue paths.
- Item 5 (`3f817087`): final pad-or-truncate pass enforces
  `cells.length === numCols` as a safety net.
- PR #118 review pass: gated `gridBefore`/`gridAfter` padding on
  `numCols > 0` to match the rest of the hardening, plus matching
  gridless regression fixtures. Added exporter disambiguation (E1)
  as a separate follow-up item.
