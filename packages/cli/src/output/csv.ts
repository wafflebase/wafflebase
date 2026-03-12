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
    const s =
      val !== null && typeof val === 'object'
        ? JSON.stringify(val)
        : String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const header = keys.map(csvEscape).join(',');
  const lines = rows.map((row) => keys.map((k) => csvEscape(row[k])).join(','));

  return [header, ...lines].join('\n');
}
