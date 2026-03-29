import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorAPI } from "@wafflebase/docs";
import { BG_COLORS } from "@/components/formatting-colors";

interface DocsTableContextMenuProps {
  editor: EditorAPI | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

interface MenuPosition {
  x: number;
  y: number;
}

/**
 * A simple context menu for table cell operations.
 *
 * Renders a positioned overlay when the user right-clicks inside a table cell.
 * Uses a plain div + portal approach instead of Radix ContextMenu to avoid
 * interfering with the Canvas editor's pointer events.
 */
export function DocsTableContextMenu({
  editor,
  containerRef,
}: DocsTableContextMenuProps) {
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback(
    (e: MouseEvent) => {
      if (!editor?.isInTable()) return;
      e.preventDefault();
      setPosition({ x: e.clientX, y: e.clientY });
    },
    [editor],
  );

  const close = useCallback(() => setPosition(null), []);

  // Attach contextmenu listener to the container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("contextmenu", handleContextMenu);
    return () => el.removeEventListener("contextmenu", handleContextMenu);
  }, [containerRef, handleContextMenu]);

  // Close on click outside or Escape
  useEffect(() => {
    if (!position) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        close();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [position, close]);

  if (!position || !editor) return null;

  const menuItem =
    "flex w-full cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground";
  const menuItemDestructive =
    "flex w-full cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-none text-destructive hover:bg-destructive/10";
  const separator = "my-1 h-px bg-border -mx-1";

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[14rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
      style={{ left: position.x, top: position.y }}
    >
      <button className={menuItem} onClick={() => { editor.insertTableRow(true); editor.focus(); close(); }}>
        Insert row above
      </button>
      <button className={menuItem} onClick={() => { editor.insertTableRow(false); editor.focus(); close(); }}>
        Insert row below
      </button>
      <div className={separator} />
      <button className={menuItem} onClick={() => { editor.insertTableColumn(true); editor.focus(); close(); }}>
        Insert column left
      </button>
      <button className={menuItem} onClick={() => { editor.insertTableColumn(false); editor.focus(); close(); }}>
        Insert column right
      </button>
      <div className={separator} />
      <button className={menuItemDestructive} onClick={() => { editor.deleteTableRow(); editor.focus(); close(); }}>
        Delete row
      </button>
      <button className={menuItemDestructive} onClick={() => { editor.deleteTableColumn(); editor.focus(); close(); }}>
        Delete column
      </button>
      <div className={separator} />
      <button className={menuItem} onClick={() => { editor.splitTableCell(); editor.focus(); close(); }}>
        Split cell
      </button>
      <div className={separator} />
      <div className="px-2 py-1.5">
        <div className="mb-1 text-xs text-muted-foreground">Cell background</div>
        <div className="grid grid-cols-5 gap-1">
          {BG_COLORS.map((color) => (
            <button
              key={color}
              className="h-5 w-5 rounded-sm border border-border hover:ring-2 hover:ring-primary"
              style={{ backgroundColor: color }}
              onClick={() => { editor.applyTableCellStyle({ backgroundColor: color }); editor.focus(); close(); }}
              aria-label={`Background ${color}`}
            />
          ))}
        </div>
      </div>
      <div className={separator} />
      <button
        className={menuItemDestructive}
        onClick={() => {
          const doc = editor.getDoc();
          const blocks = doc.document.blocks;
          const addr = editor.getCellAddress();
          if (addr) {
            // Find the block the cursor is in (it's a table)
            const tableBlock = blocks.find((b) => b.type === "table");
            if (tableBlock) {
              doc.deleteBlock(tableBlock.id);
              editor.render();
            }
          }
          editor.focus();
          close();
        }}
      >
        Delete table
      </button>
    </div>
  );
}
