/**
 * Format a single object as an aligned two-column key/value table.
 * Single-record commands (`status`, `docs get`) are the human-readable
 * path now that JSON is the default, and a one-row-per-field layout
 * reads better there than a very wide single row.
 */
function formatRecord(record: Record<string, unknown>): string {
  const keys = Object.keys(record);
  if (keys.length === 0) return '(no results)';

  const width = Math.max(...keys.map((k) => k.length));
  return keys
    .map((k) => `${k.padEnd(width)}  ${String(record[k] ?? '')}`)
    .join('\n');
}

/**
 * Format an array of objects as an aligned text table. A single
 * non-array object is rendered as a key/value table instead.
 */
export function formatTable(data: unknown): string {
  if (!Array.isArray(data)) {
    if (data !== null && typeof data === 'object') {
      return formatRecord(data as Record<string, unknown>);
    }
    return '(no results)';
  }
  if (data.length === 0) return '(no results)';

  const rows = data as Record<string, unknown>[];
  const keys = Object.keys(rows[0]);

  const widths = keys.map((key) =>
    Math.max(
      key.length,
      ...rows.map((row) => String(row[key] ?? '').length),
    ),
  );

  const header = keys.map((k, i) => k.padEnd(widths[i])).join('  ');
  const separator = widths.map((w) => '-'.repeat(w)).join('  ');
  const lines = rows.map((row) =>
    keys.map((k, i) => String(row[k] ?? '').padEnd(widths[i])).join('  '),
  );

  return [header, separator, ...lines].join('\n');
}
