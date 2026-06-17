import { useId, useRef } from "react";
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
  /**
   * Emits the chosen color. Two independent flags qualify the emission:
   *
   *   - `commit`  a discrete final pick (swatch click) — the call site
   *               closes the popover. Custom-input changes never set it,
   *               so dragging / typing in the native `<input type="color">`
   *               (which fires `onChange` continuously) keeps the palette
   *               open until the user clicks away.
   *   - `record`  the color should be added to recent colors. Set on
   *               swatch clicks and on the custom input's `onBlur` (the
   *               "done" signal). Recording is decoupled from `commit` so
   *               the custom path records without closing — closing on
   *               blur would race the click of any swatch tapped next.
   *
   * Only srgb colors are actually recorded; call sites skip role colors.
   */
  onChange: (
    color: ThemeColor,
    opts?: { commit?: boolean; record?: boolean },
  ) => void;
  /**
   * Recently used srgb hex colors, most-recent-first. Rendered as a
   * "Recent" row above Standard when non-empty. Defaults to none.
   */
  recentColors?: readonly string[];
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
  recentColors,
  hint,
}: ThemedColorPickerProps) {
  // `useId()` so two pickers (e.g. nested popovers, harness scenarios
  // that render Color and Font side by side) don't generate duplicate
  // DOM ids.
  const customColorId = useId();
  // The native `<input type="color">` fires `onBlur` whenever focus leaves,
  // even if the OS dialog was opened and cancelled without a pick. Re-applying
  // its value then would clobber a role/theme fill with the input's default
  // `#000000`. Track whether a live change actually happened since focus, and
  // only record on blur when it did.
  const customDirty = useRef(false);
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
              onClick={() =>
                onChange(makeRoleColor(role), { commit: true, record: true })
              }
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

      {recentColors && recentColors.length > 0 && (
        <>
          <p className="mb-1 px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Recent
          </p>
          <div className="mb-2 grid grid-cols-8 gap-1">
            {recentColors.map((hex) => {
              const selected = isSrgbSelected(hex);
              return (
                <button
                  key={hex}
                  type="button"
                  aria-label={`Recent color ${hex}`}
                  aria-pressed={selected}
                  title={hex}
                  onClick={() =>
                    onChange(makeSrgbColor(hex), {
                      commit: true,
                      record: true,
                    })
                  }
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
        </>
      )}

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
              onClick={() =>
                onChange(makeSrgbColor(hex), { commit: true, record: true })
              }
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
          // `onChange` fires continuously while the user drags / types in
          // the native picker — apply it live (no commit, no record) so the
          // palette stays open. `onFocus` arms the dirty flag per OS-dialog
          // session; `onBlur` is the "done" signal: record the recent color
          // only if a live change actually happened (so cancelling the OS
          // dialog can't clobber a role fill), and never close here —
          // closing would race the click of any swatch tapped next, so
          // outside-click closes instead.
          onFocus={() => {
            customDirty.current = false;
          }}
          onChange={(e) => {
            customDirty.current = true;
            onChange(makeSrgbColor(e.target.value));
          }}
          onBlur={(e) => {
            if (!customDirty.current) return;
            customDirty.current = false;
            onChange(makeSrgbColor(e.target.value), { record: true });
          }}
          className="h-7 w-full cursor-pointer rounded border border-border bg-transparent"
        />
      </div>
    </div>
  );
}
