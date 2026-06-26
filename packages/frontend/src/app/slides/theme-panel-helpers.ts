import { BUILT_IN_THEMES, type SlidesStore, type Theme } from "@wafflebase/slides";

/**
 * Apply a built-in theme as the deck's active theme, always resetting it
 * to the pristine built-in (model A — in-place edit, re-pick resets).
 *
 * In one batch (so undo collapses it to a single entry):
 *  1. `addTheme` — ensure the theme exists in `doc.themes` (idempotent).
 *  2. `updateTheme` with the FULL name/colors/fonts — overwrite any prior
 *     customization back to the built-in. (updateTheme merges, and a full
 *     colors/fonts object overwrites every role.)
 *  3. `applyTheme` — make it active.
 *
 * So picking the active theme again resets it, and switching away then
 * back also resets — there is no lingering edited copy. Throws if
 * `themeId` is unknown.
 *
 * Extracted from `theme-panel.tsx` so it can be unit-tested without
 * rendering React.
 */
export function applyBuiltInTheme(store: SlidesStore, themeId: string): void {
  const theme = BUILT_IN_THEMES.find((t) => t.id === themeId);
  if (!theme) {
    throw new Error(`[slides] unknown built-in theme: ${themeId}`);
  }
  store.batch(() => {
    store.addTheme(theme); // ensure present (idempotent on id)
    store.updateTheme(theme.id, {
      name: theme.name,
      colors: theme.colors,
      fonts: theme.fonts,
    }); // overwrite any customization back to pristine
    store.applyTheme(theme.id);
  });
}

/**
 * True when `theme` is a built-in that has been customized (its colors,
 * fonts, or name differ from the shipped built-in of the same id).
 * Returns false for a theme whose id is not a built-in (e.g. a
 * PPTX-imported theme) — there is no origin to compare against.
 *
 * Drives the Theme panel's "In this presentation" section and the
 * Customize tab's "Reset to original" affordance.
 */
export function isThemeModified(theme: Theme): boolean {
  const builtin = BUILT_IN_THEMES.find((t) => t.id === theme.id);
  if (!builtin) return false;
  return (
    theme.name !== builtin.name ||
    JSON.stringify(theme.colors) !== JSON.stringify(builtin.colors) ||
    JSON.stringify(theme.fonts) !== JSON.stringify(builtin.fonts)
  );
}
