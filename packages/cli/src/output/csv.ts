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
 * A value has to be quoted when it carries the delimiter, a quote, or
 * any record-terminating control character. `\r` matters as much as
 * `\n`: importers that honour a bare CR as a record terminator (classic
 * Mac line endings — Excel and LibreOffice both do) split the line
 * there, and whatever follows starts a fresh record at column 0. Left
 * unquoted, `ok\r=HYPERLINK(...)` therefore smuggles a formula past
 * `neutralizeFormula`, which only ever inspects the *start* of a value.
 * `\t` is quoted for the same reason in tab-oriented importers.
 */
const NEEDS_QUOTING = /[",\n\r\t]/;

export interface CsvOptions {
  /**
   * Prefix values a spreadsheet would evaluate with `'` so they land as
   * text (see `neutralizeFormula`).
   *
   * Required rather than defaulted: `formatCsv` serves both a human
   * render path (`--format csv`, where an opened file must not execute)
   * and a data-interchange path (`sheets export --file-format csv`,
   * whose output is re-imported by `sheets import` and must stay
   * byte-faithful). The two want opposite answers, and a default would
   * silently pick one for the next call site added.
   */
  neutralizeFormulas: boolean;
}

/**
 * Format data as CSV. Accepts arrays or single objects.
 */
export function formatCsv(data: unknown, options: CsvOptions): string {
  const rows =
    Array.isArray(data)
      ? (data as Record<string, unknown>[])
      : data !== null && typeof data === 'object'
        ? [data as Record<string, unknown>]
        : [];
  if (rows.length === 0) return '';

  const keys = Object.keys(rows[0]);

  const csvEscape = (val: unknown): string => {
    const raw =
      val !== null && typeof val === 'object'
        ? JSON.stringify(val)
        : String(val ?? '');
    const s = options.neutralizeFormulas ? neutralizeFormula(raw) : raw;
    if (NEEDS_QUOTING.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const header = keys.map(csvEscape).join(',');
  const lines = rows.map((row) => keys.map((k) => csvEscape(row[k])).join(','));

  return [header, ...lines].join('\n');
}
