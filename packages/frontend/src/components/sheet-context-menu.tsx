import { useCallback, useState } from "react";
import type { Spreadsheet } from "@wafflebase/sheets";
import { toColumnLabel, inRange } from "@wafflebase/sheets";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  IconCopy,
  IconCut,
  IconClipboard,
  IconLayoutRows,
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
  onInsertPivotTable?: () => void;
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
  onInsertPivotTable,
}: SheetContextMenuProps) {
  const [menuType, setMenuType] = useState<MenuType>("cell");
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(
    null,
  );
  const [adjacentHidden, setAdjacentHidden] = useState<number[]>([]);

  const updateMenuState = useCallback(
    (clientX: number, clientY: number) => {
      if (!spreadsheet) return;

      const hit = spreadsheet.headerHitTest(clientX, clientY);

      if (hit) {
        const sel = spreadsheet.getSelectedIndices();
        const withinSelection =
          sel &&
          sel.axis === hit.axis &&
          hit.index >= sel.from &&
          hit.index <= sel.to;

        if (!withinSelection) {
          if (hit.axis === "row") {
            spreadsheet.selectRow(hit.index);
          } else {
            spreadsheet.selectColumn(hit.index);
          }
        }
      } else {
        const ref = spreadsheet.cellRefFromPoint(clientX, clientY);
        const currentRange = spreadsheet.getSelectionRangeOrActiveCell();
        if (!currentRange || !inRange(ref, currentRange)) {
          spreadsheet.selectStart(ref);
        }
      }

      const type: MenuType =
        hit?.axis === "row"
          ? "row"
          : hit?.axis === "column"
            ? "column"
            : "cell";
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
      } else {
        setAdjacentHidden([]);
      }
    },
    [spreadsheet],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!spreadsheet) return;
      updateMenuState(e.clientX, e.clientY);
    },
    [spreadsheet, updateMenuState],
  );

  const handleHideRowCol = useCallback(async () => {
    if (!spreadsheet || !selectionInfo) return;
    const count = selectionInfo.to - selectionInfo.from + 1;
    const indices = Array.from(
      { length: count },
      (_, i) => selectionInfo.from + i,
    );
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
    selectionInfo && menuType === selectionInfo.axis
      ? selectionInfo.to - selectionInfo.from + 1
      : 1;

  const rowLabel = count > 1 ? `${count} rows` : "row";
  const colLabel = count > 1 ? `${count} columns` : "column";

  const showLabel = (() => {
    if (adjacentHidden.length === 0) return "";
    const min = Math.min(...adjacentHidden);
    const max = Math.max(...adjacentHidden);
    if (menuType === "row") {
      return min === max
        ? `Show row ${min}`
        : `Show rows ${min}\u2013${max}`;
    }
    return min === max
      ? `Show column ${toColumnLabel(min)}`
      : `Show columns ${toColumnLabel(min)}\u2013${toColumnLabel(max)}`;
  })();

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenu={handleContextMenu}>
        {children}
      </ContextMenuTrigger>
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
            {onInsertPivotTable && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem disabled={readOnly} onSelect={onInsertPivotTable}>
                  <IconLayoutRows size={16} /> Insert pivot table
                </ContextMenuItem>
              </>
            )}
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
              <ContextMenuItem
                disabled={readOnly}
                onSelect={handleShowRowCol}
              >
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
              <ContextMenuItem
                disabled={readOnly}
                onSelect={handleShowRowCol}
              >
                <IconEye size={16} /> {showLabel}
              </ContextMenuItem>
            )}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
