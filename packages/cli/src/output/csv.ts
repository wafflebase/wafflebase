/**
 * Format an array of objects as CSV.
 */
export function formatCsv(data: unknown): string {
  if (!Array.isArray(data) || data.length === 0) return '';

  const rows = data as Record<string, unknown>[];
  const keys = Object.keys(rows[0]);

  const escape = (val: unknown): string => {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const header = keys.map(escape).join(',');
  const lines = rows.map((row) => keys.map((k) => escape(row[k])).join(','));

  return [header, ...lines].join('\n');
}
