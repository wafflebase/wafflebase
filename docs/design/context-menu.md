# Context Menu — Unified Design

## Status

Implemented — 2026-03-03

## Problem

Three separate context menu implementations existed with inconsistent
behavior across platforms:

1. **Desktop (sheet package)**: Vanilla JS context menu — row/column
   headers only, no cell menu, no icons.
2. **Mobile (frontend)**: React mobile context menu — cells and
   rows/columns, but missing Hide/Show, no multi-selection labels.
3. **Tab bar (frontend)**: Radix `DropdownMenu` — Rename/Delete only,
   different component base.

Users saw different capabilities depending on platform and interaction
method.

## Solution

Replace all three implementations with a single React component backed by
`@radix-ui/react-context-menu`, following the existing shadcn/ui pattern.
Mobile long-press triggers the same Radix ContextMenu via a synthetic
`contextmenu` event, unifying the trigger path.

## Architecture

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
from the long-press handler in `packages/frontend/src/hooks/use-mobile-sheet-gestures.ts`.

### Component Structure

```
SheetContextMenu (new)
├── Wraps canvas container as ContextMenuTrigger
├── onContextMenu: headerHitTest → determine menuType
├── CellMenuItems: Cut, Copy, Paste, Delete
├── RowMenuItems: Insert above/below, Delete, Hide, Show
└── ColumnMenuItems: Insert left/right, Delete, Hide, Show

TabContextMenu (modified tab-bar.tsx)
├── Wraps tab element as ContextMenuTrigger
├── Rename
└── Delete (if > 1 tab)

components/ui/context-menu.tsx (new)
└── shadcn/ui wrapper around @radix-ui/react-context-menu
```

### Menu Items

#### Cell Menu
- Cut (disabled if readOnly)
- Copy
- Paste (disabled if readOnly)
- Delete (disabled if readOnly)

#### Row Menu
- Insert N row(s) above
- Insert N row(s) below
- Delete N row(s)
- ─── separator ───
- Hide N row(s)
- Show rows X–Y (only if adjacent hidden rows exist)

All items disabled if readOnly. Labels reflect multi-selection count
(e.g., "Insert 3 rows above").

#### Column Menu
Same pattern as Row Menu with left/right instead of above/below.

#### Tab Menu
- Rename
- ─── separator ───
- Delete (destructive variant, only if multiple tabs)

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
// Hide/show operations (move from worksheet direct calls to facade)
hideRows(index: number, count: number): Promise<void>
hideColumns(index: number, count: number): Promise<void>
showRows(from: number, to: number): Promise<void>
showColumns(from: number, to: number): Promise<void>

// Adjacent hidden detection (for conditional Show menu item)
getAdjacentHiddenRows(from: number, to: number):
  { from: number; to: number } | null
getAdjacentHiddenColumns(from: number, to: number):
  { from: number; to: number } | null
```

## Key Files

- `packages/frontend/src/components/ui/context-menu.tsx` — shadcn/ui wrapper
- `packages/frontend/src/components/sheet-context-menu.tsx` — unified sheet menu
- `packages/frontend/src/components/tab-bar.tsx` — tab context menu
- `packages/frontend/src/hooks/use-mobile-sheet-gestures.ts` — mobile long-press
- `packages/sheets/src/view/worksheet.ts` — canvas event handling
- `packages/sheets/src/view/spreadsheet.ts` — facade API

## Risks

- **Synthetic contextmenu on mobile**: If Radix does not respond to
  synthetic events, fall back to controlled `open` state with manual
  positioning. Verify during implementation.
- **Canvas event interception**: The canvas container must allow the
  contextmenu event to reach the Radix trigger. Ensure no
  `preventDefault()` intercepts it before Radix.
- **Tab bar long-press on mobile**: Radix ContextMenu on tab elements may
  need the same synthetic event approach if native right-click is not
  available on touch devices.
