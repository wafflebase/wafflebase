import { useId } from "react";
import type { Theme, ThemeColor } from "@wafflebase/slides";
import {
  PICKER_THEME_ROLES,
  isRoleSelected,
  makeRoleColor,
  makeSrgbColor,
} from "./themed-color-picker-helpers";
import { TEXT_COLORS } from "@/components/formatting-colors";

interface ThemedColorPickerProps {
  /**
   * Current value of the property being edited. Drives which swatch
   * shows the "active" marker. `undefined` for properties with no
   * explicit value.
   */
  value: ThemeColor | undefined;
  /** Active document theme; supplies the twelve role swatch colors. */
  theme: Theme;
  onChange: (color: ThemeColor) => void;
  /**
   * Optional advisory shown above the swatches when the picker can't
   * apply to anything (e.g. no element selected). The picker still
   * renders so users can see the theme palette.
   */
  hint?: string;
}

/**
 * Themed color picker — three sections, matching the look of docs /
 * sheets `ColorPickerGrid` so the slides toolbar feels native:
 *
 *   THEME       6×2 swatches (12 ColorScheme slots) — emits `{ kind: 'role' }`
 *   STANDARD    Reuses the docs `TEXT_COLORS` palette — emits `{ kind: 'srgb' }`
 *   CUSTOM      Native `<input type="color">` — emits `{ kind: 'srgb' }`
 *
 * Theme swatches let chosen colors follow theme switches; standard /
 * custom emit concrete hex so the user's intent is preserved.
 */
export function ThemedColorPicker({
  value,
  theme,
  onChange,
  hint,
}: ThemedColorPickerProps) {
  // `useId()` so two pickers (e.g. nested popovers, harness scenarios
  // that render Color and Font side by side) don't generate duplicate
  // DOM ids.
  const customColorId = useId();
  const isSrgbSelected = (hex: string) =>
    value?.kind === "srgb" && value.value.toLowerCase() === hex.toLowerCase();

  return (
    <div role="group" aria-label="Color picker" className="w-[208px]">
      {hint && (
        <p className="mb-2 rounded bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground">
          {hint}
        </p>
      )}

      <p className="mb-1 px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Theme
      </p>
      <div className="mb-2 grid grid-cols-8 gap-1">
        {PICKER_THEME_ROLES.map((role) => {
          const selected = isRoleSelected(value, role);
          return (
            <button
              key={role}
              type="button"
              aria-label={role}
              aria-pressed={selected}
              title={role}
              onClick={() => onChange(makeRoleColor(role))}
              className={`h-5 w-5 cursor-pointer rounded-sm border transition-transform hover:scale-125 ${
                selected
                  ? "border-foreground ring-2 ring-ring/50"
                  : "border-border"
              }`}
              style={{ backgroundColor: theme.colors[role] }}
            />
          );
        })}
      </div>

      <p className="mb-1 px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Standard
      </p>
      <div className="mb-2 grid grid-cols-8 gap-1">
        {TEXT_COLORS.map((hex) => {
          const selected = isSrgbSelected(hex);
          return (
            <button
              key={hex}
              type="button"
              aria-label={`Color ${hex}`}
              aria-pressed={selected}
              title={hex}
              onClick={() => onChange(makeSrgbColor(hex))}
              className={`h-5 w-5 cursor-pointer rounded-sm border transition-transform hover:scale-125 ${
                selected
                  ? "border-foreground ring-2 ring-ring/50"
                  : "border-border"
              }`}
              style={{ backgroundColor: hex }}
            />
          );
        })}
      </div>

      <div className="border-t pt-2">
        <label
          htmlFor={customColorId}
          className="mb-1 flex cursor-pointer items-center justify-between px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
        >
          <span>Custom</span>
          {value?.kind === "srgb" && (
            <span className="font-mono text-[10px] normal-case text-foreground">
              {value.value.toUpperCase()}
            </span>
          )}
        </label>
        <input
          id={customColorId}
          type="color"
          aria-label="Custom color"
          value={value?.kind === "srgb" ? value.value : "#000000"}
          onChange={(e) => onChange(makeSrgbColor(e.target.value))}
          className="h-7 w-full cursor-pointer rounded border border-border bg-transparent"
        />
      </div>
    </div>
  );
}
