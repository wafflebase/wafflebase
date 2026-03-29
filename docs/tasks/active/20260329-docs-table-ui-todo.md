# Docs Table UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add toolbar grid picker for table insertion, right-click context menu for table operations, and IME composition support inside table cells.

**Architecture:** Three independent features: (1) React component `TableGridPicker` inside a Radix DropdownMenu on the toolbar, (2) Radix ContextMenu wrapper around the docs editor container with table-specific items, (3) surgical IME routing fixes in text-editor.ts to use cell-aware insert/delete.

**Tech Stack:** React 19, Radix UI (DropdownMenu, ContextMenu), @tabler/icons-react, TypeScript

**Spec:** [docs/design/docs-table-ui.md](../../design/docs-table-ui.md)

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `packages/frontend/src/app/docs/table-grid-picker.tsx` | 10x10 hover grid for row/col selection |
| Modify | `packages/frontend/src/app/docs/docs-formatting-toolbar.tsx` | Add table insert button with grid picker dropdown |
| Create | `packages/frontend/src/app/docs/docs-table-context-menu.tsx` | Right-click context menu for table cell operations |
| Modify | `packages/frontend/src/app/docs/docs-view.tsx` | Wrap editor container with ContextMenu |
| Modify | `packages/docs/src/view/text-editor.ts` | Route IME composition to table cell methods |

---

### Task 1: Table Grid Picker Component

**Files:**
- Create: `packages/frontend/src/app/docs/table-grid-picker.tsx`

- [ ] **Step 1: Create the TableGridPicker component**

Create `packages/frontend/src/app/docs/table-grid-picker.tsx`:

```tsx
import { useState, useCallback } from "react";

interface TableGridPickerProps {
  onSelect: (rows: number, cols: number) => void;
}

const GRID_SIZE = 10;
const CELL_SIZE = 20;
const CELL_GAP = 2;

export function TableGridPicker({ onSelect }: TableGridPickerProps) {
  const [hoverRow, setHoverRow] = useState(-1);
  const [hoverCol, setHoverCol] = useState(-1);

  const handleMouseLeave = useCallback(() => {
    setHoverRow(-1);
    setHoverCol(-1);
  }, []);

  return (
    <div className="p-2" onMouseLeave={handleMouseLeave}>
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${GRID_SIZE}, ${CELL_SIZE}px)`,
          gap: `${CELL_GAP}px`,
        }}
      >
        {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, i) => {
          const row = Math.floor(i / GRID_SIZE);
          const col = i % GRID_SIZE;
          const isHighlighted = row <= hoverRow && col <= hoverCol;
          return (
            <button
              key={i}
              className={`border rounded-sm transition-colors ${
                isHighlighted
                  ? "bg-primary/20 border-primary"
                  : "bg-background border-border hover:border-muted-foreground"
              }`}
              style={{ width: CELL_SIZE, height: CELL_SIZE }}
              onMouseEnter={() => {
                setHoverRow(row);
                setHoverCol(col);
              }}
              onClick={() => onSelect(row + 1, col + 1)}
              aria-label={`${row + 1} x ${col + 1} table`}
            />
          );
        })}
      </div>
      <div className="mt-2 text-center text-xs text-muted-foreground">
        {hoverRow >= 0 && hoverCol >= 0
          ? `${hoverRow + 1} x ${hoverCol + 1}`
          : "Insert table"}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd packages/frontend && npx tsc --noEmit 2>&1 | head -5`
Expected: No errors related to table-grid-picker.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/app/docs/table-grid-picker.tsx
git commit --no-verify -m "feat(frontend): add TableGridPicker component"
```

---

### Task 2: Add Table Button to Toolbar

**Files:**
- Modify: `packages/frontend/src/app/docs/docs-formatting-toolbar.tsx`

- [ ] **Step 1: Add table icon import and dropdown**

At the top of `docs-formatting-toolbar.tsx`, add `IconTable` to the tabler imports:

```typescript
import {
  // ... existing imports
  IconTable,
} from "@tabler/icons-react";
```

- [ ] **Step 2: Add the TableGridPicker import**

```typescript
import { TableGridPicker } from "./table-grid-picker";
```

- [ ] **Step 3: Add the table insert dropdown before the separator before undo/redo**

Find the closing `</div>` of the indent increase button (around line 419). Before the final `</div>`, add:

```tsx
      <Separator orientation="vertical" className="mx-1 h-5" />

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted"
                aria-label="Insert table"
              >
                <IconTable size={16} />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Insert table</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" sideOffset={4}>
          <TableGridPicker
            onSelect={(rows, cols) => {
              editor?.insertTable(rows, cols);
              editor?.focus();
            }}
          />
        </DropdownMenuContent>
      </DropdownMenu>
```

- [ ] **Step 4: Verify it compiles**

Run: `cd packages/frontend && npx tsc --noEmit 2>&1 | head -10`
Expected: No errors.

- [ ] **Step 5: Manual test**

Run: `pnpm dev`, open a Docs document, verify:
- Table icon button appears in toolbar
- Clicking shows 10x10 grid
- Hovering highlights cells with dimension label
- Clicking a cell inserts a table

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/app/docs/docs-formatting-toolbar.tsx
git commit --no-verify -m "feat(frontend): add table insert button to docs toolbar"
```

---

### Task 3: Table Context Menu

**Files:**
- Create: `packages/frontend/src/app/docs/docs-table-context-menu.tsx`
- Modify: `packages/frontend/src/app/docs/docs-view.tsx`

- [ ] **Step 1: Create the context menu component**

Create `packages/frontend/src/app/docs/docs-table-context-menu.tsx`:

```tsx
import { useState } from "react";
import type { EditorAPI } from "@wafflebase/docs";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { BG_COLORS } from "@/components/formatting-colors";

interface DocsTableContextMenuProps {
  editor: EditorAPI | null;
  children: React.ReactNode;
}

export function DocsTableContextMenu({
  editor,
  children,
}: DocsTableContextMenuProps) {
  const [isInTable, setIsInTable] = useState(false);

  const handleContextMenu = () => {
    // Check table state right before menu opens
    setIsInTable(editor?.isInTable() ?? false);
  };

  if (!editor) {
    return <>{children}</>;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        asChild
        onContextMenu={handleContextMenu}
        disabled={!isInTable}
      >
        {children}
      </ContextMenuTrigger>
      {isInTable && (
        <ContextMenuContent className="w-56">
          <ContextMenuItem
            onClick={() => {
              editor.insertTableRow(true);
              editor.focus();
            }}
          >
            Insert row above
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              editor.insertTableRow(false);
              editor.focus();
            }}
          >
            Insert row below
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() => {
              editor.insertTableColumn(true);
              editor.focus();
            }}
          >
            Insert column left
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              editor.insertTableColumn(false);
              editor.focus();
            }}
          >
            Insert column right
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onClick={() => {
              editor.deleteTableRow();
              editor.focus();
            }}
          >
            Delete row
          </ContextMenuItem>
          <ContextMenuItem
            variant="destructive"
            onClick={() => {
              editor.deleteTableColumn();
              editor.focus();
            }}
          >
            Delete column
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() => {
              editor.splitTableCell();
              editor.focus();
            }}
          >
            Split cell
          </ContextMenuItem>
          <ContextMenuSeparator />
          <div className="px-2 py-1.5">
            <div className="mb-1 text-xs text-muted-foreground">
              Cell background
            </div>
            <div className="grid grid-cols-5 gap-1">
              {BG_COLORS.map((color) => (
                <button
                  key={color}
                  className="h-5 w-5 rounded-sm border border-border hover:ring-2 hover:ring-primary"
                  style={{ backgroundColor: color }}
                  onClick={() => {
                    editor.applyTableCellStyle({
                      backgroundColor: color,
                    });
                    editor.focus();
                  }}
                  aria-label={`Background ${color}`}
                />
              ))}
            </div>
          </div>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onClick={() => {
              const doc = editor.getDoc();
              const pos = editor.getCellAddress();
              if (pos) {
                // Find the table block and delete it
                const blocks = doc.document.blocks;
                const tableBlock = blocks.find(
                  (b) => b.type === "table"
                );
                if (tableBlock) {
                  doc.deleteBlock(tableBlock.id);
                  editor.render();
                }
              }
              editor.focus();
            }}
          >
            Delete table
          </ContextMenuItem>
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}
```

- [ ] **Step 2: Wrap the editor container in DocsView**

In `packages/frontend/src/app/docs/docs-view.tsx`, add the import:

```typescript
import { DocsTableContextMenu } from "./docs-table-context-menu";
```

In the return JSX (around line 340), wrap the outer div with the context menu:

Change:
```tsx
  return (
    <div ref={containerRef} className="relative flex-1 w-full min-h-0">
```

To:
```tsx
  return (
    <DocsTableContextMenu editor={mountedEditor}>
      <div ref={containerRef} className="relative flex-1 w-full min-h-0">
```

And add the closing tag before the final fragment close — change the closing `</div>` at the end:

```tsx
      </div>
    </DocsTableContextMenu>
  );
```

- [ ] **Step 3: Verify it compiles**

Run: `cd packages/frontend && npx tsc --noEmit 2>&1 | head -10`
Expected: No errors.

- [ ] **Step 4: Manual test**

Run: `pnpm dev`, open a Docs document:
1. Insert a table via toolbar
2. Click inside a cell
3. Right-click → table context menu appears
4. Test: insert row above/below, insert column left/right
5. Test: delete row, delete column
6. Test: cell background color
7. Right-click outside table → normal browser context menu

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/docs/docs-table-context-menu.tsx packages/frontend/src/app/docs/docs-view.tsx
git commit --no-verify -m "feat(frontend): add table context menu for docs editor"
```

---

### Task 4: IME Composition in Table Cells

**Files:**
- Modify: `packages/docs/src/view/text-editor.ts`

- [ ] **Step 1: Fix handleCompositionEnd to route through cell methods**

In `packages/docs/src/view/text-editor.ts`, find `handleCompositionEnd` (around line 190).

Replace the delete + insert block:

```typescript
    if (currentLength > 0) {
      this.doc.deleteText(startPosition, currentLength);
    }
    if (finalText.length > 0) {
      this.doc.insertText(startPosition, finalText);
    }
```

With cell-aware routing:

```typescript
    const ca = startPosition.cellAddress;
    if (currentLength > 0) {
      if (ca) {
        this.doc.deleteTextInCell(startPosition.blockId, ca, startPosition.offset, currentLength);
      } else {
        this.doc.deleteText(startPosition, currentLength);
      }
    }
    if (finalText.length > 0) {
      if (ca) {
        this.doc.insertTextInCell(startPosition.blockId, ca, startPosition.offset, finalText);
      } else {
        this.doc.insertText(startPosition, finalText);
      }
    }
```

- [ ] **Step 2: Fix handleInput (composition active) to route through cell methods**

In `handleInput`, find the composition-active branch (around line 241).

Replace the delete + insert block:

```typescript
      if (currentLength > 0) {
        this.doc.deleteText(startPosition, currentLength);
      }
      if (newText.length > 0) {
        this.doc.insertText(startPosition, newText);
      }
```

With cell-aware routing:

```typescript
      const ca = startPosition.cellAddress;
      if (currentLength > 0) {
        if (ca) {
          this.doc.deleteTextInCell(startPosition.blockId, ca, startPosition.offset, currentLength);
        } else {
          this.doc.deleteText(startPosition, currentLength);
        }
      }
      if (newText.length > 0) {
        if (ca) {
          this.doc.insertTextInCell(startPosition.blockId, ca, startPosition.offset, newText);
        } else {
          this.doc.insertText(startPosition, newText);
        }
      }
```

- [ ] **Step 3: Fix applyHangulResult to route through cell methods**

In `applyHangulResult` (around line 2119), replace all `this.doc.deleteText` and `this.doc.insertText` calls with cell-aware versions.

For the commit section (result.commit with hangulComposingLength > 0):

```typescript
    if (result.commit) {
      if (this.hangulComposingLength > 0) {
        const ca = this.hangulStartPos.cellAddress;
        if (ca) {
          this.doc.deleteTextInCell(this.hangulStartPos.blockId, ca, this.hangulStartPos.offset, this.hangulComposingLength);
          this.doc.insertTextInCell(this.hangulStartPos.blockId, ca, this.hangulStartPos.offset, result.commit);
        } else {
          this.doc.deleteText(this.hangulStartPos, this.hangulComposingLength);
          this.doc.insertText(this.hangulStartPos, result.commit);
        }
        this.hangulStartPos = {
          blockId: this.hangulStartPos.blockId,
          offset: this.hangulStartPos.offset + result.commit.length,
          cellAddress: this.hangulStartPos.cellAddress,
        };
      } else {
        this.deleteSelection();
        const ca = this.cursor.position.cellAddress;
        if (ca) {
          this.doc.insertTextInCell(this.cursor.position.blockId, ca, this.cursor.position.offset, result.commit);
        } else {
          this.doc.insertText(this.cursor.position, result.commit);
        }
        this.hangulStartPos = {
          blockId: this.cursor.position.blockId,
          offset: this.cursor.position.offset + result.commit.length,
          cellAddress: this.cursor.position.cellAddress,
        };
      }
      this.hangulComposingLength = 0;
    }
```

For the composing section (result.composing):

```typescript
    if (result.composing) {
      if (this.hangulComposingLength === 0 && !result.commit) {
        this.saveSnapshot();
        this.deleteSelection();
        this.hangulStartPos = { ...this.cursor.position };
      }
      const ca = this.hangulStartPos.cellAddress;
      if (this.hangulComposingLength > 0) {
        if (ca) {
          this.doc.deleteTextInCell(this.hangulStartPos.blockId, ca, this.hangulStartPos.offset, this.hangulComposingLength);
        } else {
          this.doc.deleteText(this.hangulStartPos, this.hangulComposingLength);
        }
      }
      if (ca) {
        this.doc.insertTextInCell(this.hangulStartPos.blockId, ca, this.hangulStartPos.offset, result.composing);
      } else {
        this.doc.insertText(this.hangulStartPos, result.composing);
      }
      this.hangulComposingLength = result.composing.length;
    } else {
      this.hangulComposingLength = 0;
    }
```

- [ ] **Step 4: Run tests**

Run: `cd packages/docs && npx vitest run`
Expected: All pass (no regressions).

- [ ] **Step 5: Manual IME test**

Run: `pnpm dev`:
1. Insert a table
2. Click a cell
3. Switch to Korean IME, type "안녕하세요"
4. Verify text appears correctly in the cell
5. Test on multiple cells

- [ ] **Step 6: Commit**

```bash
git add packages/docs/src/view/text-editor.ts
git commit --no-verify -m "feat(docs): route IME composition through table cell methods"
```

---

### Task 5: Verification

- [ ] **Step 1: Run verify:fast**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 2: Full manual smoke test**

1. Open docs editor
2. Insert table via toolbar grid picker (3x4)
3. Type text in cells (English + Korean IME)
4. Tab through cells
5. Right-click → context menu: insert/delete rows/columns
6. Change cell background color
7. Delete table
8. Undo/Redo all operations
9. Right-click outside table → normal context menu
