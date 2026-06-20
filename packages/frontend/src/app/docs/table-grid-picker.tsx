import { useState, useCallback, useRef } from "react";

interface TableGridPickerProps {
  onSelect: (rows: number, cols: number) => void;
}

const MIN_SIZE = 5;
const MAX_SIZE = 10;
const CELL_SIZE = 20;
const CELL_GAP = 2;
const STEP = CELL_SIZE + CELL_GAP;

/** Expand the visible grid 1 beyond the hovered cell, clamped to [MIN, MAX]. */
function visibleSize(hover: number): number {
  return Math.max(MIN_SIZE, Math.min(hover + 2, MAX_SIZE));
}

export function TableGridPicker({ onSelect }: TableGridPickerProps) {
  const [hoverRow, setHoverRow] = useState(-1);
  const [hoverCol, setHoverCol] = useState(-1);
  const gridRef = useRef<HTMLDivElement>(null);

  const rows = visibleSize(hoverRow);
  const cols = visibleSize(hoverCol);
  const gridW = cols * CELL_SIZE + (cols - 1) * CELL_GAP;
  const gridH = rows * CELL_SIZE + (rows - 1) * CELL_GAP;

  const resolveCell = useCallback(
    (e: React.MouseEvent) => {
      const grid = gridRef.current;
      if (!grid) return { row: -1, col: -1 };
      const rect = grid.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const col = Math.min(Math.floor(x / STEP), MAX_SIZE - 1);
      const row = Math.min(Math.floor(y / STEP), MAX_SIZE - 1);
      return { row: Math.max(0, row), col: Math.max(0, col) };
    },
    [],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const { row, col } = resolveCell(e);
      setHoverRow(row);
      setHoverCol(col);
    },
    [resolveCell],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const { row, col } = resolveCell(e);
      if (row >= 0 && col >= 0) {
        onSelect(row + 1, col + 1);
      }
    },
    [resolveCell, onSelect],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const clamp = (n: number) => Math.max(0, Math.min(n, MAX_SIZE - 1));
      // stopPropagation on handled keys so the enclosing Radix menu's
      // arrow-key navigation doesn't also fire and steal focus.
      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          e.stopPropagation();
          setHoverCol((c) => clamp((c < 0 ? -1 : c) + 1));
          if (hoverRow < 0) setHoverRow(0);
          break;
        case "ArrowLeft":
          e.preventDefault();
          e.stopPropagation();
          setHoverCol((c) => clamp(c - 1));
          break;
        case "ArrowDown":
          e.preventDefault();
          e.stopPropagation();
          setHoverRow((r) => clamp((r < 0 ? -1 : r) + 1));
          if (hoverCol < 0) setHoverCol(0);
          break;
        case "ArrowUp":
          e.preventDefault();
          e.stopPropagation();
          setHoverRow((r) => clamp(r - 1));
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          e.stopPropagation();
          if (hoverRow >= 0 && hoverCol >= 0) {
            onSelect(hoverRow + 1, hoverCol + 1);
          }
          break;
      }
    },
    [hoverRow, hoverCol, onSelect],
  );

  const handleMouseLeave = useCallback((e: React.MouseEvent) => {
    const grid = gridRef.current;
    if (grid) {
      const rect = grid.getBoundingClientRect();
      const exitedRight = e.clientX >= rect.right;
      const exitedBottom = e.clientY >= rect.bottom;
      if (exitedRight || exitedBottom) {
        setHoverCol((prev) => (exitedRight ? MAX_SIZE - 1 : prev));
        setHoverRow((prev) => (exitedBottom ? MAX_SIZE - 1 : prev));
        return;
      }
    }
    setHoverRow(-1);
    setHoverCol(-1);
  }, []);

  const cells: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const isHighlighted = r <= hoverRow && c <= hoverCol;
      cells.push(
        <div
          key={`${r}-${c}`}
          className={`absolute rounded-sm border transition-colors ${
            isHighlighted
              ? "bg-primary/20 border-primary"
              : "bg-background border-border"
          }`}
          style={{
            width: CELL_SIZE,
            height: CELL_SIZE,
            left: c * STEP,
            top: r * STEP,
          }}
        />,
      );
    }
  }

  return (
    <div className="p-2">
      <div
        ref={gridRef}
        role="grid"
        tabIndex={0}
        aria-label={
          hoverRow >= 0 && hoverCol >= 0
            ? `Insert ${hoverRow + 1} by ${hoverCol + 1} table`
            : "Insert table, use arrow keys to size"
        }
        className="outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        style={{ width: gridW, height: gridH, position: "relative" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        {cells}
      </div>
      <div className="mt-2 text-center text-xs text-muted-foreground">
        {hoverRow >= 0 && hoverCol >= 0
          ? `${hoverRow + 1} x ${hoverCol + 1}`
          : "Insert table"}
      </div>
    </div>
  );
}
