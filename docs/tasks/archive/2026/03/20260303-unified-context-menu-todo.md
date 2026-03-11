# Unified Context Menu Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace three separate context menu implementations (vanilla JS, React mobile, Radix DropdownMenu) with a single Radix ContextMenu-based component that provides identical behavior on desktop and mobile.

**Architecture:** A new `SheetContextMenu` React component wraps the canvas container as a Radix `ContextMenuTrigger`. On right-click (desktop) or long-press (mobile, via synthetic `contextmenu` event), it determines menu type from `headerHitTest()` and renders the appropriate items. The tab bar switches from `DropdownMenu` to `ContextMenu`.

**Tech Stack:** `@radix-ui/react-context-menu`, React 19, TailwindCSS, Tabler Icons

**Design doc:** `design/context-menu.md`

---

## Task 1: Install `@radix-ui/react-context-menu`

**Files:**
- Modify: `packages/frontend/package.json`

**Step 1: Install the package**

Run:
```bash
cd packages/frontend && pnpm add @radix-ui/react-context-menu
```

**Step 2: Verify installation**

Run: `pnpm install && pnpm frontend build`
Expected: Build succeeds with no errors.

**Step 3: Commit**

```bash
git add packages/frontend/package.json pnpm-lock.yaml
git commit -m "Add @radix-ui/react-context-menu dependency"
```

---

## Task 2: Create `components/ui/context-menu.tsx` (shadcn/ui wrapper)

**Files:**
- Create: `packages/frontend/src/components/ui/context-menu.tsx`

Mirror the pattern from `packages/frontend/src/components/ui/dropdown-menu.tsx`, replacing `DropdownMenu` with `ContextMenu` throughout.

**Step 1: Create the shadcn/ui wrapper**

```tsx
import * as React from "react"
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu"

import { cn } from "@/lib/utils"

function ContextMenu({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

function ContextMenuTrigger({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      {...props}
    />
  )
}

function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        className={cn(
          "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-h-(--radix-context-menu-content-available-height) min-w-[8rem] origin-(--radix-context-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md",
          className
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn("bg-border -mx-1 my-1 h-px", className)}
      {...props}
    />
  )
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
}
```

**Step 2: Verify build**

Run: `pnpm frontend build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add packages/frontend/src/components/ui/context-menu.tsx
git commit -m "Add Radix ContextMenu UI wrapper (shadcn/ui pattern)"
```

---

## Task 3: Export `toColumnLabel` from sheet package

**Files:**
- Modify: `packages/sheet/src/index.ts`

The `toColumnLabel` function (in `model/coordinates.ts:285`) converts
1-based column indices to spreadsheet labels (A, B, ..., Z, AA, ...).
The React context menu needs it for "Show columns A-C" labels.

**Step 1: Add the import and export**

In `packages/sheet/src/index.ts`, add `toColumnLabel` to the import from
`'./model/coordinates'` and to the `export {}` block.

**Step 2: Verify build**

Run: `pnpm sheet build && pnpm sheet typecheck`
Expected: Pass.

**Step 3: Commit**

```bash
git add packages/sheet/src/index.ts
git commit -m "Export toColumnLabel from sheet package"
```

---

## Task 4: Add hide/show facade methods to `Spreadsheet`

**Files:**
- Modify: `packages/sheet/src/view/spreadsheet.ts`
- Modify: `packages/sheet/src/view/worksheet.ts` (make `findAdjacentHidden*` public)

The `Sheet` model already has `hideRows(indices)`, `showRows(indices)`,
`hideColumns(indices)`, `showColumns(indices)`. The `Worksheet` has
private `findAdjacentHiddenRows(from, to)` and
`findAdjacentHiddenColumns(from, to)`. We need to:

1. Make `findAdjacentHiddenRows` and `findAdjacentHiddenColumns` public
   on Worksheet (change `private` → `public`).
2. Add facade methods on `Spreadsheet`.

**Step 1: Make worksheet methods public**

In `packages/sheet/src/view/worksheet.ts`, change:
- Line 4700: `private findAdjacentHiddenRows` → `public findAdjacentHiddenRows`
- Line 4727: `private findAdjacentHiddenColumns` → `public findAdjacentHiddenColumns`

**Step 2: Add facade methods to `Spreadsheet`**

In `packages/sheet/src/view/spreadsheet.ts`, before the `cleanup()` method
(line 646), add:

```typescript
  public async hideRows(indices: number[]): Promise<void> {
    if (!this.sheet || this._readOnly) return;
    await this.sheet.hideRows(indices);
    this.worksheet.render();
  }

  public async showRows(indices: number[]): Promise<void> {
    if (!this.sheet || this._readOnly) return;
    await this.sheet.showRows(indices);
    this.worksheet.render();
  }

  public async hideColumns(indices: number[]): Promise<void> {
    if (!this.sheet || this._readOnly) return;
    await this.sheet.hideColumns(indices);
    this.worksheet.render();
  }

  public async showColumns(indices: number[]): Promise<void> {
    if (!this.sheet || this._readOnly) return;
    await this.sheet.showColumns(indices);
    this.worksheet.render();
  }

  public findAdjacentHiddenRows(
    from: number,
    to: number,
  ): number[] {
    return this.worksheet.findAdjacentHiddenRows(from, to);
  }

  public findAdjacentHiddenColumns(
    from: number,
    to: number,
  ): number[] {
    return this.worksheet.findAdjacentHiddenColumns(from, to);
  }
```

**Step 3: Verify typecheck and tests**

Run: `pnpm sheet typecheck && pnpm sheet test`
Expected: Pass.

**Step 4: Commit**

```bash
git add packages/sheet/src/view/spreadsheet.ts packages/sheet/src/view/worksheet.ts
git commit -m "Expose hide/show and findAdjacentHidden methods on facade"
```

---

## Task 5: Create `SheetContextMenu` component

**Files:**
- Create: `packages/frontend/src/components/sheet-context-menu.tsx`

This is the central new component. It wraps a child element (the canvas
container div) with `ContextMenuTrigger` and renders context-aware menu
items.

**Step 1: Write the component**

```tsx
import { useCallback, useRef, useState } from "react";
import type { Spreadsheet } from "@wafflebase/sheet";
import { toColumnLabel } from "@wafflebase/sheet";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import {
  IconCopy,
  IconCut,
  IconClipboard,
  IconTrash,
  IconRowInsertBottom,
  IconRowInsertTop,
  IconColumnInsertLeft,
  IconColumnInsertRight,
  IconEyeOff,
  IconEye,
} from "@tabler/icons-react";

type MenuType = "cell" | "row" | "column";

interface SelectionInfo {
  axis: "row" | "column";
  from: number;
  to: number;
}

interface SheetContextMenuProps {
  children: React.ReactNode;
  spreadsheet: Spreadsheet | undefined;
  readOnly?: boolean;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDeleteCellData: () => void;
  onInsertBefore: () => void;
  onInsertAfter: () => void;
  onDeleteRowCol: () => void;
  onClose?: () => void;
}

export function SheetContextMenu({
  children,
  spreadsheet,
  readOnly = false,
  onCopy,
  onCut,
  onPaste,
  onDeleteCellData,
  onInsertBefore,
  onInsertAfter,
  onDeleteRowCol,
  onClose,
}: SheetContextMenuProps) {
  const [menuType, setMenuType] = useState<MenuType>("cell");
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(
    null,
  );
  const [adjacentHidden, setAdjacentHidden] = useState<number[]>([]);
  const eventRef = useRef<{ clientX: number; clientY: number } | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!spreadsheet) return;

      eventRef.current = { clientX: e.clientX, clientY: e.clientY };

      const hit = spreadsheet.headerHitTest(e.clientX, e.clientY);
      let type: MenuType = "cell";
      if (hit?.axis === "row") type = "row";
      else if (hit?.axis === "column") type = "column";
      setMenuType(type);

      const sel = spreadsheet.getSelectedIndices();
      setSelectionInfo(sel);

      if (type === "row" && sel?.axis === "row") {
        setAdjacentHidden(
          spreadsheet.findAdjacentHiddenRows(sel.from, sel.to),
        );
      } else if (type === "column" && sel?.axis === "column") {
        setAdjacentHidden(
          spreadsheet.findAdjacentHiddenColumns(sel.from, sel.to),
        );
      } else if (type === "row" && hit) {
        setAdjacentHidden(
          spreadsheet.findAdjacentHiddenRows(hit.index, hit.index),
        );
      } else if (type === "column" && hit) {
        setAdjacentHidden(
          spreadsheet.findAdjacentHiddenColumns(hit.index, hit.index),
        );
      } else {
        setAdjacentHidden([]);
      }
    },
    [spreadsheet],
  );

  const handleHideRowCol = useCallback(async () => {
    if (!spreadsheet || !selectionInfo) return;
    const count = selectionInfo.to - selectionInfo.from + 1;
    const indices = Array.from({ length: count }, (_, i) => selectionInfo.from + i);
    if (selectionInfo.axis === "row") {
      await spreadsheet.hideRows(indices);
    } else {
      await spreadsheet.hideColumns(indices);
    }
  }, [spreadsheet, selectionInfo]);

  const handleShowRowCol = useCallback(async () => {
    if (!spreadsheet || adjacentHidden.length === 0) return;
    if (menuType === "row") {
      await spreadsheet.showRows(adjacentHidden);
    } else {
      await spreadsheet.showColumns(adjacentHidden);
    }
  }, [spreadsheet, adjacentHidden, menuType]);

  const count =
    selectionInfo && (menuType === selectionInfo.axis)
      ? selectionInfo.to - selectionInfo.from + 1
      : 1;

  const rowLabel = count > 1 ? `${count} rows` : "row";
  const colLabel = count > 1 ? `${count} columns` : "column";

  const showLabel = (() => {
    if (adjacentHidden.length === 0) return "";
    const min = Math.min(...adjacentHidden);
    const max = Math.max(...adjacentHidden);
    if (menuType === "row") {
      return min === max ? `Show row ${min}` : `Show rows ${min}\u2013${max}`;
    }
    return min === max
      ? `Show column ${toColumnLabel(min)}`
      : `Show columns ${toColumnLabel(min)}\u2013${toColumnLabel(max)}`;
  })();

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (!open) onClose?.();
      }}
    >
      <ContextMenuPrimitive.Trigger asChild onContextMenu={handleContextMenu}>
        {children}
      </ContextMenuPrimitive.Trigger>
      <ContextMenuContent>
        {menuType === "cell" && (
          <>
            <ContextMenuItem disabled={readOnly} onSelect={onCut}>
              <IconCut size={16} /> Cut
            </ContextMenuItem>
            <ContextMenuItem onSelect={onCopy}>
              <IconCopy size={16} /> Copy
            </ContextMenuItem>
            <ContextMenuItem disabled={readOnly} onSelect={onPaste}>
              <IconClipboard size={16} /> Paste
            </ContextMenuItem>
            <ContextMenuItem disabled={readOnly} onSelect={onDeleteCellData}>
              <IconTrash size={16} /> Delete
            </ContextMenuItem>
          </>
        )}
        {menuType === "row" && (
          <>
            <ContextMenuItem disabled={readOnly} onSelect={onInsertBefore}>
              <IconRowInsertTop size={16} /> Insert {rowLabel} above
            </ContextMenuItem>
            <ContextMenuItem disabled={readOnly} onSelect={onInsertAfter}>
              <IconRowInsertBottom size={16} /> Insert {rowLabel} below
            </ContextMenuItem>
            <ContextMenuItem disabled={readOnly} onSelect={onDeleteRowCol}>
              <IconTrash size={16} /> Delete {rowLabel}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={readOnly} onSelect={handleHideRowCol}>
              <IconEyeOff size={16} /> Hide {rowLabel}
            </ContextMenuItem>
            {adjacentHidden.length > 0 && (
              <ContextMenuItem disabled={readOnly} onSelect={handleShowRowCol}>
                <IconEye size={16} /> {showLabel}
              </ContextMenuItem>
            )}
          </>
        )}
        {menuType === "column" && (
          <>
            <ContextMenuItem disabled={readOnly} onSelect={onInsertBefore}>
              <IconColumnInsertLeft size={16} /> Insert {colLabel} left
            </ContextMenuItem>
            <ContextMenuItem disabled={readOnly} onSelect={onInsertAfter}>
              <IconColumnInsertRight size={16} /> Insert {colLabel} right
            </ContextMenuItem>
            <ContextMenuItem disabled={readOnly} onSelect={onDeleteRowCol}>
              <IconTrash size={16} /> Delete {colLabel}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={readOnly} onSelect={handleHideRowCol}>
              <IconEyeOff size={16} /> Hide {colLabel}
            </ContextMenuItem>
            {adjacentHidden.length > 0 && (
              <ContextMenuItem disabled={readOnly} onSelect={handleShowRowCol}>
                <IconEye size={16} /> {showLabel}
              </ContextMenuItem>
            )}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
```

**Step 2: Verify build**

Run: `pnpm frontend build`
Expected: Build succeeds (component not yet wired in).

**Step 3: Commit**

```bash
git add packages/frontend/src/components/sheet-context-menu.tsx
git commit -m "Add SheetContextMenu component with unified menu items"
```

---

## Task 6: Wire `SheetContextMenu` into `sheet-view.tsx`

**Files:**
- Modify: `packages/frontend/src/app/spreadsheet/sheet-view.tsx`

Replace the `MobileContextMenu` usage with `SheetContextMenu` wrapping
the canvas container div. Remove mobile-only guard — the context menu
now works on both platforms.

**Step 1: Update imports**

Replace:
```tsx
import { MobileContextMenu, type MobileContextMenuType } from "@/components/mobile-context-menu";
```
With:
```tsx
import { SheetContextMenu } from "@/components/sheet-context-menu";
```

**Step 2: Remove the `contextMenu` state and `handleLongPress` callback**

Remove lines 119 and 139-141:
```tsx
const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
const handleLongPress = useCallback((clientX: number, clientY: number) => {
  setContextMenu({ x: clientX, y: clientY });
}, []);
```

**Step 3: Update `useMobileSheetGestures` call**

Change:
```tsx
useMobileSheetGestures({ containerRef, sheetRef, onLongPress: handleLongPress });
```
To:
```tsx
useMobileSheetGestures({ containerRef, sheetRef });
```

The long-press handler will now dispatch a synthetic `contextmenu` event
instead (see Task 7).

**Step 4: Remove the `handleContextMenuClose` callback and the `setContextMenu(null)` in the selection change listener**

Remove:
```tsx
const handleContextMenuClose = useCallback(() => {
  setContextMenu(null);
}, []);
```

And remove:
```tsx
unsubs.push(
  s.onSelectionChange(() => {
    setContextMenu(null);
  }),
);
```

**Step 5: Remove `onContextMenu` prevention on the container div**

Change:
```tsx
onContextMenu={isMobile ? (e) => e.preventDefault() : undefined}
```
Remove this prop entirely — Radix ContextMenu handles it.

**Step 6: Wrap the canvas container div with `SheetContextMenu`**

Replace:
```tsx
<div
  ref={containerRef}
  className="h-full w-full select-none"
  style={{ touchAction: "manipulation", WebkitTouchCallout: "none" }}
  onPointerDown={handleGridPointerDown}
/>
```
With:
```tsx
<SheetContextMenu
  spreadsheet={sheetRef.current}
  readOnly={readOnly}
  onCopy={handleContextMenuCopy}
  onCut={handleContextMenuCut}
  onPaste={handleContextMenuPaste}
  onDeleteCellData={handleContextMenuDelete}
  onInsertBefore={handleInsertBefore}
  onInsertAfter={handleInsertAfter}
  onDeleteRowCol={handleDeleteRowCol}
>
  <div
    ref={containerRef}
    className="h-full w-full select-none"
    style={{ touchAction: "manipulation", WebkitTouchCallout: "none" }}
    onPointerDown={handleGridPointerDown}
  />
</SheetContextMenu>
```

**Step 7: Remove the `MobileContextMenu` JSX block**

Remove lines 840-858 (the entire `{isMobile && contextMenu && <MobileContextMenu .../>}` block).

**Step 8: Verify build**

Run: `pnpm frontend build`
Expected: Build succeeds.

**Step 9: Commit**

```bash
git add packages/frontend/src/app/spreadsheet/sheet-view.tsx
git commit -m "Wire SheetContextMenu into SheetView, replacing MobileContextMenu"
```

---

## Task 7: Dispatch synthetic `contextmenu` from mobile long-press

**Files:**
- Modify: `packages/frontend/src/hooks/use-mobile-sheet-gestures.ts`

Instead of calling `onLongPress` to open a React state-driven menu, the
long-press handler now dispatches a synthetic `contextmenu` event on the
container. Radix ContextMenu intercepts this and opens the same menu.

**Step 1: Remove `onLongPress` from the options interface**

Remove the `onLongPress` property from `UseMobileSheetGesturesOptions`
(line 21).

**Step 2: Change the long-press timer callback**

Replace lines 121-125:
```tsx
longPressTimer = setTimeout(() => {
  longPressTimer = null;
  longPressFired = true;
  onLongPress?.(startX, startY);
}, LongPressDelayMs);
```
With:
```tsx
longPressTimer = setTimeout(() => {
  longPressTimer = null;
  longPressFired = true;
  container.dispatchEvent(
    new MouseEvent("contextmenu", {
      clientX: startX,
      clientY: startY,
      bubbles: true,
      cancelable: true,
    }),
  );
}, LongPressDelayMs);
```

**Step 3: Remove `onLongPress` from the effect dependency array**

In the useEffect dependency array (line 309), remove `onLongPress`:
```tsx
}, [containerRef, enabled, isMobile, sheetRef]);
```

**Step 4: Verify build**

Run: `pnpm frontend build`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add packages/frontend/src/hooks/use-mobile-sheet-gestures.ts
git commit -m "Dispatch synthetic contextmenu event on mobile long-press"
```

---

## Task 8: Update tab bar to use `ContextMenu`

**Files:**
- Modify: `packages/frontend/src/components/tab-bar.tsx`

Replace the `DropdownMenu` wrapping each tab with `ContextMenu`. This
makes right-click (desktop) and long-press (mobile) open the tab menu
naturally.

**Step 1: Update imports**

Replace the DropdownMenu imports for the tab context menu with
ContextMenu imports:
```tsx
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
```

Keep the DropdownMenu imports because the "Add tab" button (lines 279-295)
still uses DropdownMenu.

**Step 2: Remove `contextTabId` state**

Remove:
```tsx
const [contextTabId, setContextTabId] = useState<string | null>(null);
```

The Radix `ContextMenu` manages its own open state internally.

**Step 3: Remove the `onContextMenu` prop from `SortableTab`**

Remove from the `SortableTab` props interface and usage:
- `onContextMenu: (e: React.MouseEvent) => void`
- `onContextMenu={onContextMenu}` from the `<button>` element

**Step 4: Replace the tab rendering JSX**

Replace lines 224-274 (the `DropdownMenu` block per tab) with:
```tsx
{tabs.map((tab) => (
  <ContextMenu key={tab.id}>
    <ContextMenuPrimitive.Trigger asChild>
      <div>
        <SortableTab
          tab={tab}
          isActive={tab.id === activeTabId}
          isEditing={editingTabId === tab.id}
          editValue={editValue}
          onEditValueChange={setEditValue}
          onSelect={() => onSelectTab(tab.id)}
          onStartRename={() => startRename(tab)}
          onCommitRename={commitRename}
          onCancelRename={cancelRename}
          inputRef={inputRef}
        />
      </div>
    </ContextMenuPrimitive.Trigger>
    <ContextMenuContent>
      <ContextMenuItem
        onSelect={() => {
          setTimeout(() => startRename(tab), 0);
        }}
      >
        Rename
      </ContextMenuItem>
      {tabs.length > 1 && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onSelect={() => onDeleteTab(tab.id)}
          >
            Delete
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  </ContextMenu>
))}
```

Note: Add `import * as ContextMenuPrimitive from "@radix-ui/react-context-menu"` for the Trigger.

**Step 5: Verify build**

Run: `pnpm frontend build`
Expected: Build succeeds.

**Step 6: Commit**

```bash
git add packages/frontend/src/components/tab-bar.tsx
git commit -m "Switch tab bar from DropdownMenu to ContextMenu"
```

---

## Task 9: Remove old context menu implementations

**Files:**
- Delete: `packages/sheet/src/view/contextmenu.ts`
- Modify: `packages/sheet/src/view/worksheet.ts`
- Delete: `packages/frontend/src/components/mobile-context-menu.tsx`

**Step 1: Remove `contextmenu.ts`**

Delete the file: `packages/sheet/src/view/contextmenu.ts`

**Step 2: Remove ContextMenu from worksheet.ts**

In `packages/sheet/src/view/worksheet.ts`:

1. Remove the import (line 22):
   ```tsx
   import { ContextMenu } from './contextmenu';
   ```

2. Remove the field declaration (line 111):
   ```tsx
   private contextMenu: ContextMenu;
   ```

3. Remove initialization (line 196):
   ```tsx
   this.contextMenu = new ContextMenu(theme);
   ```

4. Remove the `contextMenu.getContainer()` from the scrollContainer
   appendChild calls if present.

5. Remove `this.contextMenu.cleanup()` from cleanup() (line 395).

6. Remove the entire `handleContextMenu` method (lines 1117-1255).

7. Remove the contextmenu event listener registration (lines 1945-1947):
   ```tsx
   this.addEventListener(scrollContainer, 'contextmenu', (e) => {
     this.handleContextMenu(e);
   });
   ```

**Step 3: Delete `mobile-context-menu.tsx`**

Delete: `packages/frontend/src/components/mobile-context-menu.tsx`

**Step 4: Verify typecheck and tests**

Run: `pnpm sheet typecheck && pnpm sheet test && pnpm frontend build`
Expected: All pass.

**Step 5: Commit**

```bash
git add -A
git commit -m "Remove vanilla JS ContextMenu and MobileContextMenu

The unified SheetContextMenu component replaces both implementations.
Desktop right-click and mobile long-press now share the same Radix
ContextMenu-based component."
```

---

## Task 10: Update visual regression test scenarios

**Files:**
- Modify: `packages/frontend/src/app/harness/visual/sheet-scenarios.tsx`

The three mobile context menu scenarios (`sheet-mobile-context-menu`,
`sheet-mobile-row-menu`, `sheet-mobile-column-menu`) currently render a
manually-constructed DOM that mimics `MobileContextMenu`. Update them to
render the new `SheetContextMenu`'s menu items using the same Radix
`ContextMenuContent` styling, or replace with equivalent static mockups
that match the new component's visual output.

Since the Radix ContextMenu renders via Portal and requires user
interaction to open, the visual scenarios should render static menu mockups
that use the same Tailwind classes as `ContextMenuContent` and
`ContextMenuItem`.

**Step 1: Update scenario menu items and styling**

Update the three scenario helper functions to use Tailwind classes matching
the Radix ContextMenu wrapper: `bg-popover text-popover-foreground
rounded-md border p-1 shadow-md` for the container, and standard
ContextMenuItem classes for each item. Add separator between main actions
and hide/show items for row/column menus. Add Hide/Show items to row and
column menus.

**Step 2: Update baselines**

Run: `pnpm verify:frontend:visual:browser -- --update-baselines`
Expected: Baselines regenerated with new menu appearance.

**Step 3: Verify visual tests pass**

Run: `pnpm verify:frontend:visual:browser`
Expected: All scenarios pass.

**Step 4: Commit**

```bash
git add -A
git commit -m "Update visual regression scenarios for unified context menu"
```

---

## Task 11: Final verification and cleanup

**Step 1: Run full fast verification**

Run: `pnpm verify:fast`
Expected: All lint + unit tests pass.

**Step 2: Run visual regression**

Run: `pnpm verify:frontend:visual:all`
Expected: All visual tests pass.

**Step 3: Run architecture checks**

Run: `pnpm verify:architecture`
Expected: No import boundary violations.

**Step 4: Manual smoke test (if dev server available)**

- Desktop: Right-click on a cell → see Cut/Copy/Paste/Delete menu
- Desktop: Right-click on row header → see Insert/Delete/Hide/Show menu
- Desktop: Right-click on column header → same pattern
- Desktop: Right-click on a sheet tab → see Rename/Delete menu
- Mobile (resize browser): Long-press on cell → same cell menu
- Mobile: Long-press on row/column header → same row/column menu
- Multi-select rows: Right-click → labels show "3 rows" etc.
- Read-only mode: All modifying items are disabled

---

## Risk Mitigations

**Synthetic contextmenu on mobile:** If Radix ContextMenu does not
respond to synthetic MouseEvents (unlikely but possible), the fallback
is to use Radix's controlled `open` prop:

```tsx
<ContextMenu open={isOpen} onOpenChange={setIsOpen}>
```

Combined with a manually positioned `ContextMenuContent` using the
`style` prop. This preserves the unified component while adding a
controlled-mode path for mobile.

**Canvas event interception:** The canvas container must not have
`e.preventDefault()` on contextmenu before Radix intercepts it. Task 6
removes the mobile-only `onContextMenu` prevention to ensure this.
