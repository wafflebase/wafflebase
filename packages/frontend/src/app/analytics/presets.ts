/**
 * Date-range presets for the analytics dashboards. The picker holds the preset
 * key (a stable string, safe as a react-query key); callers resolve it to
 * concrete `{ from, to }` dates at fetch time via `rangeForPreset`.
 */
export type RangePreset = "7" | "30" | "90" | "all";

export const DEFAULT_PRESET: RangePreset = "30";

export const PRESET_LABELS: Record<RangePreset, string> = {
  "7": "Last 7 days",
  "30": "Last 30 days",
  "90": "Last 90 days",
  all: "All time",
};

export const PRESET_ORDER: RangePreset[] = ["7", "30", "90", "all"];

/**
 * Resolve a preset to a `{ from, to }` window (YYYY-MM-DD). "All time" uses a
 * fixed early floor because the backend defaults a missing `from` to 30 days,
 * not to all-time.
 */
export function rangeForPreset(preset: RangePreset): {
  from?: string;
  to?: string;
} {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  if (preset === "all") return { from: "2020-01-01", to };
  const days = Number(preset);
  const from = new Date(now.getTime() - days * 86400000)
    .toISOString()
    .slice(0, 10);
  return { from, to };
}
