---
title: data-validation
target-version: 0.6.0
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# Sheet Data Validation & In-Cell Controls

## Summary

Add interactive in-cell controls to Sheets — **checkboxes**, **dropdown
lists**, and a **date/calendar picker** — via a data-validation model. A cell
control is not a floating object over the grid; it is a *special rendering of a
typed cell value* plus a click/keyboard affordance to mutate it. This is the
Google Sheets architecture (checkbox = boolean cell value, date = serial/ISO
value, list = text value), which survives sort/filter/copy and plugs straight
into formulas — as opposed to the legacy Excel floating Form Control/ActiveX
model, which stores nothing in the grid and drifts out of alignment.

Validation rules are stored at the worksheet level as a range-scoped rule array,
mirroring the existing `ConditionalFormatRule` infrastructure exactly. Cells
themselves are unchanged; the formula engine is unchanged. The value machinery
already exists (`BoolNode` boolean round-trip, `nf:'date'` ISO date storage), so
the work is a new rule model, a Canvas render pass, an interaction hit-test, and
a rule-management UI — each modeled on a working in-tree precedent.

### Reference: how Excel & Google Sheets do it

The crucial architectural distinction is **native cell-value control** vs.
**floating drawing-layer object**:

| Aspect | Google Sheets | Excel |
|---|---|---|
| Checkbox model | Native cell value (`TRUE`/`FALSE`) from the start | Native cell value since 2024 (M365 only); previously floating Form Control/ActiveX linked to a cell |
| Custom check values | Yes (custom Checked/Unchecked strings) | Native checkbox: fixed `TRUE`/`FALSE` |
| Native calendar date picker | **Yes** — double-click a date-formatted/validated cell | **No** — only legacy ActiveX (Win/32-bit), VBA, or add-ins |
| Date storage | Serial number + date format | Serial number + date format |
| Dropdown display | Colored chips (2023 redesign) | Plain-text list via Data Validation |
| Where "control-ness" lives | In the **cell value**, rendered specially | Native checkbox: in the cell. Legacy: floating object linked to a cell |

We adopt the Google Sheets model throughout: the control is a special render of a
real, typed cell value.

## Goals / Non-Goals

### Goals

- A worksheet-level `DataValidationRule[]` model, range-scoped, mirroring
  `ConditionalFormatRule`. Cells stay untouched; the formula engine stays
  untouched.
- Three control kinds: `checkbox`, `list`, `date`.
- In-cell rendering: checkbox glyph, dropdown arrow, and a warning marker for
  invalid values — reusing the filter-button render/hit-test precedent.
- Interaction: click/Space toggle for checkboxes; anchored popover for list;
  double-click calendar popover for date; validation on typed-value commit.
- Per-rule `onInvalid: 'reject' | 'warning'` for `list`/`date`.
- Rule management UI: quick `Insert → Checkbox`/`Insert → Dropdown` plus a
  `Data → Data validation` side panel.
- Values round-trip through the existing boolean (`BoolNode`) and date
  (`nf:'date'` ISO string) machinery — no formula-engine change.
- Read-only stores/permissions render controls but disable interaction.

### Non-Goals

- **List source = range reference** (e.g. `=Sheet1!A1:A10`). Initial version
  supports literal value lists only; range-backed lists are a follow-up.
- Colored dropdown **chips** and Google "smart chips" — plain-text list values
  only for v1.
- Custom formula-based validation criteria (`custom formula is …`).
- Floating drawing-layer controls (legacy Excel model) — explicitly rejected.
- Time-of-day picker; date picker handles calendar dates only.

## Proposal Details

### Data model

Add to `packages/sheets/src/model/core/types.ts`, mirroring
`ConditionalFormatRule` (`types.ts:126-133`):

```typescript
export type DataValidationKind = 'checkbox' | 'list' | 'date';

export type DataValidationRule = {
  id: string;
  ranges: Range[];
  kind: DataValidationKind;
  onInvalid?: 'reject' | 'warning';  // list/date only; ignored for checkbox

  // kind: 'list'
  list?: string[];         // explicit literal values (range source: follow-up)
  showArrow?: boolean;     // draw dropdown arrow glyph (default true)

  // kind: 'checkbox'
  checkedValue?: string;   // custom checked value (default: boolean "TRUE")
  uncheckedValue?: string; // custom unchecked value (default: boolean "FALSE")

  // kind: 'date'
  dateMin?: string;        // ISO lower bound, optional
  dateMax?: string;        // ISO upper bound, optional
};
```

**Value storage — cells are unchanged:**

- **checkbox**: cell `v` is `"TRUE"`/`"FALSE"` (or the custom strings). Reuses the
  existing boolean round-trip: formula engine `BoolNode`
  (`formula.ts:554`), stringified `"TRUE"`/`"FALSE"` (`formula.ts:542`), and
  input recognition (`input.ts:242-247`). Custom values are stored as text (GS
  parity — a custom `"1"` is the string, not the number).
- **date**: cell `v` is an ISO string with `s.nf='date'`, reusing the existing
  date machinery (`input.ts:267-294`, `format.ts:69-86`).
- **list**: cell `v` is the selected text.

A cell over a **formula** with a checkbox rule is read-only (the formula drives
the state), matching GS/Excel.

### Storage & Store interface

Add `dataValidations?: DataValidationRule[]` to `Worksheet`
(`worksheet-document.ts:57-98`) alongside `conditionalFormats`, and **seed it in
`createWorksheet`** (`worksheet-document.ts:122-149`) to avoid Yorkie LWW loss on
concurrent first-insert (same reason the existing map containers are seeded).

Add to the `Store` interface (`store.ts`) and all three implementations
(`MemStore`, `ReadOnlyStore`, `YorkieStore`), homomorphic to
`get/setConditionalFormats` (`store.ts:166-171`):

```typescript
getDataValidations(): DataValidationRule[];
setDataValidations(rules: DataValidationRule[]): Promise<void>;
```

Plus a lookup helper (range matching, exactly as conditional formats resolve a
cell's applicable rule):

```typescript
getValidationAt(ref: Ref): DataValidationRule | undefined;
```

Overlapping ranges: last matching rule wins (same policy as conditional
formats). No new per-cell field is added, so the `YorkieStore.normalizeCell`
whitelist (`yorkie-store.ts:209-250`) needs no change.

### Rendering (Canvas)

The filter button (`gridcanvas.ts:811-876` `renderCellFilterButton`) is the
working precedent for an in-cell interactive glyph: rounded button + cached
`Path2D` icon + hover state + `toCellRect` geometry (`gridcanvas.ts:1632`,
scroll/freeze/merge aware). Add a new **Pass 3.5** in `renderQuadrantCells`
(after content Pass 3, `gridcanvas.ts:590`), driven by `getValidationAt`:

- **checkbox**: draw a checkbox glyph (filled check if `v` equals the checked
  value, empty box otherwise) via a cached `Path2D`, replacing the value text
  (GS draws the box only, not the literal `TRUE`/`FALSE`).
- **list**: draw a dropdown-arrow glyph at the cell's right edge when
  `showArrow`. The value text is still drawn by the existing `renderCellContent`.
- **date**: no persistent glyph (GS parity — the calendar opens on double-click);
  existing `nf:'date'` render is unchanged.
- **warning marker**: for an `onInvalid:'warning'` rule whose cell value violates
  the rule, draw a small red triangle at the top-right, using the same technique
  as the comment marker (`gridcanvas.ts:687` `drawCommentMarker`, Pass 5).

Violation state is computed at render time (`getValidationAt` + value check); it
is never persisted.

### Interaction (mouse / keyboard)

Mirror the filter button's hit-test (`worksheet.ts:1194-1215`
`detectFilterButton`) and mousedown dispatch (`worksheet.ts:2531-2535`). Add
`detectValidationControl(x, y)` in `worksheet.ts`, branched **before** normal
cell selection:

- **checkbox click**: box hit → `store.set` toggles `v` between the checked and
  unchecked values, wrapped in `beginBatch`/`endBatch` (`store.ts:260-266`) for a
  single undo unit.
- **Space key**: if the selected cell/range carries a checkbox rule, toggle
  (range → set all checked, GS/Excel parity). Handled in the existing
  `worksheet.ts` key handler.
- **list arrow click / edit entry**: open a DOM popover anchored to the cell rect
  (reusing the filter-panel overlay pattern, `worksheet.ts:1220-1704`) listing
  `rule.list`; selection writes via `store.set`.
- **date double-click**: on a date-formatted or date-ruled cell, open a calendar
  popover (frontend shadcn calendar) anchored to the cell rect; selection writes
  the ISO value (GS parity).
- **typed-value commit validation**: in the `CellInput` commit path
  (`cellinput.ts`), run `getValidationAt` + value check. `reject` → discard the
  input, keep the previous value, show an error toast. `warning` → store the
  value; the render pass draws the red triangle.

Popover anchoring reuses `getFilterButtonRect` (`worksheet.ts:1167`) /
`Spreadsheet.getCellRect`. Read-only stores/permissions render controls but skip
the interaction branches.

### UI (rule creation & management)

Frontend components follow the filter-panel / pivot-editor-panel patterns; the
rule type and validation logic live in `packages/sheets` (model/Store) to keep
the package boundary clean.

- **Quick insert (menu)**: toolbar/context-menu `Insert → Checkbox` and
  `Insert → Dropdown` create a default rule over the current selection (GS/Excel
  parity).
- **Data validation side panel** (`Data → Data validation`, right-side slot):
  - Criteria: Checkbox / Dropdown (list) / Date
  - Per-kind detail: list values; date min/max; optional custom checkbox values
  - On invalid: Reject / Warning radio (hidden for checkbox)
  - View / edit / delete the current sheet's rules
- Rule writes go through `setDataValidations`; overlapping ranges → last rule
  wins.

### Implementation order

Ship in phases, each a self-contained PR:

1. **Checkbox** — model + Store + schema seed + render pass + click/Space toggle.
   (Boolean round-trip already exists, so this is the smallest slice.)
2. **List dropdown** — arrow glyph + anchored list popover + commit validation +
   `onInvalid`.
3. **Date picker** — calendar popover on double-click + `dateMin`/`dateMax`
   validation.

### Testing

- **model unit tests** (Vitest, `packages/sheets`): `getValidationAt` range
  matching (overlap/priority); checkbox value transitions (`TRUE`↔`FALSE`,
  custom); list/date validation (`reject`/`warning`, `dateMin`/`dateMax`
  boundaries); Store 3-impl round-trip for `get/setDataValidations`; Yorkie
  schema seed.
- **render regression**: checkbox / dropdown-arrow / warning-triangle glyph
  snapshots, following existing gridcanvas render tests.
- **collaboration**: two clients concurrently adding a rule / toggling a checkbox
  converge (existing collaboration test pattern).
- **manual smoke** (`pnpm dev`): insert each of the three controls → toggle /
  select → sort / copy and confirm the value moves with the cell.

### Risks and Mitigation

- **Yorkie concurrent first-insert LWW loss** — seed `dataValidations` in
  `createWorksheet` (as existing map containers are), so a concurrent first rule
  addition does not clobber the container. Mirrors the documented
  `worksheet-document.ts:137-143` pattern.
- **Overlapping-rule ambiguity** — adopt the conditional-format policy (last
  matching rule wins) rather than inventing new precedence; keeps user mental
  model consistent.
- **Custom checkbox values vs. formulas** — custom values are text, so
  `SUM`/`COUNTIF` behave differently than with boolean `TRUE`/`FALSE`. Default to
  real booleans; treat custom values as an opt-in documented caveat (GS parity).
- **Interaction ordering regressions** — the new `detectValidationControl` runs
  before selection in the mousedown path; guard it to only fire on a control hit
  so plain-cell selection/drag is unaffected, and cover with interaction tests.
- **Read-only / permission bypass** — gate every mutation branch (click, Space,
  popover write, commit) on store writability so shared/anonymous viewers cannot
  toggle controls.
- **Scope creep (range-backed lists, chips, custom formulas)** — explicitly
  deferred as Non-Goals; the literal-list v1 keeps the first cut shippable.
