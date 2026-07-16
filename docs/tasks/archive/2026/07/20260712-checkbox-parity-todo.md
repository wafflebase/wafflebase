# Checkbox parity follow-ups

Closes the Phase-1 deferred checkbox items in
`docs/design/sheets/data-validation.md` that are pure model/view (no open UI
design), bundled into one cohesive unit. Custom checked/unchecked-value UI and
eager `FALSE` materialization are left as separate follow-ups (the latter shares
the spill/pivot/cap concerns and warrants its own careful PR).

## Scope

1. **Range-uniform Space toggle** (GS/Excel parity) — pressing Space with a
   range selected toggles every checkbox-ruled, non-formula cell uniformly:
   all checked → uncheck all, otherwise check all. Single-cell = toggle that
   cell.
2. **Merged-cell checkbox hit-test** — a checkbox inside a merged cell now
   hit-tests against the full merged rect (renderer already draws the glyph
   there), via a new public `Sheet.getMergeRangeForRef`.

## Plan (TDD)

- [x] `checkboxValue(rule, checked)` model helper; `toggleCheckboxValue` on top.
- [x] `Sheet.toggleCheckboxesInRange(range)` via the **`removeData` pattern**
      (one batch + low-level `store.set` + `calculate`), not a `setData` loop.
- [x] Space handler (`worksheet.ts`) wired to `getRangeOrActiveCell()`.
- [x] `Sheet.getMergeRangeForRef(ref)` + `getCheckboxHitRect` merged-rect fix.
- [x] Tests: all/mixed/none uniform toggle; formula + spill-ghost skip; pivot
      no-op; non-checkbox untouched; cap bail (60k rule → no-op); formula
      dependent recompute; `getMergeRangeForRef` covered-cell resolution.
- [x] `pnpm verify:fast` green.
- [x] Design doc Phase-1 notes updated (Space parity, merged-cell, hardening).

## Review hardening (high-effort workflow review)

The first cut of `toggleCheckboxesInRange` shipped the happy path; a high-effort
review caught four issues, all fixed before PR:

- **Whole-column hang (CONFIRMED)** — it scanned every coordinate in the raw
  selection (up to 1M×18K). Now bounded to the checkbox rules' ranges ∩
  selection, with a `MaxCheckboxToggleCells` (50k) cap that bails to a no-op.
- **Spill-ghost corruption (CONFIRMED)** — it skipped only formula cells; spill
  ghosts have no `.f`. Now also skips `cell.spillAnchor`.
- **Pivot write (PLAUSIBLE)** — added the `if (this.pivotDefinition) return`
  guard every other write path has.
- **Custom-value normalization (PLAUSIBLE)** — the reviewer noted the range path
  stores the raw value while the single-cell path routes through
  `setData`/`inferInput`. Kept the raw store deliberately: `isCheckboxChecked`
  exact-matches custom values, so storing `"01"` verbatim is the *correct* side;
  the single-cell path's normalization is a separate latent issue.

## Out of scope (separate follow-ups)

- Eager `FALSE` materialization for `COUNTIF`/`SUM` (shares spill/pivot/cap
  concerns; own PR).
- Custom checked/unchecked values UI (frontend panel work).

## Review

(filled after merge)
