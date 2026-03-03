export const COLOR_PALETTES: Record<string, string[]> = {
  default: [
    "var(--color-primary)",
    "color-mix(in oklch, var(--color-primary) 78%, var(--color-background))",
    "color-mix(in oklch, var(--color-primary) 68%, var(--color-foreground))",
    "color-mix(in oklch, var(--color-primary) 56%, var(--color-background))",
    "color-mix(in oklch, var(--color-primary) 46%, var(--color-foreground))",
  ],
  warm: ["#e76f51", "#f4a261", "#e9c46a", "#d4a373", "#c97c5d"],
  cool: ["#264653", "#2a9d8f", "#457b9d", "#6a8caf", "#84a9c4"],
};

export function getSeriesColor(index: number, palette?: string): string {
  const colors = COLOR_PALETTES[palette ?? "default"] ?? COLOR_PALETTES.default;
  return colors[index % colors.length];
}
