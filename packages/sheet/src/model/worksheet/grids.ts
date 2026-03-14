import { parseRef, toSref } from '../core/coordinates';
import { Cell, CellStyle, Grid, Ref, Sref, TextAlign } from '../core/types';

/**
 * `quoteTsvField` wraps a field in double-quotes when it contains a tab,
 * newline, or double-quote character (RFC 4180 style quoting for TSV).
 */
function quoteTsvField(field: string): string {
  if (field.includes('\t') || field.includes('\n') || field.includes('"')) {
    return '"' + field.replace(/"/g, '""') + '"';
  }
  return field;
}

/**
 * `grid2string` converts the given grid to a string representation.
 */
export function grid2string(grid: Grid): string {
  let minRow = Infinity;
  let minCol = Infinity;
  let maxRow = 0;
  let maxCol = 0;

  for (const [sref] of grid.entries()) {
    const { r: row, c: col } = parseRef(sref);
    minRow = Math.min(minRow, row);
    minCol = Math.min(minCol, col);
    maxRow = Math.max(maxRow, row);
    maxCol = Math.max(maxCol, col);
  }

  const table: Array<Array<string>> = Array.from(
    { length: maxRow - minRow + 1 },
    () => Array(maxCol - minCol + 1).fill(''),
  );

  for (const [sref, value] of grid.entries()) {
    const { r: row, c: col } = parseRef(sref);
    table[row - minRow][col - minCol] = value.v || value.f || '';
  }

  return table.map((row) => row.map(quoteTsvField).join('\t')).join('\n');
}

/**
 * `parseTsvRows` splits a TSV string into rows and fields, respecting
 * double-quote quoting so that embedded tabs and newlines are preserved.
 */
function parseTsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;

  while (i <= text.length) {
    if (i === text.length) {
      rows.push(row);
      break;
    }

    if (text[i] === '"') {
      // Quoted field — collect until closing quote.
      let field = '';
      i++; // skip opening quote
      while (i < text.length) {
        if (text[i] === '"') {
          if (i + 1 < text.length && text[i + 1] === '"') {
            // Escaped double-quote
            field += '"';
            i += 2;
          } else {
            // Closing quote
            i++; // skip closing quote
            break;
          }
        } else {
          field += text[i];
          i++;
        }
      }
      row.push(field);
      // After the closing quote, expect tab, newline, or end of text.
      if (i < text.length && text[i] === '\t') {
        i++;
      } else if (i < text.length && text[i] === '\n') {
        rows.push(row);
        row = [];
        i++;
      }
    } else {
      // Unquoted field — read until tab or newline.
      let field = '';
      while (i < text.length && text[i] !== '\t' && text[i] !== '\n') {
        field += text[i];
        i++;
      }
      row.push(field);
      if (i < text.length && text[i] === '\t') {
        i++;
      } else if (i < text.length && text[i] === '\n') {
        rows.push(row);
        row = [];
        i++;
      }
    }
  }

  return rows;
}

/**
 * `string2grid` converts the given string to a grid representation.
 */
export function string2grid(ref: Ref, value: string): Grid {
  const grid = new Map<Sref, Cell>();
  const rows = parseTsvRows(value);

  for (let ri = 0; ri < rows.length; ri++) {
    for (let ci = 0; ci < rows[ri].length; ci++) {
      grid.set(toSref({ r: ref.r + ri, c: ref.c + ci }), {
        v: rows[ri][ci],
      });
    }
  }

  return grid;
}

/**
 * `cssColorToHex` converts a CSS `rgb(r,g,b)` string to a `#rrggbb` hex string.
 * Returns undefined for unrecognized formats.
 */
export function cssColorToHex(color: string): string | undefined {
  const m = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (!m) return undefined;
  const r = parseInt(m[1], 10);
  const g = parseInt(m[2], 10);
  const b = parseInt(m[3], 10);
  // Skip white / near-white backgrounds that are just default
  if (r === 255 && g === 255 && b === 255) return undefined;
  return (
    '#' +
    r.toString(16).padStart(2, '0') +
    g.toString(16).padStart(2, '0') +
    b.toString(16).padStart(2, '0')
  );
}

/**
 * `isSpreadsheetHtml` detects whether the HTML came from Google Sheets or Excel.
 */
export function isSpreadsheetHtml(html: string): boolean {
  return (
    html.includes('google-sheets-html-origin') ||
    html.includes('data-sheets-value') ||
    html.includes('urn:schemas-microsoft-com:office:excel') ||
    html.includes('xmlns:x="urn:schemas-microsoft-com:office:excel"')
  );
}

/**
 * `html2grid` parses an HTML `<table>` (from Google Sheets / Excel clipboard)
 * into a Grid positioned at `destRef`. Extracts basic styles.
 */
export function html2grid(html: string, destRef: Ref): Grid {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) {
    return new Map();
  }

  const grid: Grid = new Map();
  const rows = table.querySelectorAll('tr');
  for (let ri = 0; ri < rows.length; ri++) {
    const cells = rows[ri].querySelectorAll('td, th');
    for (let ci = 0; ci < cells.length; ci++) {
      const el = cells[ci] as HTMLElement;
      const text = el.textContent || '';
      if (!text && !el.style.cssText) continue;

      const cell: Cell = { v: text };
      const style: CellStyle = {};
      let hasStyle = false;

      // Bold
      const fw = el.style.fontWeight;
      if (fw === 'bold' || fw === '700') {
        style.b = true;
        hasStyle = true;
      }

      // Italic
      if (el.style.fontStyle === 'italic') {
        style.i = true;
        hasStyle = true;
      }

      // Background color
      if (el.style.backgroundColor) {
        const hex = cssColorToHex(el.style.backgroundColor);
        if (hex) {
          style.bg = hex;
          hasStyle = true;
        }
      }

      // Text color
      if (el.style.color) {
        const hex = cssColorToHex(el.style.color);
        if (hex) {
          style.tc = hex;
          hasStyle = true;
        }
      }

      // Text alignment
      if (el.style.textAlign) {
        const al = el.style.textAlign as TextAlign;
        if (al === 'left' || al === 'center' || al === 'right') {
          style.al = al;
          hasStyle = true;
        }
      }

      if (hasStyle) {
        cell.s = style;
      }

      grid.set(toSref({ r: destRef.r + ri, c: destRef.c + ci }), cell);
    }
  }

  return grid;
}
