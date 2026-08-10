/**
 * Leading characters a spreadsheet evaluates as a formula when the CSV
 * is opened (Excel / Sheets / LibreOffice). Tab and CR are included
 * because they let a payload hide behind whitespace the importer trims.
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/**
 * `-3`, `+1.5`, `-2e10` — a sign in front of a plain number is
 * arithmetic notation, not a formula, so those stay untouched.
 */
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Neutralize a spreadsheet formula prefix by quoting the value as text.
 *
 * Every value the CSV writer emits is server-supplied — document
 * titles, cell values/formulas, workspace names — and in a shared
 * workspace another member can set them. Without this, a cell holding
 * `=HYPERLINK("http://evil","click")` or `@SUM(...)` executes the
 * moment someone opens the exported file in a spreadsheet app.
 */
function neutralizeFormula(s: string): string {
  if (!FORMULA_TRIGGER.test(s) || PLAIN_NUMBER.test(s)) return s;
  return `'${s}`;
}

/**
 * Format data as CSV. Accepts arrays or single objects.
 */
export function formatCsv(data: unknown): string {
  const rows =
    Array.isArray(data)
      ? (data as Record<string, unknown>[])
      : data !== null && typeof data === 'object'
        ? [data as Record<string, unknown>]
        : [];
  if (rows.length === 0) return '';

  const keys = Object.keys(rows[0]);

  const csvEscape = (val: unknown): string => {
    const s = neutralizeFormula(
      val !== null && typeof val === 'object'
        ? JSON.stringify(val)
        : String(val ?? ''),
    );
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const header = keys.map(csvEscape).join(',');
  const lines = rows.map((row) => keys.map((k) => csvEscape(row[k])).join(','));

  return [header, ...lines].join('\n');
}
