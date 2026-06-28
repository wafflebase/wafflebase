/**
 * NoneSwatch — the shared "no color / transparent" visual: a white square
 * crossed by a red diagonal, matching the convention used by Google
 * Slides / Sheets / Docs for "No fill" / "None".
 *
 * Presentational only — callers wrap it in the interactive control (button)
 * and own the accessible label. Sized to match the 20×20 color swatches.
 */
interface NoneSwatchProps {
  /** Draw the active selection ring (current value is "none"). */
  selected?: boolean;
  className?: string;
}

export function NoneSwatch({ selected = false, className }: NoneSwatchProps) {
  return (
    <span
      data-testid="none-swatch"
      aria-hidden="true"
      className={`relative inline-block h-5 w-5 shrink-0 overflow-hidden rounded-sm border bg-white ${
        selected ? "border-foreground ring-2 ring-ring/50" : "border-border"
      } ${className ?? ""}`}
    >
      {/* Red diagonal from bottom-left to top-right. The red is an
          intentionally theme-independent literal: the red "no fill" slash is
          a fixed iconographic convention (Google / Office use the same red in
          light and dark), so it is deliberately NOT a themeable token. */}
      <svg
        viewBox="0 0 20 20"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="none"
      >
        <line x1="2" y1="18" x2="18" y2="2" stroke="#EA4335" strokeWidth="1.5" />
      </svg>
    </span>
  );
}
