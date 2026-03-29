import { useState, useCallback } from "react";

interface TableGridPickerProps {
  onSelect: (rows: number, cols: number) => void;
}

const GRID_SIZE = 10;
const CELL_SIZE = 20;
const CELL_GAP = 2;

export function TableGridPicker({ onSelect }: TableGridPickerProps) {
  const [hoverRow, setHoverRow] = useState(-1);
  const [hoverCol, setHoverCol] = useState(-1);

  const handleMouseLeave = useCallback(() => {
    setHoverRow(-1);
    setHoverCol(-1);
  }, []);

  return (
    <div className="p-2" onMouseLeave={handleMouseLeave}>
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${GRID_SIZE}, ${CELL_SIZE}px)`,
          gap: `${CELL_GAP}px`,
        }}
      >
        {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, i) => {
          const row = Math.floor(i / GRID_SIZE);
          const col = i % GRID_SIZE;
          const isHighlighted = row <= hoverRow && col <= hoverCol;
          return (
            <button
              key={i}
              className={`border rounded-sm transition-colors ${
                isHighlighted
                  ? "bg-primary/20 border-primary"
                  : "bg-background border-border hover:border-muted-foreground"
              }`}
              style={{ width: CELL_SIZE, height: CELL_SIZE }}
              onMouseEnter={() => {
                setHoverRow(row);
                setHoverCol(col);
              }}
              onClick={() => onSelect(row + 1, col + 1)}
              aria-label={`${row + 1} x ${col + 1} table`}
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
