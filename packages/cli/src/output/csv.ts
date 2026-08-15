/**
 * Leading characters a spreadsheet evaluates as a formula when the CSV
 * is opened (Excel / Sheets / LibreOffice).
 */
const FORMULA_TRIGGER = /^[=+\-@]/;

/**
 * Whitespace an importer may strip before deciding what a value is —
 * which is what lets a payload hide behind it. A plain space counts as
 * much as a tab or a CR: LibreOffice's "Trim spaces" import option (and
 * several third-party CSV-to-sheet importers) drop it, and ` =HYPERLINK(…)`
 * then lands as a live formula. `\s` covers space, tab, CR, LF, form
 * feed, vertical tab and the Unicode spaces including U+00A0; the BOM is
 * added because it is not in `\s` and leads plenty of real files.
 */
const LEADING_WHITESPACE = /^[\s\ufeff]+/;

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
  // Decide on the value the importer will see, not on the bytes: a
  // leading space, tab, CR or BOM is stripped by importers that trim,
  // and `" =HYPERLINK(…)"` is a formula the moment it is.
  const trimmed = s.replace(LEADING_WHITESPACE, '');
  if (!FORMULA_TRIGGER.test(trimmed) || PLAIN_NUMBER.test(trimmed)) return s;
  // Prefix the original, whitespace and all — the `'` has to be the
  // first character of the field for the importer to read it as text.
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
   * and a data-interchange path (`sheets export --raw`, whose output is
   * re-imported by `sheets import` and must stay byte-faithful). Both
   * default to neutralizing — only an explicit `--raw` turns it off —
   * but the answer is per-call, and a default here would silently pick
   * one for the next call site added.
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
