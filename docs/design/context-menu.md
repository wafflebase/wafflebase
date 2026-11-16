---
title: context-menu
target-version: 0.2.0
---

# Unified Context Menu

## Summary

A single React component, backed by `@radix-ui/react-context-menu`, replaces
three legacy context menu implementations (desktop sheet, mobile sheet, tab
bar). Both desktop right-click and mobile long-press route through the same
Radix trigger so cell/row/column/tab menus expose identical capabilities on
every platform. Shipped 2026-03-03.

## Goals / Non-Goals

### Goals

- One implementation, one component, one menu item set across desktop and
  mobile for the sheet grid and tab bar.
- Preserve Hide/Show, multi-selection labels, and destructive-variant styling
  on both platforms.
- Reuse the existing shadcn/ui pattern so menu styling stays in sync with the
  rest of the app.

### Non-Goals

- Docs and slides context menus — out of scope for this pass.
- Custom keyboard shortcuts surfaced inside the menu (covered separately).

## Proposal Details

### Trigger Flow

```
Desktop right-click   ──→  contextmenu event  ──→  Radix ContextMenu
Mobile long-press     ──→  synthetic contextmenu ──→  (same path)
                                  ↓
                       headerHitTest(x, y)
                                  ↓
                       menuType: cell | row | column
                                  ↓
                       render matching menu items
```

Both platforms go through the same Radix ContextMenu. Mobile dispatches a
synthetic `MouseEvent('contextmenu', { clientX, clientY, bubbles: true })`
from the long-press handler in
`packages/frontend/src/hooks/use-mobile-sheet-gestures.ts`.

### Component Structure

```
SheetContextMenu (new)
├── Wraps canvas container as ContextMenuTrigger
├── onContextMenu: headerHitTest → determine menuType
├── CellMenuItems: Cut, Copy, Paste, Delete values, Insert row above/below,
│                  Insert column left/right, Delete row/column + optional
│                  Insert comment, Data validation, Insert pivot table,
│                  Delete image
├── RowMenuItems: Insert above/below, Delete, Hide, Show, Freeze, Unfreeze
└── ColumnMenuItems: Insert left/right, Delete, Hide, Show, Freeze, Unfreeze

TabContextMenu (modified tab-bar.tsx)
├── Wraps tab element as ContextMenuTrigger
├── Rename, Duplicate (sheet tabs)
├── Move left / Move right
└── Delete (if > 1 tab)

components/ui/context-menu.tsx (new)
└── shadcn/ui wrapper around @radix-ui/react-context-menu
```

### Menu Items

#### Cell Menu

- Cut (disabled if readOnly)
- Copy
- Paste (disabled if readOnly)
- Delete values (disabled if readOnly) — clears the selection's data
- ─── separator ───
- Insert N row(s) above / below
- Insert N column(s) left / right
- ─── separator ───
- Delete N row(s)
- Delete N column(s)
- Insert comment (with keyboard hint; only if `onInsertComment` is wired)
- Data validation (only if `onOpenDataValidation` is wired)
- Insert pivot table (only if `onInsertPivotTable` is wired)
- Delete image (only when an image is selected, via `selectedImageId` + `onDeleteImage`)

Counts come from the selection range (or the active cell), normalized so a
range drawn bottom-up still counts top-to-bottom, Google-style: "Insert 3 rows
above" for a three-row selection. They call the same `Spreadsheet`
`insertRows` / `insertColumns` / `deleteRows` / `deleteColumns` the header
menu reaches, so there is one structural-edit path. Sheets has no menu bar, so
the cell menu is the only place these are reachable without first selecting a
whole header. Insert and delete (cell and header menus) are disabled when
`readOnly` or `structureLocked` — the latter is set on a pivot output tab,
whose cells the model refuses to shift (`Sheet.insertRows` & co. no-op there).

The optional items are gated by their corresponding `SheetContextMenu` props
(`onInsertComment`, `onOpenDataValidation`, `onInsertPivotTable`,
`onDeleteImage`/`selectedImageId`) and each render behind a separator.

#### Row Menu

- Insert N row(s) above
- Insert N row(s) below
- Delete N row(s)
- ─── separator ───
- Hide N row(s)
- Show rows X–Y (only if adjacent hidden rows exist)
- ─── separator ───
- Freeze up to row N (N = last row of the selection; hidden when N is already
  the frozen boundary or exceeds `MaxSnappedFreeze`)
- Unfreeze rows (only if rows are frozen)

All items disabled if readOnly; insert/delete also when `structureLocked`.
Freeze is view state, not structure, so a pivot output tab can still freeze.
Freezing calls `Spreadsheet.setFreezePane` with the other axis's boundary
unchanged — the same single store write the corner drag handle makes, so it is
one undo step. Before this the drag handle was the only way to freeze. Labels reflect multi-selection count
(e.g., "Insert 3 rows above").

#### Column Menu

Same pattern as Row Menu with left/right instead of above/below, and
"Freeze up to column X" / "Unfreeze columns".

#### Tab Menu

- Rename
- Duplicate (only for `sheet` tabs, and only when the host wires
  `onDuplicateTab`) — the copy lands right after the source as
  `<name> (copy)` and becomes active
- ─── separator ───
- Move left / Move right (only when the host wires `onMoveTab` and there are
  multiple tabs; disabled at the ends) — the keyboard path for reordering,
  since drag-to-reorder is pointer-only
- ─── separator ───
- Delete (destructive variant, only if multiple tabs)

Duplicate runs `duplicateTab` from `@wafflebase/sheets`, the same function the
v1 `POST .../tabs/:tabId/duplicate` route uses, so the editor and the API make
the same copy (comments dropped, self-sourced charts repointed, a pivot output
becomes a plain snapshot). The host detaches the source worksheet from the
Yorkie proxy (`toJS()`) before writing it under the new key. A `datasource` /
`lakehouse` tab has no worksheet to copy, so the item is hidden there.

#### Tab Bar

The tab strip is a `role="tablist"` (`aria-label="Sheets"`) of `role="tab"`
buttons with `aria-selected` and a roving `tabIndex`; Left/Right/Home/End move
focus and select (automatic activation). The add controls sit outside the
tablist: **+** (`Add sheet`) adds a plain sheet in one click, as in Google
Sheets, and the adjacent chevron (`More tab types`) opens **Connect data source
(SQL)…** and **Connect lakehouse table…** — the tab kinds Google has no
counterpart for, named for what they do.

### Position Detection

`SheetContextMenu` calls `spreadsheet.headerHitTest(clientX, clientY)` on
the `contextmenu` event to classify the click target:

- Returns `{ axis: 'row', index }` → row menu
- Returns `{ axis: 'column', index }` → column menu
- Returns `null` → cell menu

If the right-click falls within an existing multi-selection, that range is
used. Otherwise the single row/column at the click point is selected.

### Spreadsheet Facade API Additions

```typescript
// Hide/show operations (move from worksheet direct calls to facade).
// Each takes the explicit list of axis indices to act on.
hideRows(indices: number[]): Promise<void>
hideColumns(indices: number[]): Promise<void>
showRows(indices: number[]): Promise<void>
showColumns(indices: number[]): Promise<void>

// Adjacent hidden detection (for conditional Show menu item).
// Returns the array of hidden indices adjacent to the [from, to] range
// (empty when none); the menu computes min/max over it for the label.
findAdjacentHiddenRows(from: number, to: number): number[]
findAdjacentHiddenColumns(from: number, to: number): number[]

// Current freeze boundary, so the header menu offers Unfreeze only when
// that axis is frozen.
getFreezePane(): { frozenRows: number; frozenCols: number }
```

### Key Files

- `packages/frontend/src/components/ui/context-menu.tsx` — shadcn/ui wrapper
- `packages/frontend/src/components/sheet-context-menu.tsx` — unified sheet menu
- `packages/frontend/src/components/tab-bar.tsx` — tab context menu
- `packages/frontend/src/hooks/use-mobile-sheet-gestures.ts` — mobile long-press
- `packages/sheets/src/view/worksheet.ts` — canvas event handling
- `packages/sheets/src/view/spreadsheet.ts` — facade API

## Risks and Mitigation

- **Synthetic contextmenu on mobile**: If Radix does not respond to
  synthetic events, fall back to controlled `open` state with manual
  positioning. Verify during implementation.
- **Canvas event interception**: The canvas container must allow the
  contextmenu event to reach the Radix trigger. Ensure no
  `preventDefault()` intercepts it before Radix.
- **Tab bar long-press on mobile**: Radix ContextMenu on tab elements may
  need the same synthetic event approach if native right-click is not
  available on touch devices.
