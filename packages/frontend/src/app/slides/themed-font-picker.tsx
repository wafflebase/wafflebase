import type { Theme, ThemeFont } from "@wafflebase/slides";
import {
  SYSTEM_FONTS,
  isFontRoleSelected,
  makeFamilyFont,
  makeRoleFont,
} from "./themed-font-picker-helpers";

interface ThemedFontPickerProps {
  /**
   * Current value of the property being edited. Drives the "active"
   * marker on the heading/body buttons and which entry is selected
   * in the system-font dropdown. `undefined` shows no role active and
   * "Choose…" in the dropdown.
   */
  value: ThemeFont | undefined;
  /**
   * Active document theme; supplies the heading and body family
   * names. The buttons render in their own typeface so users see
   * "Inter", "Lora", etc. previewed before clicking.
   */
  theme: Theme;
  onChange: (font: ThemeFont) => void;
}

/**
 * Themed font picker.
 *
 * Theme fonts: two big buttons for `{ kind: 'role', role: 'heading' }`
 * and `{ kind: 'role', role: 'body' }`, each preview-rendered in the
 * theme's chosen family. Picking a role tracks the active theme, so
 * switching theme later via the theme panel re-fonts every text run
 * that picked a role from this row.
 *
 * System fonts: a `<select>` whose entries emit
 * `{ kind: 'family', family }` — concrete families that ignore the
 * theme. Browser-installed fonts only; no async loading here.
 *
 * Inline styles match the convention of `theme-panel.tsx` (Task 6).
 */
export function ThemedFontPicker({
  value,
  theme,
  onChange,
}: ThemedFontPickerProps) {
  const headingSelected = isFontRoleSelected(value, "heading");
  const bodySelected = isFontRoleSelected(value, "body");

  return (
    <div role="group" aria-label="Font picker" style={{ padding: 8 }}>
      <div style={{ marginBottom: 8 }}>
        <h4
          style={{
            fontSize: 11,
            color: "#666",
            margin: "0 0 4px",
            fontWeight: 600,
          }}
        >
          Theme fonts
        </h4>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <button
            type="button"
            aria-label="Heading font"
            aria-pressed={headingSelected}
            onClick={() => onChange(makeRoleFont("heading"))}
            style={{
              fontFamily: theme.fonts.heading,
              padding: "6px 8px",
              border: headingSelected
                ? "2px solid #1a73e8"
                : "1px solid #ddd",
              borderRadius: 4,
              background: "#fff",
              cursor: "pointer",
              textAlign: "left",
              fontSize: 14,
            }}
          >
            Heading — {theme.fonts.heading}
          </button>
          <button
            type="button"
            aria-label="Body font"
            aria-pressed={bodySelected}
            onClick={() => onChange(makeRoleFont("body"))}
            style={{
              fontFamily: theme.fonts.body,
              padding: "6px 8px",
              border: bodySelected
                ? "2px solid #1a73e8"
                : "1px solid #ddd",
              borderRadius: 4,
              background: "#fff",
              cursor: "pointer",
              textAlign: "left",
              fontSize: 13,
            }}
          >
            Body — {theme.fonts.body}
          </button>
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
          System fonts
        </h4>
        <select
          aria-label="System font"
          value={value?.kind === "family" ? value.family : ""}
          onChange={(e) => {
            if (e.target.value) onChange(makeFamilyFont(e.target.value));
          }}
          style={{
            width: "100%",
            padding: "4px 6px",
            border: "1px solid #ddd",
            borderRadius: 4,
            background: "#fff",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          <option value="">Choose…</option>
          {SYSTEM_FONTS.map((f) => (
            <option key={f} value={f} style={{ fontFamily: f }}>
              {f}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
