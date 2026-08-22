---
title: sheet-style
target-version: 0.1.0
---

# Sheet Style Logic

## Summary

This document extracts style-related behavior from `sheet.md` and describes how
formatting is stored, merged, rendered, and compacted.

## Style Model

Formatting is composed from five layers:

- **Sheet style** (`sheetStyle`) — defaults for all cells
- **Column styles** (`colStyles[col]`) — per-column overrides
- **Row styles** (`rowStyles[row]`) — per-row overrides
- **Range style patches** (`rangeStyles[]`) — ordered rectangle patches
- **Cell style** (`cell.s`) — per-cell overrides
- **Conditional format rules** (`conditionalFormats[]`) — ordered rule styles
  evaluated at render time

Effective precedence is:

`sheet -> column -> row -> range patch -> cell -> conditional`

Each `Cell` can carry `s?: CellStyle`, but rectangular styling is represented
through `rangeStyles` to avoid writing one style-only cell per coordinate.

```typescript
type TextAlign = 'left' | 'center' | 'right';
type VerticalAlign = 'top' | 'middle' | 'bottom';
type NumberFormat = 'plain' | 'number' | 'currency' | 'percent' | 'date';

type CellStyle = {
  b?: boolean;         // bold
  i?: boolean;         // italic
  u?: boolean;         // underline
  st?: boolean;        // strikethrough
  bt?: boolean;        // top border (custom border)
  br?: boolean;        // right border (custom border)
  bb?: boolean;        // bottom border (custom border)
  bl?: boolean;        // left border (custom border)
  tc?: string;         // text color (#hex)
  bg?: string;         // background color (#hex)
  al?: TextAlign;      // horizontal alignment
  va?: VerticalAlign;  // vertical alignment
  nf?: NumberFormat;   // number format
  cu?: string;         // explicit currency code for nf='currency'
  dp?: number;         // decimal places
};
```

## Write Semantics

Style patch merge uses 3-state semantics:

- `undefined` => inherit / no-op
- defined values (including `false`, `0`, `""`) => explicit override

### `setStyle(ref, style)`

- Merges style into one cell.
- Preserves explicit `false`/`0`/`""`.
- Removes empty cells after compaction (no value/formula/style payload).

### `setRangeStyle(style)`

Behavior depends on selection type:

- **Column selection**: write into `colStyles`.
- **Row selection**: write into `rowStyles`.
- **All selection**: write into `sheetStyle`.
- **Cell selection**: append a `rangeStyles` patch and only touch existing
  cell-level styles that conflict with the patch (to avoid redundant writes).

### `unsetRangeStyleValues(style)`

The reverse of `setRangeStyle`: it restores the *absence* of a value instead of
writing one. Keys are removed from the layers the current selection owns —
`sheetStyle` for an `all` selection, `colStyles` for a `column` selection,
`rowStyles` for a `row` selection, any `rangeStyles` patch whose range is
contained in the selection, and `cell.s` of cells inside it. Patches and cells
left with no keys at all are dropped.

The values in the patch are part of the request: a layer is rewritten only where
it holds *every* requested key at the requested value. Holding some of them is a
refusal, not a partial match — a cell with `nf: 'number'` and no `dp` beside it
describes a format nobody paired with a decimal count, and stripping the rest of
the request from it would flatten formatting the call does not own. That is what
keeps an unset off a currency cell inside a sheet-wide "one less decimal".

It returns `false` and writes **nothing** when a layer the selection does not own
sets one of the keys, when a layer inside the selection disagrees about the
value, or when nothing turned out to be removable at all. There is no
"explicitly none" token in the stored model, so an inherited value cannot be
masked — the caller has to fall back to writing an explicit value, which is also
the only way to reach a value that differs from what is inherited. Cells are
scanned before anything is written, so a refusal leaves the selection untouched.

Removing the last key from a column/row/sheet layer stores `{}` rather than
deleting the entry — the `Store` interface has no delete for those layers — so
`getStyle` can return `{}` where it used to return `undefined`. Every consumer
reads keys off it optionally, so an empty style resolves exactly like no style.

### `toggleRangeStyle(prop)`

- Computes from active cell effective style, then applies via `setRangeStyle`.
- Repeated toggles on the same range do not keep appending patches due to tail
  rewrite/compaction.

## Range Patch Lifecycle

`rangeStyles` is maintained in apply order and compacted during writes.

Compaction rules:

- same-range tail updates rewrite the tail patch instead of appending
- identical-style adjacent/contained ranges merge
- fully absorbed no-op appends are skipped
- older patches fully shadowed by later identical-style supersets are pruned
- default-only no-op keys are pruned when no style source in that range needs
  overriding (for example dropping `b: false` when nothing is bold upstream)

## Structural Remapping

On insert/delete/move rows or columns, range patches are remapped with the same
index mapping rules as cells:

- insert inside a styled range expands that range (inserted rows/columns
  inherit formatting)
- delete/move may split ranges deterministically when needed
- adjacent split fragments with identical styles are coalesced

This keeps style behavior stable across structural edits while reducing patch
count growth.

Per-cell custom borders (`bt/bl/br/bb`) — produced by `setRangeBorders` — are
stored on individual cells, not as range patches, so the range-expansion rule
above does not apply to them directly. Instead, after a row/column insert, the
sheet scans the two cells flanking the insertion seam in each populated
column/row and writes the borders that were continuous across the seam onto
the inserted cells:

- row insert: shared `bl`/`br` between row `index-1` and row `index+count`
  extends into every inserted row at that column
- column insert: shared `bt`/`bb` between column `index-1` and column
  `index+count` extends into every inserted column at that row

The result matches Google Sheets: an outer border drawn around `A1:B2` stays
unbroken when a row is inserted between rows 1 and 2.

## Copy/Paste

Internal copy buffer includes clipped `rangeStyles` intersecting copied range.
Internal paste translates those patches by destination delta and reapplies them,
preserving formatting even for empty copied ranges.

## Rendering

`GridCanvas` resolves effective style from all base layers plus conditional
rules and then renders:

- backgrounds
- custom borders (`bt/br/bb/bl`)
- text/decorations
- number format display

Conditional formatting is applied at render time on top of static style layers,
using rule list order (later matching rules override earlier ones). Supported
rule style keys are `b`, `i`, `u`, `tc`, and `bg`.

Each rule applies its condition and style to one or more ranges
(Google-Sheets parity), e.g. `A1:B10, D1:E10, G1:G20`:

```typescript
type ConditionalFormatRule = {
  ranges: Range[]; // one or more [Ref, Ref] areas
  // ...condition + style
};
```

Style resolution matches a point with `rule.ranges.some(r => inRange(point, r))`.
Shift/move iterate every range and drop any range that collapses to zero size,
dropping the whole rule if all of its ranges go. The frontend edits ranges as
comma-separated text (`A1:B10, D1:E10`) that is parsed and joined; there is no
multi-select-via-Ctrl+click UI.

`CellInput.applyStyle` mirrors active-cell effective style in inline editor.

Custom borders are rendered above default gridlines. Text overflow into empty
neighbor cells is bounded by explicit custom borders.

## Number Formatting and Input Inference

`formatValue(value, format)` renders display text using locale-aware formatting:

- `'number'`, `'currency'`, `'percent'` use locale separators
- `'currency'` uses `CellStyle.cu` when present, otherwise locale-derived code
- `'percent'` expects normalized fractional values (`0.1234 -> 12.34%`)
- `'date'` formats parseable date values with locale date style

`setData` inference updates formatting conservatively:

- `$...` / `₩...` => `nf: 'currency'` + `cu`
- `...%` => `nf: 'percent'`
- `YYYY-MM-DD` / `M/D` => `nf: 'date'`

Existing style keys are preserved; inferred format keys are updated only when
inference positively detects a matching type.

### Increase / decrease decimal places

`Sheet.changeDecimals(delta)` steps `dp` for the selection and is reversible
**wherever restoring inheritance renders identically** — a narrower guarantee
than "always", chosen deliberately and stated here as the scope: equal numbers of
increases and decreases leave such a selection exactly as they found it,
including leaving no `dp`/`nf` on a cell that had none. That covers the case the
buttons are actually used in — an ungrouped value with no format of its own —
and it is a guarantee about *state*, not only about pixels.

Where the two conflict, rendering wins and the state is not restored. The unset
is refused, and the selection keeps a `{dp, nf: 'number'}` residue instead of
returning to no style, in exactly two situations: a value large enough to be
grouped (`1234.5`, whose separators live in the `nf` the unset would drop) and a
`nf: 'number'` the user chose themselves (indistinguishable from one the buttons
wrote, since nothing records provenance). Both are accepted deviations from the
absolute wording of the issue, not oversights — the alternative is silently
changing what a cell displays, or destroying a format the user set. The rules
below are what decide which case applies; the "Consequences" list restates each
deviation with its reason.

`getActiveDecimalState()` reports three things about the active cell — the `dp`
to step from, `valueDp` (the precision the raw value already shows: `2` for
`12.34`, `0` for `12` or an empty cell) and `explicitDp` (whether any layer
stores `dp`). The unset fires only when all of this holds:

- the step lands exactly on `valueDp` and `dp` is stored (`explicitDp`), and
- the step was not clamped at the floor — a Decrease with nothing left to give
  reverses nothing, so it writes `dp: 0` and leaves any stored format in place
  rather than unsetting it, and
- the unset would leave every cell in the selection reading exactly as the
  explicit step would have written it (`unsetKeepsRendering`, which compares
  `formatValue` with the keys removed against `formatValue` at the step's
  target). Each cell is judged through **its own** effective format, not the
  active cell's: a selection is not uniform, and a neighbour rendering through
  `percent` loses different digits from the plain cell the step was read from.

That last check is the whole safety rule, because an absent `dp` does **not**
mean "the value's own precision":

- a neighbour holding more digits would jump back to them instead of following
  the step;
- `nf: 'number'` groups thousands, so dropping it flattens `1,234.5` to
  `1234.5`;
- for `currency`/`percent` an absent `dp` means the *format's* default of 2, so
  unsetting a `dp: 0` currency would show more decimals, not fewer.

Otherwise `changeDecimals` writes `dp` explicitly (plus `nf: 'number'` when the
active cell's format is plain, as before). That `nf` goes in as a **default**,
not an override — `setRangeStyle(patch, { defaultKeys: ['nf'] })` — because a
step is about digits: a selected neighbour rendering through its own
`percent`/`currency`/`date` format keeps it instead of being converted to
`number`, which would turn `50.0%` into `0.5`. A format the cell only *inherits*
(from the sheet, a column or a row) is pinned onto the cell, since the range
patch the step appends sits above those layers and would otherwise shadow it.
When it does unset and the format is `'number'`,
the `nf` goes with the `dp`: `nf: 'number'` renders 2 decimals with no `dp`, so
leaving it behind would change what is on screen. Any other format keeps its
`nf` and gives up only the `dp`.

Consequences worth knowing:

- `dp` is **not** in `DefaultStyleValues`, so `dp: 2` is stored rather than
  pruned. Pruning it would make "no stored `dp`" and "`dp: 2`" the same state,
  and `explicitDp` — the signal that a stored `dp` is the buttons' own to remove
  — would be wrong.
- Nothing records *who* wrote `nf: 'number'`. A cell the user gave a number
  format can therefore lose it when its `dp` is stepped back down to the value's
  own precision; Google Sheets keeps a format there. Since provenance is
  unavailable, the rule is about effect: the unset only fires where nothing on
  screen moves, so the format is only ever dropped where it was rendering
  nothing the plain value does not already render.
- A value large enough to be grouped (`1234.5`) therefore keeps a
  `{dp, nf: 'number'}` residue after an equal number of increases and
  decreases, rather than returning to no style at all. That is the deliberate
  trade: a residue that renders correctly beats a format silently destroyed.
- The step is read from the active cell, as it always was. When the active cell
  has no stored `dp` and nothing left to give, Decrease is a no-op rather than
  writing `dp: 0` — writing it is exactly the residue this rule exists to avoid.
  That no-op is checked against the whole selection, though: if another selected
  cell still *shows* decimals — as rendered, so a `12` under `nf: 'number'`
  displaying `12.00` counts — the step is written after all, because a selection
  with something to drop is not a no-op. When the active cell *does* store a
  `dp` and sits at zero, Decrease still writes `dp: 0` so the rest of the
  selection can follow it down; the format stays put, since a clamped step is
  not a reversal of anything.
- `dp` is bounded at both ends. `MAX_DECIMAL_PLACES` (20) is the largest
  fraction-digit count `Intl.NumberFormat` accepts on every engine wafflebase
  runs on — above it the call is a `RangeError` — so Increase stops there and
  `formatValue` clamps whatever it is handed (`clampDecimals`) rather than
  trusting a stored `dp`. A `dp` can arrive from an `.xlsx` import or a
  collaborator, and an uncaught throw on a paint path takes down every render of
  the shared document; `safeFormat` therefore also degrades — locale, then
  options, then a bare number — instead of rethrowing the same rejected
  arguments.
- The clamp guards the *step* as well as the render: `getActiveDecimalState`
  reports a stored `dp` through `clampDecimals`, so the number the buttons step
  from is the one the cell shows. Otherwise a stored `400` would cost 380
  presses that change nothing on screen, and a stored `NaN` would step to `NaN`
  and be written straight back — wedging the control permanently, since every
  comparison against `NaN` is false.
- `renderedDecimals` answers "how many digits does this cell show", and has to
  agree with `formatValue` for the same input. For a `currency` with no stored
  `dp` that is the currency's own convention rather than a flat 2 — `formatValue`
  leaves the fraction-digit options off so `Intl` applies it, giving none for
  `KRW`/`JPY` and three for `KWD`.

## UI Integration

- Keyboard shortcuts: `Cmd/Ctrl+B`, `Cmd/Ctrl+I`, `Cmd/Ctrl+U`,
  `Cmd/Ctrl+Shift+S` (strikethrough).
- `FormattingToolbar` controls all style properties and border presets through
  `Spreadsheet.applyStyle()`, `Spreadsheet.toggleStyle()`,
  `Spreadsheet.applyBorders()`.
