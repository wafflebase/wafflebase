---
title: pivot-table
target-version: 0.1.0
---

# Pivot Table

## Summary

Add pivot table support to Wafflebase, matching Google Sheets' pivot table
feature set. Users select a data range, configure row/column/value/filter
fields through a side panel editor, and the system generates a computed
result on a dedicated sheet. Results are materialized as real cells, reusing
the existing Canvas renderer and collaboration infrastructure.

## Goals / Non-Goals

### Goals

- Create pivot tables from any rectangular data range (first row = headers)
- Support multi-level row and column grouping with sorted group values
- Provide basic aggregation functions: SUM, COUNT, COUNTA, AVERAGE, MIN, MAX
- Render results on a new dedicated sheet with read-only cell protection
- Provide a side-panel editor with drag-and-drop field configuration
- Support manual refresh to recalculate from source data
- Persist pivot definitions via Store/Yorkie for real-time collaboration
- Display row and column grand totals (toggleable)

### Non-Goals

- Automatic real-time refresh on source data change (manual only)
- Calculated fields or custom formulas in pivot (future)
- Pivot charts (future, builds on chart system)
- GETPIVOTDATA formula function (future, depends on pivot infrastructure)
- Drill-down to source data on double-click (future)
- Subtotals per group level (future, grand totals only in Phase 1)
- Grouping by date parts (year/quarter/month) (future)
- Slicer UI connected to pivot filters (future)

## Proposal Details

### 1. Architecture Overview

The pivot table system spans three layers:

```text
┌──────────────────────────────────────────────────┐
│                  Frontend (React)                │
│  PivotEditorPanel  ─── usePivotTable hook        │
│  Field drag-and-drop, refresh button             │
├──────────────────────────────────────────────────┤
│              Sheet Engine (packages/sheets)        │
│  PivotCalculator  ─── PivotMaterializer          │
│  Data parsing, grouping, aggregation, cell output │
├──────────────────────────────────────────────────┤
│                Store / Yorkie CRDT               │
│  PivotTableDefinition persistence + cell sync    │
└──────────────────────────────────────────────────┘
```

**Key decision: Materialized cells.** Pivot results are written as actual
`Cell` objects to the destination sheet. This reuses the Canvas renderer,
cell formatting, copy/paste, and Yorkie collaboration without modification.
Google Sheets uses the same approach.

### 2. Data Model

#### Tab Type Integration

The existing `TabType` (`"sheet" | "datasource"`) stays unchanged. A new
`SheetKind` subtype distinguishes pivot sheets from normal sheets at the
tab metadata level:

```typescript
type TabType = "sheet" | "datasource";  // unchanged

type SheetKind = "normal" | "pivot";

type TabMeta = {
  id: string;
  name: string;
  type: TabType;
  kind?: SheetKind;        // sheet subtype (default: "normal")
  datasourceId?: string;   // datasource tabs only
  query?: string;          // datasource tabs only
};
```

**Why a subtype instead of a new TabType?** Pivot sheets use the same
infrastructure as normal sheets (YorkieStore, Canvas renderer, Worksheet
storage). A separate `TabType` would duplicate rendering and store logic.
The `kind` field provides fast identification at the tab bar level (icon,
context menu) without reading the Worksheet interior.

**Why not `Worksheet.pivotTable` alone?** TabMeta is always loaded (tab
bar rendering), but Worksheet data is only loaded for the active tab.
Having `kind` in TabMeta allows showing pivot icons on inactive tabs.

#### PivotTableDefinition

```typescript
type AggregateFunction =
  | 'SUM'
  | 'COUNT'
  | 'COUNTA'
  | 'AVERAGE'
  | 'MIN'
  | 'MAX';

type PivotFieldSort = 'asc' | 'desc';

type PivotField = {
  sourceColumn: number;   // 0-based column index in source range
  label: string;          // display name (default: header cell value)
  sort?: PivotFieldSort;  // group value sort order (default: 'asc')
};

type PivotValueField = PivotField & {
  aggregation: AggregateFunction;
};

type PivotFilterField = PivotField & {
  hiddenValues: string[];  // values to exclude
};

type PivotTableDefinition = {
  id: string;                        // UUID
  sourceTabId: string;               // tab containing source data
  sourceRange: string;               // A1 notation, first row = headers
  rowFields: PivotField[];           // row grouping (order = hierarchy)
  columnFields: PivotField[];        // column grouping
  valueFields: PivotValueField[];    // aggregated values
  filterFields: PivotFilterField[];  // global filters
  showTotals: {
    rows: boolean;                   // show grand total row
    columns: boolean;                // show grand total column
  };
};
```

#### Storage

Pivot definition lives in two places with distinct roles:

| Location | Role | When accessed |
| -------- | ---- | ------------- |
| `TabMeta.kind` | Fast identification (icon, menu) | Always (tab bar) |
| `Worksheet.pivotTable` | Full configuration (fields, source) | Active tab only |

```typescript
type Worksheet = {
  // ... existing fields
  pivotTable?: PivotTableDefinition;  // present when kind === "pivot"
};
```

Both are set together when creating a pivot table and cleared together
when deleting one.

### 3. Pivot Calculation Engine

Location: `packages/sheets/src/model/pivot/`

#### Pipeline

```text
Source Grid
  → parseSourceData()     // extract headers + records
  → applyFilters()        // remove rows matching hiddenValues
  → buildGroups()         // create row/column group trees
  → aggregate()           // compute values per (row, col) intersection
  → PivotResult           // structured output
  → materialize()         // convert to Cell objects at target positions
```

#### Step 1: Parse Source Data

Read cells from `sourceRange`. First row becomes column headers. Remaining
rows become records (arrays of string values). Empty rows at the end are
trimmed.

```typescript
type PivotRecord = string[];  // values indexed by source column

function parseSourceData(
  grid: Grid,
  sourceRange: Range,
): { headers: string[]; records: PivotRecord[] };
```

#### Step 2: Apply Filters

Remove records where any `filterField`'s column value appears in its
`hiddenValues` list.

#### Step 3: Build Groups

For each field list (row fields, column fields), extract unique values
from the corresponding source column and sort them. Multi-level grouping
creates a tree structure:

```typescript
type GroupNode = {
  value: string;
  children: GroupNode[];  // next level of grouping
  records: number[];      // indices of matching records (leaf level)
};
```

#### Step 4: Aggregate

For each intersection of (row group leaf, column group leaf), collect
matching records and apply the aggregation function to each value field:

```typescript
function aggregateValues(
  records: PivotRecord[],
  indices: number[],
  valueField: PivotValueField,
): string;
```

Type coercion: parse cell string values to numbers. Non-numeric values
are skipped for SUM/AVERAGE/MIN/MAX. COUNT counts numeric values only,
COUNTA counts non-empty values.

Grand totals aggregate across all records in a row or column group.

#### Step 5: PivotResult

```typescript
type PivotCellType =
  | 'rowHeader'
  | 'colHeader'
  | 'value'
  | 'total'
  | 'empty';

type PivotCell = {
  value: string;
  type: PivotCellType;
};

type PivotResult = {
  cells: PivotCell[][];   // 2D matrix, ready for materialization
  rowCount: number;
  colCount: number;
};
```

#### Step 6: Materialize

Convert `PivotResult` into `Cell` objects and write to the pivot sheet
starting at A1. Apply default styling:

- Row/column headers: bold
- Grand total row/column: bold
- Value cells: plain (no styling)

All writes are wrapped in a single batch transaction for atomic undo/redo.

### 4. Store Integration

#### Store Interface Extension

```typescript
interface Store {
  // ... existing methods
  setPivotDefinition(def: PivotTableDefinition | undefined): Promise<void>;
  getPivotDefinition(): Promise<PivotTableDefinition | undefined>;
}
```

All three Store implementations (MemStore, YorkieStore, ReadOnlyStore)
add these methods.

#### YorkieStore Persistence

The pivot definition is stored as a nested object in the Yorkie document
at `root.sheets[tabId].pivotTable`. Standard CRDT sync propagates
definition changes to all connected clients.

#### Collaboration Behavior

- **Definition changes** (field add/remove/reorder): synced via CRDT.
  Other clients see the updated editor panel state.
- **Materialized cells**: written as normal cells, synced automatically.
  When one user refreshes, all clients see the updated results.
- **Concurrent refresh**: safe because the result is deterministic given
  the same source data and definition. Last writer wins without conflict.

### 5. Pivot Sheet Protection

Pivot sheets block direct cell editing to prevent inconsistency between
the pivot definition and displayed results.

Pivot detection uses `TabMeta.kind === "pivot"` at the tab level and
a cached `pivotDefinition` in the `Sheet` class. `Sheet.setData()` checks
the cached definition and early-returns to block edits:

```typescript
if (this.pivotDefinition) return;
```

The `pivotDefinition` cache is populated via `loadPivotDefinition()` during
sheet initialization. Internal materialization writes cells directly via
`doc.update()`, bypassing the `Sheet` mutation methods entirely.

### 6. Frontend: Pivot Creation Flow

```text
1. User selects data range on a normal sheet
2. Menu → Insert → Pivot Table
3. System creates a new tab:
   - TabMeta: { type: "sheet", kind: "pivot", name: "Pivot Table N" }
   - Worksheet: { ..., pivotTable: { sourceTabId, sourceRange, ... } }
4. New tab opens with empty pivot sheet
5. Pivot editor side panel appears automatically (kind === "pivot")
6. Source range pre-filled from original selection
7. User drags fields into Rows / Columns / Values / Filters
8. User clicks "Refresh" → results materialize
```

### 7. Frontend: Pivot Editor Panel

Side panel on the right side of the spreadsheet view, visible whenever
a pivot sheet tab is active.

```text
┌─────────────────────────────┐
│  Pivot Table Editor     [×] │
├─────────────────────────────┤
│  Source: Sheet1!A1:F100     │
│  [Change]                   │
├─────────────────────────────┤
│  ▼ Filters                  │
│    [+ Add]                  │
├─────────────────────────────┤
│  ▼ Rows                    │
│    Department  [A→Z ▾] [×]  │
│    [+ Add]                  │
├─────────────────────────────┤
│  ▼ Columns                 │
│    Quarter    [A→Z ▾] [×]   │
│    [+ Add]                  │
├─────────────────────────────┤
│  ▼ Values                  │
│    Revenue    [SUM ▾] [×]   │
│    [+ Add]                  │
├─────────────────────────────┤
│  ☑ Show row totals          │
│  ☑ Show column totals       │
├─────────────────────────────┤
│  [Refresh]                  │
└─────────────────────────────┘
```

#### Interactions

- **Add field**: dropdown showing available source columns (not yet used)
- **Remove field**: click [×] on any placed field
- **Sort toggle**: cycle through asc/desc for row and column fields
- **Aggregation select**: dropdown on value fields (SUM, COUNT, etc.)
- **Filter config**: click a filter field to show value checklist
  (reuse existing FilterPanel component pattern)
- **Refresh button**: triggers recalculation and materialization

#### Component Structure

```text
packages/frontend/src/app/spreadsheet/pivot/
  pivot-editor-panel.tsx       // side panel container
  pivot-field-list.tsx         // available fields from source headers
  pivot-field-item.tsx         // individual field chip (draggable)
  pivot-section.tsx            // Rows / Columns / Values / Filters section
  pivot-actions.tsx            // Refresh, delete pivot table
  use-pivot-table.ts           // state management hook
```

### 8. Pivot Sheet Tab Indicator

Pivot tabs are visually distinguished from normal tabs. The tab bar reads
`TabMeta.kind` (always available, no Worksheet load needed):

- Small pivot icon next to the tab name (when `kind === "pivot"`)
- Tab context menu includes "Delete pivot table" option
- Deleting a pivot tab removes both the tab and its definition

### 9. Cross-Sheet Data Access

The pivot calculator needs to read source data from a different tab.
This uses the existing `GridResolver` mechanism that already supports
cross-sheet formula references:

```typescript
type GridResolver = (
  sheetName: string,
  refs: Set<Sref>,
) => Grid | undefined;
```

The pivot refresh operation resolves the source tab's grid, extracts
the source range, and passes it to the calculator.

### 10. Testing Strategy

- **Unit tests** (packages/sheets):
  - `parseSourceData()` — header extraction, empty row trimming
  - `buildGroups()` — single and multi-level grouping, sort order
  - `aggregate()` — each aggregation function, type coercion, edge cases
  - `materialize()` — cell positions, styling, header labels
  - End-to-end: definition → PivotResult → cell output verification
- **Frontend tests**:
  - Pivot editor panel rendering and field interactions
  - Pivot creation flow (range selection → new tab → editor open)
  - Cell edit blocking on pivot sheets
- **Visual regression tests**:
  - Pivot table rendering with sample data (various field combinations)

## Risks and Mitigation

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| Large source data (100k+ rows) causes slow refresh | Medium | Single-pass O(n) algorithm; add progress indicator if > 1s |
| User accidentally deletes pivot tab losing config | Low | Undo support via batch transaction; confirmation dialog on delete |
| Concurrent field edits by multiple users cause conflicts | Low | CRDT handles field-level merges; refresh produces deterministic output |
| Source range becomes invalid after row/column insert/delete | Medium | Validate source range on refresh; show error if range is invalid |
| Cell protection bypass through paste or API | Low | Guard all mutation paths (setData, paste, delete) with isPivotSheet check |

## Phase Roadmap

### Phase 1 (this document) — IMPLEMENTED

- [x] Pivot table creation from data range selection (context menu)
- [x] Row/column/value/filter field configuration
- [x] 6 aggregation functions: SUM, COUNT, COUNTA, AVERAGE, MIN, MAX
- [x] Materialized cell output on dedicated sheet
- [x] Side panel editor with field management
- [x] Manual refresh, read-only cell protection
- [x] Grand totals (row and column)
- [x] Yorkie persistence and collaboration
- [x] TabMeta.kind subtype for pivot tab identification
- [x] Distinct pivot icon in tab bar

### Phase 2

- GETPIVOTDATA formula function
- Subtotals per group level (not just grand totals)
- Date grouping (year, quarter, month, week, day)
- Calculated fields (custom formulas)
- Pivot table styles / themes
- "Data changed" notification banner with refresh prompt

### Phase 3+

- Pivot charts (linked to pivot table data)
- Drill-down: double-click a value cell to see source rows
- Slicer UI connected to pivot filters
- Multiple value display modes (% of total, % of row, running total)
- Auto-refresh option
- Cross-document pivot sources
