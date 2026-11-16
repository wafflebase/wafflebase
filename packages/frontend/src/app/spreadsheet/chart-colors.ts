export const COLOR_PALETTES: Record<string, string[]> = {
  // The design system's categorical series (DESIGN.md `chart-1`…`chart-5`):
  // syrup, denim, teal, rose, olive gold, each with a lifted dark-mode stop
  // and ≥3:1 on the background. The default used to be five tints of the one
  // syrup accent, which read as orange / brick / salmon and could not be told
  // apart in a legend.
  default: [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
  ],
  warm: ["#e76f51", "#f4a261", "#e9c46a", "#d4a373", "#c97c5d"],
  cool: ["#264653", "#2a9d8f", "#457b9d", "#6a8caf", "#84a9c4"],
};

export function getSeriesColor(index: number, palette?: string): string {
  const colors = COLOR_PALETTES[palette ?? "default"] ?? COLOR_PALETTES.default;
  return colors[index % colors.length];
}
