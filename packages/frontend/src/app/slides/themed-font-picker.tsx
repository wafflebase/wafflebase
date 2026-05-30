import { useEffect } from "react";
import type { Theme, ThemeFont } from "@wafflebase/slides";
import { ensureGoogleFontsLink } from "@/components/text-formatting/font-catalog";
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
  // Each row previews in its own family; load the Google Fonts CSS link
  // so Roboto / Noto Sans KR / etc. render in their actual face. Routes
  // that never mount a font picker skip the third-party request.
  useEffect(() => {
    ensureGoogleFontsLink();
  }, []);

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
        {/* Plain list of toggle buttons (NOT a `role="listbox"`).
            A listbox declares arrow-key navigation as the AT contract,
            but these are real <button> elements; mismatched semantics
            would break screen-reader keyboard interaction. The Theme
            fonts section above uses the same `aria-pressed` pattern. */}
        <ul className="flex flex-col">
          {SYSTEM_FONTS.map((family) => {
            const selected = isFamilySelected(family);
            return (
              <li key={family}>
                <button
                  type="button"
                  aria-pressed={selected}
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
