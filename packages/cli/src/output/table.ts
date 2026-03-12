/**
 * Format an array of objects as an aligned text table.
 */
export function formatTable(data: unknown): string {
  if (!Array.isArray(data) || data.length === 0) return '(no results)';

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
