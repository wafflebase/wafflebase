/**
 * Parse CSV text into a 2D array of strings.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let current = '';
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(current);
      current = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') {
        i++;
      }
      row.push(current);
      current = '';
      if (row.length > 0) rows.push(row);
      row = [];
    } else {
      current += ch;
    }
  }
  // last field/row
  row.push(current);
  if (row.some((cell) => cell !== '')) rows.push(row);

  return rows;
}

/**
 * Convert a 1-based column number to a column label (1→A, 2→B, 27→AA).
 */
export function toColumnLabel(col: number): string {
  let label = '';
  while (col > 0) {
    const rem = col % 26;
    if (rem === 0) {
      label = 'Z' + label;
      col = Math.floor(col / 26) - 1;
    } else {
      label = String.fromCharCode(rem + 64) + label;
      col = Math.floor(col / 26);
    }
  }
  return label;
}

/**
 * Parse a cell reference like "A1" into 1-based row and column numbers.
 */
export function parseStartRef(ref: string): { row: number; col: number } {
  const match = ref.match(/^([A-Z]+)(\d+)$/i);
  if (!match) return { row: 1, col: 1 };
  const letters = match[1].toUpperCase();
  let col = 0;
  for (const ch of letters) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  return { row: parseInt(match[2], 10), col };
}

/**
 * Build a cell map from a 2D array for batch API.
 */
export function buildCellMap(
  data: string[][],
  startRow: number,
  startCol: number,
): Record<string, { value: string }> {
  const cells: Record<string, { value: string }> = {};
  for (let r = 0; r < data.length; r++) {
    for (let c = 0; c < data[r].length; c++) {
      const value = data[r][c];
      if (value === '') continue;
      const ref = toColumnLabel(startCol + c) + (startRow + r);
      cells[ref] = { value };
    }
  }
  return cells;
}
