import type { Theme, ThemeFont } from "@wafflebase/slides";
import {
  SYSTEM_FONTS,
  isFontRoleSelected,
  makeFamilyFont,
  makeRoleFont,
} from "./themed-font-picker-helpers";

interface ThemedFontPickerProps {
  value: ThemeFont | undefined;
  theme: Theme;
  onChange: (font: ThemeFont) => void;
  /**
   * Optional advisory shown above the options when no relevant element
   * is selected; the picker still renders so users can see the theme
   * fonts.
   */
  hint?: string;
}

/**
 * Themed font picker — two sections, matching the look of docs / sheets
 * dropdowns:
 *
 *   THEME FONTS  Heading + Body buttons preview-rendered in their own
 *                family. Click emits `{ kind: 'role', role }`.
 *   SYSTEM       List of installed families. Click emits
 *                `{ kind: 'family', family }`.
 *
 * Each system row renders in its own family so users see the typeface
 * before picking.
 */
export function ThemedFontPicker({
  value,
  theme,
  onChange,
  hint,
}: ThemedFontPickerProps) {
  const headingSelected = isFontRoleSelected(value, "heading");
  const bodySelected = isFontRoleSelected(value, "body");
  const isFamilySelected = (family: string) =>
    value?.kind === "family" && value.family === family;

  return (
    <div role="group" aria-label="Font picker" className="w-[208px]">
      {hint && (
        <p className="mb-2 rounded bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground">
          {hint}
        </p>
      )}

      <p className="mb-1 px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Theme fonts
      </p>
      <div className="mb-2 flex flex-col gap-1">
        <button
          type="button"
          aria-label="Heading font"
          aria-pressed={headingSelected}
          onClick={() => onChange(makeRoleFont("heading"))}
          className={`flex items-center justify-between rounded border px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted ${
            headingSelected
              ? "border-foreground ring-2 ring-ring/50"
              : "border-border"
          }`}
          style={{ fontFamily: theme.fonts.heading }}
        >
          <span>Heading</span>
          <span className="text-[11px] text-muted-foreground">
            {theme.fonts.heading}
          </span>
        </button>
        <button
          type="button"
          aria-label="Body font"
          aria-pressed={bodySelected}
          onClick={() => onChange(makeRoleFont("body"))}
          className={`flex items-center justify-between rounded border px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted ${
            bodySelected
              ? "border-foreground ring-2 ring-ring/50"
              : "border-border"
          }`}
          style={{ fontFamily: theme.fonts.body }}
        >
          <span>Body</span>
          <span className="text-[11px] text-muted-foreground">
            {theme.fonts.body}
          </span>
        </button>
      </div>

      <div className="border-t pt-2">
        <p className="mb-1 px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          System
        </p>
        <ul className="flex flex-col" role="listbox" aria-label="System fonts">
          {SYSTEM_FONTS.map((family) => {
            const selected = isFamilySelected(family);
            return (
              <li key={family} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  aria-label={family}
                  onClick={() => onChange(makeFamilyFont(family))}
                  className={`flex w-full cursor-pointer items-center rounded px-2 py-1 text-left text-sm transition-colors hover:bg-muted ${
                    selected ? "bg-muted text-foreground" : "text-foreground"
                  }`}
                  style={{ fontFamily: family }}
                >
                  {family}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
