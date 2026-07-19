import { cn } from "@/lib/utils";

interface ColorSwatchProps {
  /** CSS color painted into the swatch (hex, `var(--…)`, theme color, …). */
  color: string;
  /** Accessible label, e.g. the hex value or a theme-role name. */
  label: string;
  onClick: () => void;
  /**
   * Whether this swatch is the currently-applied color. Adds the
   * ring/emphasis marker + `aria-pressed`. Leave it `undefined` for grids
   * that don't track a current value (e.g. the plain Docs/Sheets picker) —
   * `aria-pressed` is then omitted so the swatch reads as a plain button
   * rather than an always-unpressed toggle.
   */
  selected?: boolean;
  /** Native tooltip (usually the hex value). */
  title?: string;
}

/**
 * A single color swatch button — the one place the swatch look (size,
 * radius, hover-zoom, selected ring) is defined, shared by the plain
 * `ColorPickerGrid` (Docs / Sheets) and the Slides `ThemedColorPicker`
 * so every swatch grid across the app renders identically.
 */
export function ColorSwatch({
  color,
  label,
  onClick,
  selected,
  title,
}: ColorSwatchProps) {
  return (
    <button
      type="button"
      aria-label={label}
      // Omitted (not `false`) when the grid doesn't track selection, so
      // untracked swatches read as plain buttons, not unpressed toggles.
      aria-pressed={selected}
      title={title ?? label}
      onClick={onClick}
      className={cn(
        "h-5 w-5 cursor-pointer rounded-sm border transition-transform hover:scale-125",
        selected ? "border-foreground ring-2 ring-ring/50" : "border-border",
      )}
      style={{ backgroundColor: color }}
    />
  );
}
