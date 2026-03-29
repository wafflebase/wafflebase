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
                    editor.applyTableCellStyle({ backgroundColor: color });
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
              const blocks = doc.document.blocks;
              const tableBlock = blocks.find((b) => b.type === "table");
              if (tableBlock) {
                doc.deleteBlock(tableBlock.id);
                editor.render();
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
