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

/** What the batch cells API accepts for one reference. */
export type CellPatch = { value?: string; formula?: string };

/**
 * A cell whose text is a formula has to be sent as `formula`, not as
 * `value` — the batch API stores the two in different fields (`f` vs
 * `v`), and a `=SUM(B2:B100)` sent as a value lands as the literal
 * string, never evaluated. That is what `sheets export --raw` exists
 * for: it writes the formula text unguarded *so that this import turns
 * it back into a formula*.
 */
function toCellPatch(text: string): CellPatch {
  return text.startsWith('=') ? { formula: text } : { value: text };
}

/**
 * Header of the table `sheets export` writes: one row per cell, not a
 * grid. Recognised so that an exported file re-imports as the sheet it
 * came from instead of as a 4-column grid of the words `ref`, `value`,
 * `formula` and `style`.
 */
const CELL_TABLE_HEADER = ['ref', 'value', 'formula'];

/** Does this CSV carry `sheets export`'s `ref,value,formula[,style]` header? */
export function isCellTable(data: string[][]): boolean {
  if (data.length === 0) return false;
  const header = data[0].map((h) => h.trim().toLowerCase());
  return CELL_TABLE_HEADER.every((name, i) => header[i] === name);
}

/**
 * Build a cell map from `sheets export`'s per-cell table. `ref` is
 * authoritative, so `--start` does not apply and the sheet lands where
 * it was exported from.
 */
export function buildCellMapFromTable(
  data: string[][],
): Record<string, CellPatch> {
  const cells: Record<string, CellPatch> = {};
  for (const row of data.slice(1)) {
    const ref = (row[0] ?? '').trim().toUpperCase();
    if (!/^[A-Z]+\d+$/.test(ref)) continue;
    const value = row[1] ?? '';
    const formula = row[2] ?? '';
    // A formula cell exports both its formula and its last computed
    // value; only the formula is re-sent, so the server recomputes
    // rather than being handed a stale answer.
    if (formula !== '') {
      cells[ref] = { formula };
    } else if (value !== '') {
      cells[ref] = toCellPatch(value);
    }
  }
  return cells;
}

/**
 * Build a cell map from a 2D array for batch API.
 */
export function buildCellMap(
  data: string[][],
  startRow: number,
  startCol: number,
): Record<string, CellPatch> {
  const cells: Record<string, CellPatch> = {};
  for (let r = 0; r < data.length; r++) {
    for (let c = 0; c < data[r].length; c++) {
      const value = data[r][c];
      if (value === '') continue;
      const ref = toColumnLabel(startCol + c) + (startRow + r);
      cells[ref] = toCellPatch(value);
    }
  }
  return cells;
}
