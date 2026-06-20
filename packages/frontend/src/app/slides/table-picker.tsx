import { useRef, useState } from 'react';
import { IconTable } from '@tabler/icons-react';
import type { SlidesEditor } from '@wafflebase/slides';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';

const PICKER_MAX_ROWS = 8;
const PICKER_MAX_COLS = 8;
const CELL_PX = 18;
const CELL_GAP_PX = 2;

interface TablePickerProps {
  editor: SlidesEditor | null;
  disabled?: boolean;
}

/**
 * Insert-table button with a Google-Slides-style grid picker. Hover
 * over the cell grid to set the desired `rows × cols`; click to
 * commit. Inserts a default-sized table centered on the current
 * slide via `editor.insertTable(rows, cols)`.
 *
 * Picker grid is fixed at 8x8 — covers the typical use case
 * (>95% of tables in real decks are <= 6 cols × 6 rows). Larger
 * tables can be built incrementally via the right-click "Insert
 * row / column" context menu after the initial insert.
 */
export function TablePicker({ editor, disabled }: TablePickerProps) {
  const [open, setOpen] = useState(false);
  // Hover position drives the highlight extent: cell (r, c) is
  // highlighted when r <= hoverRow && c <= hoverCol. -1 means "no
  // selection yet" so the legend reads `0 × 0`.
  const [hoverRow, setHoverRow] = useState(-1);
  const [hoverCol, setHoverCol] = useState(-1);
  const gridRef = useRef<HTMLDivElement>(null);

  const commit = (rows: number, cols: number): void => {
    if (!editor || rows < 1 || cols < 1) return;
    editor.insertTable(rows, cols);
    setOpen(false);
    setHoverRow(-1);
    setHoverCol(-1);
  };

  const rowsLabel = hoverRow + 1;
  const colsLabel = hoverCol + 1;

  const handleGridKeyDown = (e: React.KeyboardEvent): void => {
    const clampRow = (n: number) =>
      Math.max(0, Math.min(n, PICKER_MAX_ROWS - 1));
    const clampCol = (n: number) =>
      Math.max(0, Math.min(n, PICKER_MAX_COLS - 1));
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        e.stopPropagation();
        setHoverCol((c) => clampCol((c < 0 ? -1 : c) + 1));
        if (hoverRow < 0) setHoverRow(0);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        e.stopPropagation();
        setHoverCol((c) => clampCol(c - 1));
        break;
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        setHoverRow((r) => clampRow((r < 0 ? -1 : r) + 1));
        if (hoverCol < 0) setHoverCol(0);
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        setHoverRow((r) => clampRow(r - 1));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        e.stopPropagation();
        if (hoverRow >= 0 && hoverCol >= 0) commit(hoverRow + 1, hoverCol + 1);
        break;
    }
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setHoverRow(-1);
          setHoverCol(-1);
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={disabled || !editor}
              aria-label="Insert table"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            >
              <IconTable size={16} />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Insert table</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="start"
        className="flex flex-col gap-1 p-2"
        // Radix focuses the menu content container on open; redirect
        // focus to the grid so its arrow-key handler is reachable.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          gridRef.current?.focus();
        }}
        onMouseLeave={() => {
          setHoverRow(-1);
          setHoverCol(-1);
        }}
      >
        <div
          ref={gridRef}
          role="grid"
          tabIndex={0}
          aria-label={
            hoverRow >= 0 && hoverCol >= 0
              ? `Insert ${rowsLabel} by ${colsLabel} table`
              : 'Insert table, use arrow keys to size'
          }
          onKeyDown={handleGridKeyDown}
          className="outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${PICKER_MAX_COLS}, ${CELL_PX}px)`,
            gridAutoRows: `${CELL_PX}px`,
            gap: `${CELL_GAP_PX}px`,
          }}
        >
          {Array.from({ length: PICKER_MAX_ROWS }).flatMap((_, r) =>
            Array.from({ length: PICKER_MAX_COLS }).map((_, c) => {
              const active = r <= hoverRow && c <= hoverCol;
              return (
                <div
                  key={`${r}-${c}`}
                  role="gridcell"
                  data-row={r + 1}
                  data-col={c + 1}
                  aria-selected={active}
                  onMouseEnter={() => {
                    setHoverRow(r);
                    setHoverCol(c);
                  }}
                  onClick={() => commit(r + 1, c + 1)}
                  className="cursor-pointer rounded-[2px] border"
                  style={{
                    background: active
                      ? 'rgba(26, 115, 232, 0.35)'
                      : 'transparent',
                    borderColor: active
                      ? 'rgba(26, 115, 232, 0.8)'
                      : 'rgba(120, 120, 120, 0.45)',
                  }}
                />
              );
            }),
          )}
        </div>
        <div className="text-center text-xs text-muted-foreground">
          {hoverRow < 0 || hoverCol < 0
            ? 'Hover to size'
            : `${rowsLabel} × ${colsLabel}`}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
