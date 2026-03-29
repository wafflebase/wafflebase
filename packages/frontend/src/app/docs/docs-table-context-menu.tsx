import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorAPI } from "@wafflebase/docs";
import { BG_COLORS } from "@/components/formatting-colors";
import {
  IconRowInsertTop,
  IconRowInsertBottom,
  IconColumnInsertLeft,
  IconColumnInsertRight,
  IconRowRemove,
  IconColumnRemove,
  IconArrowsSplit,
  IconDropletOff,
  IconPalette,
  IconTableOff,
} from "@tabler/icons-react";

interface DocsTableContextMenuProps {
  editor: EditorAPI | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

interface MenuPosition {
  x: number;
  y: number;
}

/**
 * Context menu for table cell operations.
 *
 * Plain positioned overlay — avoids Radix ContextMenu which blocks
 * Canvas pointer events.
 */
export function DocsTableContextMenu({
  editor,
  containerRef,
}: DocsTableContextMenuProps) {
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [showColors, setShowColors] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback(
    (e: MouseEvent) => {
      if (!editor?.isInTable()) return;
      e.preventDefault();
      setPosition({ x: e.clientX, y: e.clientY });
      setShowColors(false);
    },
    [editor],
  );

  const close = useCallback(() => {
    setPosition(null);
    setShowColors(false);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("contextmenu", handleContextMenu);
    return () => el.removeEventListener("contextmenu", handleContextMenu);
  }, [containerRef, handleContextMenu]);

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

  const item =
    "flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground";
  const sep = "my-1 h-px bg-border -mx-1";
  const label = "px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground";
  const iconSize = 16;

  const act = (fn: () => void) => () => {
    fn();
    editor.focus();
    close();
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[12rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
      style={{ left: position.x, top: position.y }}
    >
      {/* Row */}
      <div className={label}>Row</div>
      <button className={item} onClick={act(() => editor.insertTableRow(true))}>
        <IconRowInsertTop size={iconSize} className="text-muted-foreground" />
        Insert above
      </button>
      <button className={item} onClick={act(() => editor.insertTableRow(false))}>
        <IconRowInsertBottom size={iconSize} className="text-muted-foreground" />
        Insert below
      </button>
      <button className={item} onClick={act(() => editor.deleteTableRow())}>
        <IconRowRemove size={iconSize} className="text-muted-foreground" />
        Delete row
      </button>

      <div className={sep} />

      {/* Column */}
      <div className={label}>Column</div>
      <button className={item} onClick={act(() => editor.insertTableColumn(true))}>
        <IconColumnInsertLeft size={iconSize} className="text-muted-foreground" />
        Insert left
      </button>
      <button className={item} onClick={act(() => editor.insertTableColumn(false))}>
        <IconColumnInsertRight size={iconSize} className="text-muted-foreground" />
        Insert right
      </button>
      <button className={item} onClick={act(() => editor.deleteTableColumn())}>
        <IconColumnRemove size={iconSize} className="text-muted-foreground" />
        Delete column
      </button>

      <div className={sep} />

      {/* Cell */}
      <button className={item} onClick={act(() => editor.splitTableCell())}>
        <IconArrowsSplit size={iconSize} className="text-muted-foreground" />
        Split cell
      </button>
      <button
        className={item}
        onClick={(e) => {
          e.stopPropagation();
          setShowColors((v) => !v);
        }}
      >
        <IconPalette size={iconSize} className="text-muted-foreground" />
        Cell background
      </button>
      {showColors && (
        <div className="px-2 py-1.5">
          <button
            className="mb-2 flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted"
            onClick={act(() =>
              editor.applyTableCellStyle({ backgroundColor: "" }),
            )}
          >
            <IconDropletOff size={14} />
            Reset
          </button>
          <div className="grid grid-cols-5 gap-1">
            {BG_COLORS.map((color) => (
              <button
                key={color}
                className="h-5 w-5 cursor-pointer rounded border border-border hover:scale-125 transition-transform"
                style={{ backgroundColor: color }}
                onClick={act(() =>
                  editor.applyTableCellStyle({ backgroundColor: color }),
                )}
                aria-label={`Background ${color}`}
              />
            ))}
          </div>
        </div>
      )}

      <div className={sep} />

      {/* Table */}
      <button
        className={item}
        onClick={act(() => {
          editor.deleteTable();
        })}
      >
        <IconTableOff size={iconSize} className="text-muted-foreground" />
        Delete table
      </button>
    </div>
  );
}
