import type { MetricSeriesPoint } from "@/api/analytics";

/**
 * Fill missing calendar days between the first and last point with zeros.
 *
 * The warehouse `viewsByDay` query does `GROUP BY DATE(timestamp)` and only
 * returns days that had events, so the series is sparse. Feeding that straight
 * to a category-axis chart collapses quiet gaps into a single sloped line,
 * making a period of no views look like steady activity. Densifying to one
 * point per day renders the gaps honestly as troughs at zero.
 *
 * Dates are treated as UTC calendar days (matching the UTC-bucketed warehouse).
 */
export function densifyDaily(points: MetricSeriesPoint[]): MetricSeriesPoint[] {
  if (points.length < 2) return points;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(sorted.map((p) => [p.date, p.value]));
  const cursor = new Date(`${sorted[0].date}T00:00:00Z`);
  const end = new Date(`${sorted[sorted.length - 1].date}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) {
    return sorted; // malformed dates: don't attempt to walk the range
  }
  const out: MetricSeriesPoint[] = [];
  // Safety cap (~11 years) so a bad range can never spin forever.
  for (let i = 0; cursor <= end && i < 4096; i++) {
    const date = cursor.toISOString().slice(0, 10);
    out.push({ date, value: byDate.get(date) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}
