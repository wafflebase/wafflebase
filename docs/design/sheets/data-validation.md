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
`get/setConditionalFormats` (`store.ts:166-171`) — note the `Store` surface is
`Promise`-based:

```typescript
getDataValidations(): Promise<DataValidationRule[]>;
setDataValidations(rules: DataValidationRule[]): Promise<void>;
```

Plus a pure model helper (range matching, exactly as conditional formats resolve
a cell's applicable rule — lives in the `data-validation.ts` module, not on the
Store):

```typescript
resolveDataValidationAt(point: Ref, rules: DataValidationRule[]): DataValidationRule | undefined;
```

Overlapping ranges: last matching rule wins (same policy as conditional
formats). No new per-cell field is added, so the `YorkieStore.normalizeCell`
whitelist (`yorkie-store.ts:209-250`) needs no change.

### Rendering (Canvas)

The filter button (`gridcanvas.ts:811-876` `renderCellFilterButton`) is the
working precedent for an in-cell interactive glyph: rounded button + cached
`Path2D` icon + hover state + `toCellRect` geometry (`gridcanvas.ts:1632`,
scroll/freeze/merge aware). Add a new **Pass 3.5** in `renderQuadrantCells`
(after content Pass 3, `gridcanvas.ts:590`), driven by `resolveDataValidationAt`:

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

Violation state is computed at render time (`resolveDataValidationAt` + value check); it
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
  (`cellinput.ts`), run `resolveDataValidationAt` + value check. `reject` → discard the
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

### Phase 1 (checkbox) — as shipped

Phase 1 landed the full model/Store spine plus checkbox end-to-end. A few
behaviors differ from the intent sketched above; they are deliberate Phase-1
simplifications, each a small follow-up to close:

- **Lazy value materialization** — `Spreadsheet.insertCheckbox(range, id)` creates
  the rule only; it does **not** pre-write `FALSE` into empty cells. An empty cell
  under a checkbox rule renders unchecked (`isCheckboxChecked(rule, undefined) ===
  false`) and a value (`"TRUE"`/`"FALSE"`) is written on first toggle. This avoids
  mass cell writes / batch nesting. (So `COUNTIF(range, FALSE)` won't count
  never-toggled cells until they're materialized — a follow-up may eager-init.)
- **Click target** — clicking the checkbox glyph rect toggles it (and selects the
  cell); a click elsewhere in the cell selects without toggling. The renderer and
  the click hit-test share one `computeCheckboxBox(cellRect)` geometry helper
  (`gridcanvas.ts`); the hit-test normalizes `getCellRect` out of zoom space
  before clamping so the clickable target matches the drawn glyph at every zoom
  level. Toggle is gated on writability and left-button; right-click opens the
  context menu. (Known caveat: for a checkbox inside a *merged* cell the glyph is
  centered in the full merged rect while the hit-test uses the anchor cell's rect
  — a rare configuration, deferred.)
- **Space** — toggles the **active cell** only. Range-uniform Space ("set all
  checked", GS/Excel parity) is deferred.
- **Structural edits** — rules follow row/column insert/delete/move in three
  places that must stay in lockstep: the `Sheet` synced cache, `MemStore`, and the
  Yorkie document helper (`yorkie-worksheet-structure.ts`). All three route through
  the shared `shiftRuleRanges`/`moveRuleRanges` helper (`rule-ranges.ts`).
- **Formula guard + case-insensitivity** (fixed as a follow-up) — `toggleCheckboxAt`
  now no-ops over a formula cell (returns `false`, leaves `cell.f` intact), so a
  formula-backed checkbox is read-only as intended; both the click and Space
  paths route through it. `isCheckboxChecked` matches the default boolean
  `TRUE`/`FALSE` case-insensitively (a lowercase `"true"` from xlsx import / REST
  API / external paste now renders checked), while a rule with *either* custom
  value (`checkedValue`/`uncheckedValue`) stays an exact string match (GS parity;
  case-folding a custom `uncheckedValue: "true"` would otherwise invert state).
  Canonical `TRUE`/`FALSE` compare without allocating on the per-repaint path.
- **UI** — a single flat checkbox toolbar button (desktop + mobile menu) that
  **toggles**: when the active cell is already a checkbox the button shows an
  active/"Remove checkbox" state and clicking strips the checkbox rules
  intersecting the selection (leaving the `TRUE`/`FALSE` values, matching Google
  Sheets); otherwise it inserts a checkbox rule. Removal is whole-rule
  (`Sheet.removeCheckbox` drops any checkbox rule intersecting the selection);
  precise range-subtraction and the full `Data → Data validation` side panel are
  deferred to a later phase.

### Phase 2 (list / dropdown) — as shipped

Phase 2 landed the `kind: 'list'` dropdown end-to-end, reusing the Phase-1
model/Store/structural-edit spine unchanged (the `list`/`showArrow`/`onInvalid`
fields already existed on `DataValidationRule`). What shipped:

- **Model** (`data-validation.ts`) — `normalizeListOptions` (trim / drop-empty /
  dedupe), `listOptionsOf`, and `isValidListValue` (empty value always allowed,
  GS parity). `normalizeDataValidationRule` now drops a list rule with no usable
  options and defaults `showArrow` to `true`.
- **Sheet / Spreadsheet API** — `insertList(range, id, options, onInvalid?)` /
  `removeList(range)` mirror the checkbox pair; `getListRuleAt` / `isListActive`
  back the toolbar. `onInvalid` defaults to `warning`.
- **Render** (`gridcanvas.ts`) — list cells keep their text (unlike checkbox,
  which replaces it) and overlay a right-aligned chevron via
  `computeListArrowBox` + a cached `Path2D`, background-masked so text doesn't
  bleed under it. A **warning-mode** rule draws a red top-right triangle when the
  cell value isn't in the list — computed at render time, never persisted.
- **Interaction** (`worksheet.ts`) — `getListArrowHitRect` (zoom round-trip like
  the checkbox) gates a mousedown branch that opens an anchored DOM popover
  (modeled on the filter panel) listing the options; click or `Alt+ArrowDown`
  opens it, Up/Down/Enter/Esc navigate, selection writes via `setData`.
  Commit-path validation runs in `finishEditing` via `commitCellValue`: a
  `reject` rule discards an out-of-list typed value (the editors self-restore
  through `FormulaBar.render()`) and fires an `onValidationError` callback;
  `warning` stores the value and lets the render pass mark it.
- **Frontend** — an `IconSelect` toolbar button (desktop + mobile) opens a
  minimal `DropdownOptionsDialog` (values one-per-line + Reject/Warning radio);
  editing an existing list cell prefills and offers Remove. The reject callback
  surfaces a `sonner` toast.

Editing an existing dropdown edits the rule **in place by id**
(`updateListRule`), preserving its full ranges — opening the dialog on a single
cell inside a larger ruled range and saving does not shrink the rule onto that
cell, and it is a single undo unit. An out-of-list value draws the red marker
under **either** mode (an invalid value can arrive via paste/API/pre-existing
content even under a `reject` rule, so the marker is the universal signal).
Membership comparison is whitespace-tolerant (typed `"Yes "` matches option
`"Yes"`). A `reject` that blocks a typed Enter/Tab keeps the caret on the cell
(GS parity) rather than advancing off the discarded entry.

Deliberate Phase-2 simplifications / follow-ups:

- **Literal lists only** — range-source lists (`=Sheet1!A1:A10`) and colored
  chips remain Non-Goals.
- **No full side panel** — the options dialog stands in for the eventual
  `Data → Data validation` panel; rule creation/removal is whole-rule (insert
  replaces any list rule intersecting the range; remove drops it), no
  range-subtraction; edit is in-place by id.
- **Reject enforced only on inline edit** — the `finishEditing` commit path
  enforces `reject`; paste / REST-API / programmatic `setData` writes are not
  blocked (what "reject" means for a bulk paste is an open design question).
  Such values are stored but always draw the red marker, so they are never
  silent. A follow-up may enforce at the model write layer.
- **Numeric-looking options** — options like `'007'` or `'1.0'` are normalized
  by `setData` on write (→ `7` / `1`), so a picked value can mismatch its option
  string and draw a false warning marker. Text-value dropdowns (the common case)
  are unaffected; forcing list cells to text is a follow-up.
- **Warning marker vs. comment marker** — both live at the top-right corner; a
  cell that is both commented and validation-warned overlaps them (rare,
  deferred).
- **View-layer interaction is manually smoke-tested** — matching the Phase-1
  checkbox precedent, the hit-test / popover paths have no automated coverage;
  the model helpers, the seed round-trip, and the Enter/Tab reject-navigation
  keymap are unit-tested.

### Phase 3 (UI): Data validation side panel — design

The Phase-1/2 UI is quick-insert only: a checkbox toolbar toggle and a dropdown
toolbar button that opens a minimal `DropdownOptionsDialog`. This phase replaces
that dialog with a **right-side management panel**, mirroring
`ConditionalFormatPanel` exactly (the two features are structurally identical —
a worksheet-level, range-scoped rule array with a list + editor UI). Google
Sheets surfaces data validation the same way (Data → Data validation panel).

**Scope (v1):** `checkbox` and `list` only — the two shipped kinds. Date,
number, text, and custom-formula criteria remain follow-ups (no engine change).
Rule management is **whole-rule** (add / edit / delete a rule; no
range-subtraction), matching the current `insert*`/`remove*` semantics.

**Component & placement**

- New `DataValidationPanel.tsx` (lazy-loaded), sharing the **same right-side
  slot** as `ConditionalFormatPanel` and the chart editor — only one is open at
  a time (mutually exclusive, as the existing panels already are).
- Same props as the CF panel: `{ spreadsheet, open, onClose, getSelectionRange }`.
- Reuses the CF panel's `parseA1Ranges` / `formatA1Ranges` A1 helpers (extract to
  a shared module if convenient, else copy the small helpers — they are already
  duplicated-ish across panels).

**Panel structure** (CF-panel layout)

- **Rule list** — the current sheet's `DataValidationRule[]`, each row showing
  its range + a kind summary (e.g. `A1:A10 · Dropdown (Red, Green, …)`,
  `B2:B5 · Checkbox`); select to edit, delete button per row.
- **Editor** (on add / select):
  - **Range** — A1 input, prefilled from the current selection.
  - **Criteria** — `Checkbox` / `Dropdown` select.
  - **Dropdown detail** — options (one per line) + `showArrow` toggle +
    **On invalid**: Reject / Warning radio.
  - **Checkbox detail** — none in v1 (values fixed to `TRUE`/`FALSE`); custom
    checked/unchecked values are a deferred advanced option.
  - **Add rule / Done / Delete rule** actions.

**Data flow** — no engine change. Load via `spreadsheet.getDataValidations()`;
write via `setDataValidations(rules)` (single atomic write = one undo unit),
exactly as the CF panel uses `get/setConditionalFormats`. Editing an existing
rule preserves its `id`/ranges (as `updateListRule` already does).

**Entry points**

- **Toolbar** → a single `Data validation` button (`IconListCheck`, desktop +
  mobile) opens the panel. It replaces the previous separate checkbox-toggle and
  dropdown buttons — all validation (checkbox and dropdown) is created/edited in
  the panel now (criteria = Checkbox or Dropdown). The button shows an active
  state when the active cell already carries a rule.
- **Context menu** → a `Data validation` item (in the sheet body right-click
  menu) opens the panel for the current selection. Included in v1.
- Both entry points open the panel with no auto-add; the user clicks **Add** (or
  selects the existing rule at the active cell) — so there is no `autoAddKind`
  seeding. `DropdownOptionsDialog` is removed.

**Non-goals (v1):** date/number/text/custom-formula criteria; range-source
lists; colored chips; per-cell range subtraction; custom checkbox values.

#### As shipped

`packages/frontend/src/app/spreadsheet/data-validation-panel.tsx` — a
lazy-loaded panel sharing the CF/chart right-slot (mutually exclusive). Added
`Spreadsheet.setDataValidations` and `Spreadsheet.getDataValidationAt` (any-kind
resolver). A single `Data validation` toolbar button (replacing the earlier
separate checkbox-toggle and dropdown buttons) and a `Data validation`
context-menu item both open the panel with no auto-add — the user clicks **Add**
or the panel selects the existing rule at the active cell.
`DropdownOptionsDialog` was deleted. A high-effort branch review drove several
fixes: the panel does not persist an option-less (in-progress) list rule, so
switching a checkbox rule to Dropdown no longer drops it; switching criteria to
Checkbox keeps the list options so a round-trip back to Dropdown preserves them;
a reject-mode dropdown lets a **formula** entry through (validated by its
computed value at render, not its literal text); the option popover flips above
the cell when it would overflow the viewport bottom; the hover-tooltip skips its
async cell read while the pointer stays on one cell; and the now-unused
`insertList`/`removeList`/`updateListRule` engine methods were removed (the panel
writes exclusively through `setDataValidations`).

Known limitations (documented, deferred): the panel writes the whole rule array
from a snapshot taken on open, so a concurrent remote rule change made while the
panel is open can be clobbered (identical to `ConditionalFormatPanel`); reject
mode is enforced only on typed commit, not paste/API (an invalid pasted value is
stored but always draws the red marker); the red validation marker and the
yellow comment marker share the top-right corner (the comment wins when a cell
has both). Two review-caught
behaviors were fixed during implementation: the field-sync effect is keyed on
`selectedRuleId` only (so in-progress range/options edits aren't reverted by a
sibling field edit), and the auto-add gate uses the any-kind
`getDataValidationAt` (so a checkbox-ruled cell isn't given an overlapping
auto-added rule). The panel keeps an in-progress zero-option dropdown visible in
its own state for the session even though the engine normalizes it out of the
persisted array until it has ≥1 option. Verified by frontend+sheets typecheck,
the full unit suite, and a production build; the interactive panel smoke runs in
the authenticated app (deferred to a manual pass).

### Phase 4 (date): operator-based date validation + calendar picker — design

Phases 1–3 shipped `checkbox` + `list` (model/Store spine, render pass,
interaction, and the side panel). The `date` kind exists in the
`DataValidationKind` union and the `Kinds` set but is otherwise a stub — no
render, no interaction, no panel entry, and the two placeholder fields
(`dateMin`/`dateMax`) are never read. This phase implements `date` end-to-end
with the **full Google Sheets operator set** and a **calendar picker**.

**Scope (confirmed):** full GS date operators; calendar picker included;
fixed-date operands only (relative operands like "today"/"past week" are a
deferred follow-up). Reuses the Phase-1/2 Store/structural-edit/panel spine
unchanged.

**Model** (`types.ts` + `data-validation.ts`) — replace the two unused
`dateMin`/`dateMax` fields with a **generic operator model**, intentionally
shaped for reuse by the planned `number`/`text` kinds:

```typescript
export type DataValidationOperator =
  | 'dateValid'                                  // is a valid date — 0 operands
  | 'dateEquals'
  | 'dateBefore' | 'dateOnOrBefore'
  | 'dateAfter'  | 'dateOnOrAfter'               // 1 operand
  | 'dateBetween' | 'dateNotBetween';            // 2 operands

export type DataValidationRule = {
  // …existing id/ranges/kind/onInvalid/list/showArrow/checkbox fields…
  operator?: DataValidationOperator;   // kind: 'date' (future: number/text)
  values?: string[];                   // ISO operands; length by operator
};
```

Rationale for `operator`+`values` over date-specific fields
(`dateOperator`/`dateValue`/`dateValueMax`): `number` and `text` validation
(planned next) need the identical "operator + 0/1/2 comparison operands" shape,
so a shared substructure avoids re-modeling and lets one panel section drive all
three comparison kinds. `dateMin`/`dateMax` are removed (dead — grep-confirmed no
readers outside the type + this doc).

**Normalization** (`normalizeDataValidationRule`) — a `date` rule normalizes its
`operator` (default `dateValid`), trims `values` to the operand count the
operator requires, and normalizes each operand to ISO via the value path below.
Unlike an option-less `list` rule (which is dropped), a `date` rule is **never
dropped for missing operands** — it falls back to `dateValid`. `onInvalid`
defaults to `warning` (list parity).

**Validation logic** (`data-validation.ts`) — a pure
`isValidDateValue(rule, value): boolean`:

- Empty/cleared value → `true` (GS parity; a rule never blocks deleting a cell,
  matching `isValidListValue`).
- Otherwise normalize the cell value with the existing `inferInput`
  (`input.ts`) — a date cell stores an ISO `yyyy-mm-dd` string with `nf='date'`,
  and `inferInput` already parses every accepted date format to that ISO form,
  so **no new date parser is introduced**. A value that is not a date → invalid.
- `dateValid` passes on any parseable date. Comparison operators normalize each
  operand the same way and compare ISO strings **lexicographically** (which
  equals chronological order for `yyyy-mm-dd`). `dateBetween` is inclusive on
  both ends; `dateNotBetween` is its negation.
- A `date` cell holding a **formula** is validated by its computed value at
  render (warning marker), not its literal text — matching the list precedent;
  the `reject` commit path lets `=`-prefixed input through.

**Rendering** (`gridcanvas.ts`) — no persistent in-cell glyph for `date` (GS
parity: the value renders through the existing `nf='date'` path; the calendar is
a double-click affordance, not an always-drawn control). A `warning`-mode date
rule whose value fails `isValidDateValue` draws the same red top-right triangle
the list warning path already draws, computed at render time, never persisted.

**Interaction** (`worksheet.ts`):

- **Commit-path validation** — generalize the currently list-only branch in
  `commitCellValue` to dispatch by `rule.kind`: a `reject` date rule discards an
  invalid typed date (keeps the prior value, fires `onValidationError`); a
  `warning` date rule stores the value and lets the render pass mark it. Formulas
  pass through (as for list).
- **Calendar popover** — double-clicking a date-ruled cell (writable stores
  only) opens a new DOM calendar overlay modeled on the existing `listPopover`
  (`worksheet.ts` — `document.createElement`, viewport-flip anchoring reused from
  the list popover). A month grid with prev/next navigation; days outside the
  rule's operator bounds (`dateBefore`/`dateAfter`/`dateBetween`/…) are rendered
  disabled; clicking a day writes the ISO value via `setData` (single undo unit)
  and closes the popover. `Esc` closes; keyboard day navigation is a nice-to-have
  (may defer to keep the first cut small). Uses native `Date` for month math
  (runtime `Date`/`new Date()` are available in the app; the workflow-script
  restriction does not apply here) — no `date-fns` dependency added to the sheets
  package. Read-only stores/permissions render the value but skip the double-click
  branch.

**Panel UI** (`data-validation-panel.tsx`) — add **Date** to the criteria
`<Select>` (alongside Checkbox / Dropdown). The date detail section shows an
operator `<Select>` (the eight operators above), one `<input type="date">` for
single-operand operators / two for `dateBetween`/`dateNotBetween` / none for
`dateValid`, and the existing On-invalid Reject / Warning radio. Writes go
through `setDataValidations` exactly as checkbox/list do; editing preserves the
rule `id`/ranges. An in-progress date rule (operator chosen, some operands still
blank) keeps its operator and any filled operand (blank slots stored as `''`),
degrading to a "valid date" check until complete rather than being dropped — so
editing one bound never loses the other and a Date↔Dropdown round-trip is safe.

**Structural edits / Store / seed** — unchanged. `date` rules ride the same
`shiftRuleRanges`/`moveRuleRanges` path and the same `dataValidations` container
already seeded in `createWorksheet`; no per-cell field is added, so the
`YorkieStore.normalizeCell` whitelist is untouched.

**Deliberate deferrals / follow-ups:**

- **Relative operands** (`today`, `tomorrow`, `past week/month/year`) — deferred;
  fixed ISO operands only in this phase (they keep validation render-time
  deterministic and unit tests stable).
- **Reject on paste/API** — same as list: `reject` is enforced only on typed
  commit; a pasted/programmatic invalid date is stored but always draws the
  warning marker.
- **Keyboard-only calendar navigation** — arrow-key day traversal in the popover
  may land as a small follow-up; click + `Esc` ship first.
- **Time-of-day** — calendar dates only, as in the original Non-Goals.

#### Review hardening (as shipped)

A high-effort branch review drove four correctness/UX fixes over the first cut:

- **Position-preserving operands.** `normalizeDataValidationRule` keeps a
  fixed-length slot per operand, storing `''` for a blank/unparseable one
  (`values` becomes `undefined` only when *every* slot is empty). This replaced
  an earlier "stop at the first gap" rule that permanently dropped the
  still-filled bound when a user cleared one input of a `between` rule (and an
  even earlier "skip and continue" that mispositioned operands). A comparison
  operator with any blank required slot degrades to "is a valid date" in
  `isValidDateValue` until every operand is filled — so an in-progress rule
  keeps its operator *and* its filled bound, rather than collapsing to
  `dateValid` and losing data.
- **Picker ⇄ reject consistency.** `dateWithinRuleBounds` now defers entirely to
  `isValidDateValue`, so the calendar disables exactly the days the rule rejects
  — including the interior window of a `not between` rule (previously left
  enabled, which let the picker commit a value that typed entry would reject).
- **Reversed range swap.** `isValidDateValue`/`describeDateRule` present and
  validate a `between`/`not between` range low→high, so a start > end rule
  matches Google Sheets instead of rejecting every date.
- **Condition-naming messages.** A new `describeDateRule` helper backs both the
  reject toast and the hover tooltip, so a valid-but-out-of-range date reads
  `"2019-05-01" must be after 2020-01-01.` instead of the misleading "is not a
  valid date." Locale-specific input formats (e.g. `1/15/2026`) that the shared
  `inferInput` parser does not recognize are still treated as non-dates — a
  pre-existing, app-wide date-parsing limitation, not specific to validation.

### Phase 5 (number / text): comparison validation kinds — as shipped

Adds the `number` and `text` kinds, reusing the Phase-4 `operator` + `values`
substructure (this is exactly the reuse the date phase modeled for). No
formula-engine change; the warning marker and reject commit path are shared.

- **Operators** (`types.ts`) — the shared `DataValidationOperator` union gains
  number ops (`numberValid` (0), `numberEquals` / `numberNotEquals` /
  `numberGreater` / `numberGreaterEq` / `numberLess` / `numberLessEq` (1),
  `numberBetween` / `numberNotBetween` (2)) and text ops (`textContains` /
  `textNotContains` / `textEquals` (1), `textIsEmail` / `textIsUrl` (0)).
- **Operand count** (`data-validation.ts`) — `dateValidationOperandCount` is
  generalized to `validationOperandCount` (all three kinds); the date name is
  kept as a delegating alias for existing callers.
- **Validation** — `isValidNumberValue` parses the value with `Number` (a
  non-number always fails, even under `numberValid`) and compares numerically
  (between inclusive, reversed range swapped). `isValidTextValue` does
  case-insensitive contains/not-contains, trimmed exact match, and light
  email/URL structural checks (`URL` parser + dotted host). Both degrade to
  "always valid" (number: "is a number") while a required operand is blank, and
  a rule is never dropped — mirroring date. `isValidValueForRule` dispatches to
  them; `normalizeDataValidationRule` normalizes operands per kind
  (`normalizeOperand`: ISO date / finite-number string / trimmed text) into
  fixed-length slots.
- **Messages** — `describeNumberRule` / `describeTextRule` back the reject toast
  and hover tooltip via a shared `validationRuleDetail` dispatcher in
  `worksheet.ts`.
- **Render** (`gridcanvas.ts`) — the date warning-marker branch is generalized
  to date/number/text via `isValidValueForRule` (no persistent glyph; red
  corner marker on an invalid value, computed at render time).
- **Panel** (`data-validation-panel.tsx`) — the date-only editor section is
  refactored into one shared **comparison section** driven by a
  `COMPARISON_KINDS` config (operators + input type + default op), so date,
  number, and text share the operator select + 0/1/2 operand inputs + on-invalid
  radio. Criteria gains **Number** and **Text**; switching between comparison
  kinds resets the operator to that kind's default.

Deferred (unchanged Non-Goals): custom-formula criteria, relative operands,
range-source lists. The `describeDateRule` completeness check has a latent
vacuous-true edge for a fully-empty operand array (a pre-existing date-only
quirk); the new `describeNumberRule` checks operands by index to avoid it.

### Testing

> Scope note: this section is the testing strategy for the **full** feature
> (all three kinds). Phases 1–2 shipped checkbox + list; Phase 4 (above) adds
> date. See each phase's "as shipped"/"design" subsection for the coverage that
> actually landed.

- **model unit tests** (Vitest, `packages/sheets`): `resolveDataValidationAt` range
  matching (overlap/priority); checkbox value transitions (`TRUE`↔`FALSE`,
  custom); list/date validation (`reject`/`warning`; date `operator`/`values`
  boundaries — before/on-or-before, after/on-or-after, between/not-between
  inclusive edges, reversed-range swap, position-preserving normalization);
  Store 3-impl round-trip for `get/setDataValidations`; Yorkie schema seed.
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
