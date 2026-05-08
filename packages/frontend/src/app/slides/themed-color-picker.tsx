import type { ColorRole, Theme, ThemeColor } from "@wafflebase/slides";
import {
  THEME_ROLES,
  isRoleSelected,
  makeRoleColor,
  makeSrgbColor,
} from "./themed-color-picker-helpers";

interface ThemedColorPickerProps {
  /**
   * Current value of the property being edited. Drives which swatch
   * shows the "active" marker. `undefined` for properties with no
   * explicit value (renders no marker — neither the role row nor the
   * custom input look "selected").
   */
  value: ThemeColor | undefined;
  /** Active document theme; supplies the twelve role swatch colors. */
  theme: Theme;
  onChange: (color: ThemeColor) => void;
}

/**
 * Themed color picker.
 *
 * Top row: 12 theme color swatches resolved against the active theme.
 * Clicking a swatch emits `{ kind: 'role', role }` so the chosen color
 * tracks the deck theme — switching theme later via the theme panel
 * recolors every shape that picked a role from this row.
 *
 * Bottom row: native `<input type="color">` for `{ kind: 'srgb' }`
 * values. Once a user picks a custom color, no role swatch shows the
 * "active" marker (custom colors don't track the theme).
 *
 * Inline styles match the convention of `theme-panel.tsx` (Task 6) —
 * a follow-up can migrate to Tailwind for both panels at once.
 */
export function ThemedColorPicker({
  value,
  theme,
  onChange,
}: ThemedColorPickerProps) {
  return (
    <div role="group" aria-label="Color picker" style={{ padding: 8 }}>
      <div style={{ marginBottom: 8 }}>
        <h4
          style={{
            fontSize: 11,
            color: "#666",
            margin: "0 0 4px",
            fontWeight: 600,
          }}
        >
          Theme
        </h4>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, 24px)",
            gap: 4,
          }}
        >
          {THEME_ROLES.map((role: ColorRole) => {
            const selected = isRoleSelected(value, role);
            return (
              <button
                key={role}
                type="button"
                aria-label={role}
                aria-pressed={selected}
                onClick={() => onChange(makeRoleColor(role))}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 4,
                  background: theme.colors[role],
                  border: selected
                    ? "2px solid #1a73e8"
                    : "1px solid #ddd",
                  position: "relative",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                {selected && (
                  <span
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      top: -2,
                      right: -2,
                      width: 6,
                      height: 6,
                      background: "#1a73e8",
                      borderRadius: "50%",
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <h4
          style={{
            fontSize: 11,
            color: "#666",
            margin: "8px 0 4px",
            fontWeight: 600,
          }}
        >
          Custom
        </h4>
        <input
          type="color"
          value={value?.kind === "srgb" ? value.value : "#000000"}
          onChange={(e) => onChange(makeSrgbColor(e.target.value))}
          aria-label="Custom color"
          style={{ width: "100%", height: 28, cursor: "pointer" }}
        />
      </div>
    </div>
  );
}
