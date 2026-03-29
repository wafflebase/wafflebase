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

  const handleMouseLeave = useCallback(() => {
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
        style={{ width: gridW, height: gridH, position: "relative" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
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
