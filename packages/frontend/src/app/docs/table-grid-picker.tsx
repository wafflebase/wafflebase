import { useState, useCallback, useRef } from "react";

interface TableGridPickerProps {
  onSelect: (rows: number, cols: number) => void;
}

const GRID_SIZE = 10;
const CELL_SIZE = 20;
const CELL_GAP = 2;
const TOTAL_SIZE = GRID_SIZE * CELL_SIZE + (GRID_SIZE - 1) * CELL_GAP;

export function TableGridPicker({ onSelect }: TableGridPickerProps) {
  const [hoverRow, setHoverRow] = useState(-1);
  const [hoverCol, setHoverCol] = useState(-1);
  const gridRef = useRef<HTMLDivElement>(null);

  const resolveCell = useCallback(
    (e: React.MouseEvent) => {
      const grid = gridRef.current;
      if (!grid) return { row: -1, col: -1 };
      const rect = grid.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const step = CELL_SIZE + CELL_GAP;
      const col = Math.min(Math.floor(x / step), GRID_SIZE - 1);
      const row = Math.min(Math.floor(y / step), GRID_SIZE - 1);
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

  return (
    <div className="p-2">
      <div
        ref={gridRef}
        style={{ width: TOTAL_SIZE, height: TOTAL_SIZE, position: "relative" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      >
        {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, i) => {
          const row = Math.floor(i / GRID_SIZE);
          const col = i % GRID_SIZE;
          const isHighlighted = row <= hoverRow && col <= hoverCol;
          const step = CELL_SIZE + CELL_GAP;
          return (
            <div
              key={i}
              className={`absolute rounded-sm border transition-colors ${
                isHighlighted
                  ? "bg-primary/20 border-primary"
                  : "bg-background border-border"
              }`}
              style={{
                width: CELL_SIZE,
                height: CELL_SIZE,
                left: col * step,
                top: row * step,
              }}
            />
          );
        })}
      </div>
      <div className="mt-2 text-center text-xs text-muted-foreground">
        {hoverRow >= 0 && hoverCol >= 0
          ? `${hoverRow + 1} x ${hoverCol + 1}`
          : "Insert table"}
      </div>
    </div>
  );
}
