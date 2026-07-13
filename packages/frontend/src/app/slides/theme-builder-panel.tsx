/**
 * Theme builder — in-editor "Customize the theme" surface (PR3).
 *
 * Content-only: it renders the editing sections (colors / fonts / master
 * background) and is embedded inside the Theme panel's "Customize" tab,
 * which owns the panel chrome. Edits go through updateTheme / updateMaster
 * in place; role-bound colors and fonts resolve at render and slide
 * backgrounds inherit from the master, so every edit cascades to all
 * slides on the next repaint — no per-slide writes. Each change is one
 * undo step (wrapped in store.batch).
 *
 * v1 surface: theme color roles, theme heading/body fonts, master
 * background fill, and an entry point into canvas layout-editing mode
 * (drag a layout's placeholders), driven by `onEditLayouts`.
 */

import { useEffect, useState } from "react";
import {
  representativeColor,
  resolveColor,
  type ColorRole,
  type SlidesStore,
  type Theme,
  type Master,
} from "@wafflebase/slides";
import { FontFamilyPicker } from "@/components/text-formatting/font-family-picker";
import { ensureFontLink } from "@/components/text-formatting/font-catalog";
import { applyBuiltInTheme, isThemeModified } from "./theme-panel-helpers";

interface ThemeBuilderPanelProps {
  store: SlidesStore;
  /** Active theme id, kept in sync by the parent via store.onChange. */
  currentThemeId: string;
  /**
   * Enter canvas layout-editing mode (drag layout placeholders). When
   * omitted the Layouts section is hidden — e.g. the mobile sheet, which
   * has no canvas drag surface.
   */
  onEditLayouts?: () => void;
}

/** The 12 theme color roles, in editing order, with human labels. */
const COLOR_ROLES: ReadonlyArray<{ role: ColorRole; label: string }> = [
  { role: "text", label: "Text" },
  { role: "background", label: "Background" },
  { role: "textSecondary", label: "Text 2" },
  { role: "backgroundAlt", label: "Background 2" },
  { role: "accent1", label: "Accent 1" },
  { role: "accent2", label: "Accent 2" },
  { role: "accent3", label: "Accent 3" },
  { role: "accent4", label: "Accent 4" },
  { role: "accent5", label: "Accent 5" },
  { role: "accent6", label: "Accent 6" },
  { role: "hyperlink", label: "Link" },
  { role: "visitedHyperlink", label: "Visited link" },
];

function activeMaster(store: SlidesStore): Master | undefined {
  const doc = store.read();
  return doc.masters.find((m) => m.id === doc.meta.masterId) ?? doc.masters[0];
}

/**
 * Normalize a hex color for `<input type="color">`, whose value must be a
 * "valid lowercase simple color" (`#rrggbb`). Theme palettes store
 * uppercase hex (e.g. `#1A1A1A`); without lowercasing the control rejects
 * the value and shows black. Non-6-digit inputs fall back to black, which
 * the native control would do anyway.
 */
function toColorInputValue(hex: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : "#000000";
}

export function ThemeBuilderPanel({
  store,
  currentThemeId,
  onEditLayouts,
}: ThemeBuilderPanelProps) {
  // Re-render on any store change (local commit or remote peer edit) so
  // the controls reflect the current theme/master. The store reads below
  // are the source of truth; `tick` only forces re-derivation.
  const [tick, setTick] = useState(0);
  useEffect(() => store.onChange?.(() => setTick((t) => t + 1)), [store]);
  void tick;

  const doc = store.read();
  const theme: Theme | undefined =
    doc.themes.find((t) => t.id === currentThemeId) ?? doc.themes[0];
  const master = activeMaster(store);

  if (!theme || !master) {
    return null;
  }

  const setColor = (role: ColorRole, value: string) => {
    store.batch(() => store.updateTheme(theme.id, { colors: { [role]: value } }));
  };

  const setFont = (which: "heading" | "body", family: string) => {
    ensureFontLink(family);
    store.batch(() => store.updateTheme(theme.id, { fonts: { [which]: family } }));
  };

  const masterFill = master.background.fill ?? { kind: "role", role: "background" };
  const masterFillHex = resolveColor(representativeColor(masterFill), theme);
  const masterFillIsRole = masterFill.kind === "role";

  const setMasterFill = (value: string) => {
    store.batch(() =>
      // Clear any background image so the chosen fill actually shows on
      // image-backed (e.g. imported) decks, where the image would
      // otherwise still paint over the fill.
      store.updateMaster(master.id, {
        background: { fill: { kind: "srgb", value }, image: null },
      }),
    );
  };

  const resetMasterFill = () => {
    store.batch(() =>
      store.updateMaster(master.id, {
        background: { fill: { kind: "role", role: "background" }, image: null },
      }),
    );
  };

  const modified = isThemeModified(theme, master);

  return (
    <div className="flex flex-col gap-5 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">
          Editing <span className="font-medium text-foreground">{theme.name}</span>
        </span>
        {modified && (
          <button
            type="button"
            onClick={() => applyBuiltInTheme(store, theme.id)}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] hover:bg-muted"
          >
            Reset to original
          </button>
        )}
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">Colors</h3>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {COLOR_ROLES.map(({ role, label }) => (
            <label
              key={role}
              className="flex items-center gap-2 text-xs"
              title={`${label} (${role})`}
            >
              <input
                type="color"
                aria-label={label}
                value={toColorInputValue(theme.colors[role])}
                onChange={(e) => setColor(role, e.target.value)}
                className="h-6 w-6 shrink-0 cursor-pointer rounded border bg-transparent p-0"
              />
              <span className="truncate">{label}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">Fonts</h3>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="shrink-0">Headings</span>
          <FontFamilyPicker
            value={theme.fonts.heading}
            onChange={(f) => setFont("heading", f)}
          />
        </div>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="shrink-0">Body</span>
          <FontFamilyPicker
            value={theme.fonts.body}
            onChange={(f) => setFont("body", f)}
          />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">
          Background
        </h3>
        <div className="flex items-center gap-2 text-xs">
          <input
            type="color"
            aria-label="Master background fill"
            value={toColorInputValue(masterFillHex)}
            onChange={(e) => setMasterFill(e.target.value)}
            className="h-6 w-6 shrink-0 cursor-pointer rounded border bg-transparent p-0"
          />
          <span className="truncate">
            {masterFillIsRole ? "Theme background" : masterFillHex}
          </span>
          {!masterFillIsRole && (
            <button
              type="button"
              onClick={resetMasterFill}
              className="ml-auto rounded px-1.5 py-0.5 text-[11px] hover:bg-muted"
            >
              Match theme
            </button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Applies to slides that haven&apos;t set their own background.
        </p>
      </section>

      {onEditLayouts && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-muted-foreground">
            Layouts
          </h3>
          <button
            type="button"
            onClick={onEditLayouts}
            className="rounded border px-2 py-1.5 text-xs font-medium hover:bg-muted"
          >
            Edit layout positions
          </button>
          <p className="text-[11px] text-muted-foreground">
            Drag a layout&apos;s placeholders on the canvas. Changes flow to
            slides using that layout.
          </p>
        </section>
      )}
    </div>
  );
}
