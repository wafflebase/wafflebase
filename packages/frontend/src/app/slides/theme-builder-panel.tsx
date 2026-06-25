/**
 * Theme builder panel — in-editor "Customize the theme" surface (PR3).
 *
 * Edits the deck's ACTIVE theme and master in place through the store's
 * updateTheme / updateMaster mutations. Because role-bound colors and
 * fonts resolve at render and slide backgrounds inherit from the master,
 * every edit here cascades to all slides on the next repaint — no
 * per-slide writes. Each change is one undo step (wrapped in store.batch).
 *
 * v1 surface: theme color roles, theme heading/body fonts, master
 * background fill. Per-layout placeholder geometry editing (canvas drag)
 * is the remaining builder piece; the store methods for it already exist
 * (updateLayout / updateLayoutPlaceholderFrame).
 */

import { useEffect, useState } from "react";
import {
  resolveColor,
  type ColorRole,
  type SlidesStore,
  type Theme,
  type Master,
  type ThemeColor,
} from "@wafflebase/slides";
import { FontFamilyPicker } from "@/components/text-formatting/font-family-picker";
import { ensureFontLink } from "@/components/text-formatting/font-catalog";

interface ThemeBuilderPanelProps {
  store: SlidesStore;
  /** Active theme id, kept in sync by the parent via store.onChange. */
  currentThemeId: string;
  onClose: () => void;
  variant?: "drawer" | "sheet";
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
  onClose,
  variant = "drawer",
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
  const masterFillHex = resolveColor(masterFill as ThemeColor, theme);
  const masterFillIsRole = masterFill.kind === "role";

  const setMasterFill = (value: string) => {
    store.batch(() =>
      store.updateMaster(master.id, {
        background: { fill: { kind: "srgb", value } },
      }),
    );
  };

  const resetMasterFill = () => {
    store.batch(() =>
      store.updateMaster(master.id, {
        background: { fill: { kind: "role", role: "background" } },
      }),
    );
  };

  const content = (
    <div className="flex flex-col gap-5 p-3">
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
    </div>
  );

  if (variant === "sheet") {
    return <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>;
  }

  return (
    <aside
      aria-label="Theme builder"
      className="flex w-72 shrink-0 flex-col border-l bg-background"
    >
      <header className="flex items-center justify-between border-b p-2">
        <h2 className="text-sm font-semibold">Theme builder</h2>
        <button
          type="button"
          aria-label="Close theme builder"
          onClick={onClose}
          className="rounded p-1 hover:bg-muted"
        >
          ×
        </button>
      </header>
      <div className="flex-1 overflow-y-auto">{content}</div>
    </aside>
  );
}
