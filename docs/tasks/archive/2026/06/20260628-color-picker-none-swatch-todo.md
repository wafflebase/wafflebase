# Color picker — unify "transparent / None" as a first-class swatch

## Problem

"Should the color palette offer a transparent color?" — investigated how
Google Slides / Sheets / Docs present color, then audited Wafflebase.

**Finding: the concept already exists but is implemented three different
ways**, which is the real problem:

- `ColorPickerGrid` (docs text/highlight, sheets text/bg) — a text
  **"Reset"** button (`onReset`).
- `table-controls` cell fill — a separate **"No fill"** `DropdownMenuItem`
  rendered *below* the `ThemedColorPicker`.
- shape fill (`shape-controls`) and slide background (`global-controls`) —
  **no clear/none affordance at all**.

Google's model (for reference):
- **None / No fill** (binary) is offered for fill-like contexts (fill,
  background, highlight, border), shown as a white swatch with a red
  diagonal. NOT offered for text color (text must stay visible → "Reset to
  default" instead).
- **Alpha / opacity** (continuous) is a Slides-only concern (layered
  canvas). Docs/Sheets are opaque models → no alpha. Out of scope here.

## Goal (this PR)

Unify the binary "None / No fill" affordance into the pickers themselves,
visualized consistently as a red-diagonal swatch, offered context-aware.

Non-goals (follow-up): alpha/opacity UI (Slides custom), HEX text input,
theme-color sections for docs/sheets.

## Plan

- [x] Shared `NoneSwatch` visual (white box + red diagonal), reusable,
      supports `selected` + `aria-label`/`title`.
- [x] `ColorPickerGrid`: render the reset/none affordance using the
      NoneSwatch; add optional `noneLabel` (default "Reset"); show selected
      state when no color is set. Keep `onReset` API (zero call-site churn).
      - highlight (docs) / bg (sheets) call sites pass `noneLabel="None"`.
- [x] `ThemedColorPicker`: add optional `onClear?` + `clearLabel?`
      (default "No fill"). When `onClear` given, render a "No fill" row with
      NoneSwatch at top; selected ring when `value === undefined`.
- [x] Wire `onClear`:
      - [x] shape fill (`shape-controls`) → `fill: undefined`
      - [x] cell fill (`table-controls`) → `applyStyle({ fill: undefined })`,
            and **remove** the now-redundant "No fill" `DropdownMenuItem`.
      - **Deferred** (see Review): slide background (`global-controls`) clear —
            inherited background, not a no-fill case; not wired.
- [x] Tests (TDD, `tests/` runner, `React.createElement` style):
      - [x] `ColorPickerGrid` renders None affordance, honors `noneLabel`,
            calls `onReset`.
      - [x] `ThemedColorPicker` renders "No fill" row only when `onClear`
            given; click calls `onClear`; selected when `value` undefined.
- [x] `pnpm verify:fast` green.
- [x] Self-review (code-review skill) over branch diff.
- [x] Note: visual baselines may need refresh if any open-picker scenario
      snapshots the new row (harness ThemedColorPicker scenario passes no
      `onClear`, so default render is unchanged).

## Review

Implemented and `pnpm verify:fast` green (EXIT 0).

**Shipped:**
- `NoneSwatch` shared visual (`components/none-swatch.tsx`) — white box +
  red diagonal, `selected` ring, presentational.
- `ColorPickerGrid` — clear/none control now a NoneSwatch; `noneLabel`
  (default "Reset"), optional `value` for selected state (`value === ""`).
  Highlight/bg call sites (docs highlight, sheets fill, text-format-group
  bg) pass `noneLabel="None"`.
- `ThemedColorPicker` — optional `onClear` + `clearLabel` (default
  "No fill"); renders the NoneSwatch row only when `onClear` given,
  selected when `value === undefined`.
- Wired `onClear`: shape fill (`shape-controls`, `fill: undefined`), cell
  fill (`table-controls`) — **removed** the redundant "No fill"
  `DropdownMenuItem`, consolidating into the picker.

**Tests (TDD):** 6 new (`color-picker-grid.test.ts`,
`themed-color-picker-clear.test.ts`), red→green verified.

**Self code-review (3 parallel finders, high effort) — addressed:**
- Table cell with a *string* fill falsely showed "No fill" as selected
  (string fill collapsed to `value=undefined`). Fixed: `table-controls`
  passes string fills as `{ kind: 'srgb', value }` so the picker knows a
  fill is set.
- `ColorPickerGrid.value` (selected-indicator) was dead — no caller passed
  it — and introduced a `value===""` vs `value===undefined` convention
  split with `ThemedColorPicker`. Removed the prop entirely (and its test);
  docs/sheets None-selected indicator deferred until wired with a value.
- Aligned `ColorPickerGrid` clear-control `aria-label` to the bare label
  (matches `ThemedColorPicker`).
- Documented the fixed-convention red in `NoneSwatch` (intentionally not a
  themeable token).
- Left as acceptable: ~10-line clear-row markup duplication across the two
  components (different trees; extraction not worth it yet).

### Follow-on slice — Transparency (alpha) slider (Slides Custom section)

Matches Google Slides: alpha lives in the **Custom color dialog**
(Fill/Border ▸ Custom ▸ Transparency slider), NOT a palette swatch and NOT
the Format panel (that's image-only). Model + canvas already support alpha
(`ThemeColor.alpha`; `resolveColor` → `rgba()`; `shape-renderer` /
`resolveStrokeColor` paint it) — only the UI was missing.

- [x] Helpers (TDD): `colorTransparencyPercent` (alpha→0–100, GS "0%=solid"
      convention) and `withAlpha` (clamps, drops field at opaque so
      `resolveColor` keeps its fast path). Unit-tested in
      `themed-color-picker.test.ts`.
- [x] `ThemedColorPicker`: `allowAlpha?` prop → Transparency `Slider` in the
      Custom section; live-applies (no commit/record, palette stays open);
      disabled when `value === undefined` (nothing to make transparent).
      DOM-presence + gating + disabled tests in
      `themed-color-picker-alpha.test.ts`.
- [x] Wired `allowAlpha` to all fill/border/background ThemedColorPicker
      sites: shape fill, border, cell fill, text-box fill, slide background
      (desktop + mobile). Glyph text color uses `ColorPickerGrid` → no alpha
      (correct — matches GS).
- [x] `pnpm verify:fast` green (EXIT 0).

**Deferred:** slide-background clear (inherited, not no-fill); HEX input;
docs/sheets selected-indicator wiring; per-tick store writes during
slider/native-input drag (pre-existing; could debounce into one undo unit).

**Pending before merge:** self code-review over the diff; manual smoke in
`pnpm dev` (UI change); possible visual-baseline refresh.
