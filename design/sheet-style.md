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

Effective precedence is:

`sheet -> column -> row -> range patch -> cell`

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

## Copy/Paste

Internal copy buffer includes clipped `rangeStyles` intersecting copied range.
Internal paste translates those patches by destination delta and reapplies them,
preserving formatting even for empty copied ranges.

## Rendering

`GridCanvas` resolves effective style from all five layers and then renders:

- backgrounds
- custom borders (`bt/br/bb/bl`)
- text/decorations
- number format display

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

## UI Integration

- Keyboard shortcuts: `Cmd/Ctrl+B`, `Cmd/Ctrl+I`, `Cmd/Ctrl+U`,
  `Cmd/Ctrl+Shift+S` (strikethrough).
- `FormattingToolbar` controls all style properties and border presets through
  `Spreadsheet.applyStyle()`, `Spreadsheet.toggleStyle()`,
  `Spreadsheet.applyBorders()`.
