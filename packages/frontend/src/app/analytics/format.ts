/** Shared formatting helpers for the analytics dashboards. */

/**
 * Format a dwell duration (seconds) as `2m 03s`, or `43s` under a minute.
 * Negative/NaN inputs clamp to `0s`.
 */
export function formatDwell(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
}

/**
 * Returning visitors as a percentage of unique visitors, e.g. `40%`. Guards
 * against a zero denominator (no unique visitors yet).
 */
export function returningRate(returning: number, unique: number): string {
  if (!unique || unique <= 0) return "0%";
  return `${Math.round((returning / unique) * 100)}%`;
}
