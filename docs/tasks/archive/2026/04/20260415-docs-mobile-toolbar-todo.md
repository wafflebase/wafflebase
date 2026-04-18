# Docs Mobile Toolbar Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add mobile-responsive overflow menu to the Docs formatting toolbar, matching the Sheets toolbar pattern.

**Architecture:** Add `useIsMobile()` hook to `DocsFormattingToolbar`. On mobile (<768px), show only core tools (Undo, Redo, Bold, Italic, Underline, Text Color, Highlight Color) inline, and collapse everything else (Styles dropdown, Link, Image, Table, Alignment, Lists, Indent, Export) into a single `⋮` overflow `DropdownMenu` with labeled sections and separators.

**Tech Stack:** React, Radix DropdownMenu, Tabler Icons, `useIsMobile()` hook

---

## File Map

- **Modify:** `packages/frontend/src/app/docs/docs-formatting-toolbar.tsx`
  - Add `useIsMobile` import
  - Wrap desktop-only items in `{!isMobile && (...)}`
  - Add mobile overflow menu in `{isMobile && (...)}`

No new files needed. Single-file change following the established Sheets pattern.

---

### Task 1: Add mobile hook and hide desktop-only items

**Files:**
- Modify: `packages/frontend/src/app/docs/docs-formatting-toolbar.tsx`

- [x] **Step 1: Add imports**

Add `useIsMobile` hook and new icons needed for the overflow menu:

```tsx
import { useIsMobile } from "@/hooks/use-mobile";
import {
  IconDotsVertical,
} from "@tabler/icons-react";
```

Also add these imports from the dropdown-menu (already partially imported):

```tsx
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuLabel,      // NEW
  DropdownMenuSeparator,  // NEW
} from "@/components/ui/dropdown-menu";
```

- [x] **Step 2: Call the hook**

Inside `DocsFormattingToolbar`, right after the existing state declarations:

```tsx
const isMobile = useIsMobile();
```

- [x] **Step 3: Hide desktop-only items on mobile**

Wrap the following sections with `{!isMobile && (...)}`:

1. **Styles dropdown** (lines 501-535) — the `min-w-[110px]` block type dropdown
2. **The separator after Styles** (line 537)
3. **Insert group** — Link button, InsertImageDropdown, TableDropdown (lines 654-669)
4. **The separator after Insert** (line 671)
5. **Block styles group** — Alignment dropdown, Numbered list, Bulleted list, Indent decrease, Indent increase (lines 674-759)
6. **The separator before Export** (line 761)
7. **Export DOCX button** (lines 764-776)

Keep always visible: Undo, Redo, separator, Bold, Italic, Underline, Text Color, Highlight Color.

- [x] **Step 4: Run lint to verify no syntax errors**

Run: `cd /Users/hackerwins/Development/wafflebase/wafflebase && pnpm lint`
Expected: PASS (no errors in docs-formatting-toolbar.tsx)

---

### Task 2: Add the mobile overflow menu

**Files:**
- Modify: `packages/frontend/src/app/docs/docs-formatting-toolbar.tsx`

- [x] **Step 1: Add the overflow menu after the Highlight Color dropdown**

Right after the closing `</DropdownMenu>` for Highlight Color and before the `{!isMobile && (` block, add:

```tsx
{isMobile && (
  <>
    <ToolbarSeparator />
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted"
          aria-label="More formatting options"
        >
          <IconDotsVertical size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* ── Styles ── */}
        <DropdownMenuLabel>Styles</DropdownMenuLabel>
        {STYLE_OPTIONS.map((opt) => (
          <DropdownMenuItem
            key={opt.label}
            onClick={() =>
              handleBlockType(
                opt.type,
                opt.headingLevel
                  ? { headingLevel: opt.headingLevel }
                  : undefined,
              )
            }
          >
            <span className={opt.className}>{opt.label}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />

        {/* ── Insert ── */}
        <DropdownMenuLabel>Insert</DropdownMenuLabel>
        <DropdownMenuItem onClick={handleInsertLink}>
          <IconLink size={16} className="mr-2" />
          Link
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            /* Trigger file input for image upload */
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "image/*";
            input.onchange = async (e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file && editor) {
                await insertImageFromFile(editor, file);
              }
            };
            input.click();
          }}
        >
          <IconPhoto size={16} className="mr-2" />
          Image
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            editor?.insertTable(3, 3);
            editor?.focus();
          }}
        >
          <IconTable size={16} className="mr-2" />
          Table (3×3)
        </DropdownMenuItem>
        <DropdownMenuSeparator />

        {/* ── Align ── */}
        <DropdownMenuLabel>Align</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => handleAlign("left")}>
          <IconAlignLeft size={16} className="mr-2" />
          Left
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleAlign("center")}>
          <IconAlignCenter size={16} className="mr-2" />
          Center
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleAlign("right")}>
          <IconAlignRight size={16} className="mr-2" />
          Right
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleAlign("justify")}>
          <IconAlignJustified size={16} className="mr-2" />
          Justify
        </DropdownMenuItem>
        <DropdownMenuSeparator />

        {/* ── List ── */}
        <DropdownMenuLabel>List</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => {
            editor?.toggleList("ordered");
            editor?.focus();
          }}
        >
          <IconListNumbers size={16} className="mr-2" />
          Numbered list
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            editor?.toggleList("unordered");
            editor?.focus();
          }}
        >
          <IconList size={16} className="mr-2" />
          Bulleted list
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            editor?.outdent();
            editor?.focus();
          }}
        >
          <IconIndentDecrease size={16} className="mr-2" />
          Decrease indent
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            editor?.indent();
            editor?.focus();
          }}
        >
          <IconIndentIncrease size={16} className="mr-2" />
          Increase indent
        </DropdownMenuItem>
        <DropdownMenuSeparator />

        {/* ── Export ── */}
        <DropdownMenuItem onClick={handleExportDocx} disabled={!editor || exporting}>
          <IconFileDownload size={16} className="mr-2" />
          Export as DOCX
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </>
)}
```

- [x] **Step 2: Run verify:fast**

Run: `cd /Users/hackerwins/Development/wafflebase/wafflebase && pnpm verify:fast`
Expected: PASS

- [x] **Step 3: Manual test — resize browser to < 768px**

Open the Docs editor, resize browser width below 768px:
- Verify: Only Undo, Redo, Bold, Italic, Underline, Text Color, Highlight Color, and ⋮ button visible
- Verify: ⋮ menu opens and shows Styles, Insert, Align, List, Export sections
- Verify: Each menu item triggers the correct action
- Verify: Desktop (>768px) shows all items as before

- [x] **Step 4: Commit**

```bash
git add packages/frontend/src/app/docs/docs-formatting-toolbar.tsx
git commit -m "Add mobile overflow menu to Docs formatting toolbar

Apply the same mobile-responsive pattern used in Sheets: on viewports
narrower than 768px, show only core formatting tools (undo/redo, bold,
italic, underline, text/highlight color) inline and collapse styles,
insert, alignment, list, and export actions into a ⋮ overflow menu."
```
