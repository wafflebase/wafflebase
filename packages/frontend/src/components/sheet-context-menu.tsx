import { useCallback, useState } from "react";
import type { Spreadsheet } from "@wafflebase/sheets";
import {
  toColumnLabel,
  inRange,
  MaxSnappedFreeze,
} from "@wafflebase/sheets";
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
  IconMessage,
  IconMessages,
  IconTrash,
  IconRowInsertBottom,
  IconRowInsertTop,
  IconColumnInsertLeft,
  IconColumnInsertRight,
  IconEyeOff,
  IconEye,
  IconListCheck,
  IconSnowflake,
  IconSnowflakeOff,
} from "@tabler/icons-react";

type MenuType = "cell" | "row" | "column";

interface SelectionInfo {
  axis: "row" | "column";
  from: number;
  to: number;
}

/**
 * The rows and columns a cell-menu right-click acts on: the span of the
 * selection (or the active cell), normalized so a range drawn bottom-up
 * still reads top-to-bottom.
 */
interface CellSpan {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface FreezeInfo {
  frozenRows: number;
  frozenCols: number;
}

interface SheetContextMenuProps {
  children: React.ReactNode;
  spreadsheet: Spreadsheet | undefined;
  readOnly?: boolean;
  /**
   * Refuses row/column insert and delete while leaving the rest of the menu
   * alone. A pivot output tab is the case: its cells are materialized from
   * the pivot definition, and `Sheet.insertRows` & co. already no-op there, so
   * an enabled item would be a click that silently does nothing.
   */
  structureLocked?: boolean;
  /**
   * Withholds the menu without unmounting the grid it wraps.
   *
   * The content is a `document.body` portal at `z-50`, so it escapes the
   * surface box a revision preview covers and would paint above the overlay
   * with Cut / Paste / Insert / Delete all writing the LIVE sheet. Dropping
   * the wrapper instead would remount `children` — the canvas container —
   * so the trigger is disabled in place, and the selection side effects of
   * opening it are refused with it.
   */
  disabled?: boolean;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDeleteCellData: () => void;
  onInsertBefore: () => void;
  onInsertAfter: () => void;
  onDeleteRowCol: () => void;
  onInsertPivotTable?: () => void;
  onDeleteImage?: () => void;
  selectedImageId?: string | null;
  onInsertComment?: () => void;
  /**
   * "Send to chat": hands a link to the selection to the editor's chat panel.
   * Omitted where there is no panel to send to (a share-link viewer). Not a
   * write, so a read-only sheet offers it too.
   */
  onSendToChat?: () => void;
  onOpenDataValidation?: () => void;
}

export function SheetContextMenu({
  children,
  spreadsheet,
  readOnly = false,
  structureLocked = false,
  disabled = false,
  onCopy,
  onCut,
  onPaste,
  onDeleteCellData,
  onInsertBefore,
  onInsertAfter,
  onDeleteRowCol,
  onInsertPivotTable,
  onDeleteImage,
  selectedImageId,
  onInsertComment,
  onSendToChat,
  onOpenDataValidation,
}: SheetContextMenuProps) {
  const [menuType, setMenuType] = useState<MenuType>("cell");
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(
    null,
  );
  const [adjacentHidden, setAdjacentHidden] = useState<number[]>([]);
  const [cellSpan, setCellSpan] = useState<CellSpan | null>(null);
  const [freeze, setFreeze] = useState<FreezeInfo>({
    frozenRows: 0,
    frozenCols: 0,
  });

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
        // The selection border reaches into the neighbouring cell, so a
        // right-click on it keeps the selection rather than moving to `ref`.
        if (
          !currentRange ||
          (!inRange(ref, currentRange) &&
            !spreadsheet.isOnSelectionEdge(clientX, clientY))
        ) {
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
      setFreeze(spreadsheet.getFreezePane());

      const range = spreadsheet.getSelectionRangeOrActiveCell();
      setCellSpan(
        range
          ? {
              top: Math.min(range[0].r, range[1].r),
              bottom: Math.max(range[0].r, range[1].r),
              left: Math.min(range[0].c, range[1].c),
              right: Math.max(range[0].c, range[1].c),
            }
          : null,
      );

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
      // Radix leaves our own `onContextMenu` wired on a disabled trigger (it
      // only drops its own, to let the native menu through), and this one
      // moves the LIVE selection — which republishes presence from a
      // document the user is no longer looking at.
      if (disabled) return;
      updateMenuState(e.clientX, e.clientY);
    },
    [spreadsheet, disabled, updateMenuState],
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

  // The cell menu's structural edits run the same `Spreadsheet` operations
  // the header menu reaches through `onInsertBefore` & co.; they only differ
  // in where the span comes from — a cell range rather than whole headers.
  const handleCellInsertRows = useCallback(
    async (where: "above" | "below") => {
      if (!spreadsheet || !cellSpan) return;
      await spreadsheet.insertRows(
        where === "above" ? cellSpan.top : cellSpan.bottom + 1,
        cellSpan.bottom - cellSpan.top + 1,
      );
    },
    [spreadsheet, cellSpan],
  );

  const handleCellInsertColumns = useCallback(
    async (where: "left" | "right") => {
      if (!spreadsheet || !cellSpan) return;
      await spreadsheet.insertColumns(
        where === "left" ? cellSpan.left : cellSpan.right + 1,
        cellSpan.right - cellSpan.left + 1,
      );
    },
    [spreadsheet, cellSpan],
  );

  const handleCellDeleteRows = useCallback(async () => {
    if (!spreadsheet || !cellSpan) return;
    await spreadsheet.deleteRows(
      cellSpan.top,
      cellSpan.bottom - cellSpan.top + 1,
    );
  }, [spreadsheet, cellSpan]);

  const handleCellDeleteColumns = useCallback(async () => {
    if (!spreadsheet || !cellSpan) return;
    await spreadsheet.deleteColumns(
      cellSpan.left,
      cellSpan.right - cellSpan.left + 1,
    );
  }, [spreadsheet, cellSpan]);

  // Freezing goes through `setFreezePane`, the same single store write the
  // corner drag handle makes, so it is one undo step. Only the axis the menu
  // was opened on changes; the other keeps its current boundary. That
  // boundary is read at click time, not from the snapshot taken when the menu
  // opened: `setFreezePane` writes both axes, so a stale value would revert a
  // change a collaborator made to the other axis while the menu was open.
  const handleFreeze = useCallback(
    async (line: number) => {
      if (!spreadsheet) return;
      const current = spreadsheet.getFreezePane();
      if (menuType === "row") {
        await spreadsheet.setFreezePane(line, current.frozenCols);
      } else if (menuType === "column") {
        await spreadsheet.setFreezePane(current.frozenRows, line);
      }
    },
    [spreadsheet, menuType],
  );

  const structuralDisabled = readOnly || structureLocked;

  const cellRows = cellSpan ? cellSpan.bottom - cellSpan.top + 1 : 1;
  const cellCols = cellSpan ? cellSpan.right - cellSpan.left + 1 : 1;
  const cellRowLabel = cellRows > 1 ? `${cellRows} rows` : "row";
  const cellColLabel = cellCols > 1 ? `${cellCols} columns` : "column";

  const count =
    selectionInfo && menuType === selectionInfo.axis
      ? selectionInfo.to - selectionInfo.from + 1
      : 1;

  const rowLabel = count > 1 ? `${count} rows` : "row";
  const colLabel = count > 1 ? `${count} columns` : "column";

  // "Freeze up to row N" freezes through the last header of the selection.
  // Past `MaxSnappedFreeze` the model refuses the boundary (see `merging.ts`),
  // so the item is withheld rather than offered and then undone.
  const freezeLine =
    selectionInfo && menuType === selectionInfo.axis ? selectionInfo.to : 0;
  const currentFreeze =
    menuType === "row" ? freeze.frozenRows : freeze.frozenCols;
  const canFreeze =
    freezeLine > 0 &&
    freezeLine <= MaxSnappedFreeze &&
    freezeLine !== currentFreeze;

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
      <ContextMenuTrigger
        asChild
        disabled={disabled}
        onContextMenu={handleContextMenu}
      >
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
              <IconTrash size={16} /> Delete values
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={structuralDisabled}
              onSelect={() => handleCellInsertRows("above")}
            >
              <IconRowInsertTop size={16} /> Insert {cellRowLabel} above
            </ContextMenuItem>
            <ContextMenuItem
              disabled={structuralDisabled}
              onSelect={() => handleCellInsertRows("below")}
            >
              <IconRowInsertBottom size={16} /> Insert {cellRowLabel} below
            </ContextMenuItem>
            <ContextMenuItem
              disabled={structuralDisabled}
              onSelect={() => handleCellInsertColumns("left")}
            >
              <IconColumnInsertLeft size={16} /> Insert {cellColLabel} left
            </ContextMenuItem>
            <ContextMenuItem
              disabled={structuralDisabled}
              onSelect={() => handleCellInsertColumns("right")}
            >
              <IconColumnInsertRight size={16} /> Insert {cellColLabel} right
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={structuralDisabled}
              onSelect={handleCellDeleteRows}
            >
              <IconTrash size={16} /> Delete {cellRowLabel}
            </ContextMenuItem>
            <ContextMenuItem
              disabled={structuralDisabled}
              onSelect={handleCellDeleteColumns}
            >
              <IconTrash size={16} /> Delete {cellColLabel}
            </ContextMenuItem>
            {(onInsertComment || onSendToChat) && <ContextMenuSeparator />}
            {onInsertComment && (
              <ContextMenuItem disabled={readOnly} onSelect={onInsertComment}>
                <IconMessage size={16} /> Insert comment
                <span className="ml-auto text-xs text-muted-foreground">
                  {navigator.platform.startsWith("Mac") ? "⌘+⌥+M" : "Ctrl+Alt+M"}
                </span>
              </ContextMenuItem>
            )}
            {onSendToChat && (
              <ContextMenuItem onSelect={onSendToChat}>
                <IconMessages size={16} /> Send to chat
              </ContextMenuItem>
            )}
            {onOpenDataValidation && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  disabled={readOnly}
                  onSelect={onOpenDataValidation}
                >
                  <IconListCheck size={16} /> Data validation
                </ContextMenuItem>
              </>
            )}
            {onInsertPivotTable && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem disabled={readOnly} onSelect={onInsertPivotTable}>
                  <IconLayoutRows size={16} /> Insert pivot table
                </ContextMenuItem>
              </>
            )}
            {selectedImageId && onDeleteImage && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem disabled={readOnly} onSelect={onDeleteImage}>
                  <IconTrash size={16} /> Delete image
                </ContextMenuItem>
              </>
            )}
          </>
        )}
        {menuType === "row" && (
          <>
            <ContextMenuItem disabled={structuralDisabled} onSelect={onInsertBefore}>
              <IconRowInsertTop size={16} /> Insert {rowLabel} above
            </ContextMenuItem>
            <ContextMenuItem disabled={structuralDisabled} onSelect={onInsertAfter}>
              <IconRowInsertBottom size={16} /> Insert {rowLabel} below
            </ContextMenuItem>
            <ContextMenuItem disabled={structuralDisabled} onSelect={onDeleteRowCol}>
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
            {(canFreeze || currentFreeze > 0) && <ContextMenuSeparator />}
            {canFreeze && (
              <ContextMenuItem
                disabled={readOnly}
                onSelect={() => handleFreeze(freezeLine)}
              >
                <IconSnowflake size={16} /> Freeze up to row {freezeLine}
              </ContextMenuItem>
            )}
            {currentFreeze > 0 && (
              <ContextMenuItem
                disabled={readOnly}
                onSelect={() => handleFreeze(0)}
              >
                <IconSnowflakeOff size={16} /> Unfreeze rows
              </ContextMenuItem>
            )}
          </>
        )}
        {menuType === "column" && (
          <>
            <ContextMenuItem disabled={structuralDisabled} onSelect={onInsertBefore}>
              <IconColumnInsertLeft size={16} /> Insert {colLabel} left
            </ContextMenuItem>
            <ContextMenuItem disabled={structuralDisabled} onSelect={onInsertAfter}>
              <IconColumnInsertRight size={16} /> Insert {colLabel} right
            </ContextMenuItem>
            <ContextMenuItem disabled={structuralDisabled} onSelect={onDeleteRowCol}>
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
            {(canFreeze || currentFreeze > 0) && <ContextMenuSeparator />}
            {canFreeze && (
              <ContextMenuItem
                disabled={readOnly}
                onSelect={() => handleFreeze(freezeLine)}
              >
                <IconSnowflake size={16} /> Freeze up to column {toColumnLabel(freezeLine)}
              </ContextMenuItem>
            )}
            {currentFreeze > 0 && (
              <ContextMenuItem
                disabled={readOnly}
                onSelect={() => handleFreeze(0)}
              >
                <IconSnowflakeOff size={16} /> Unfreeze columns
              </ContextMenuItem>
            )}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
