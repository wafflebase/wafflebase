import {
  BUILT_IN_THEMES,
  type SlidesStore,
  type Theme,
  type Master,
  type ThemeColor,
} from "@wafflebase/slides";

/** The pristine master background every deck starts with. */
const DEFAULT_MASTER_FILL: ThemeColor = { kind: "role", role: "background" };

/**
 * Apply a built-in theme as the deck's active theme, resetting the full
 * theme-builder surface (theme colors/fonts AND the master background)
 * back to pristine (model A — in-place edit, re-pick resets).
 *
 * In one batch (so undo collapses it to a single entry):
 *  1. `addTheme` — ensure the theme exists in `doc.themes` (idempotent).
 *  2. `updateTheme` with the FULL name/colors/fonts — overwrite any prior
 *     customization. (Built-ins define every role, so the per-key merge
 *     replaces them all.)
 *  3. `updateMaster` — reset the active master background to the default
 *     `background` role and clear any background image.
 *  4. `applyTheme` — make it active.
 *
 * So picking the active theme again resets it, and switching away then
 * back also resets — no lingering edited copy, and background edits are
 * reverted too. Throws if `themeId` is unknown.
 *
 * Extracted from `theme-panel.tsx` so it can be unit-tested without
 * rendering React.
 */
export function applyBuiltInTheme(store: SlidesStore, themeId: string): void {
  const theme = BUILT_IN_THEMES.find((t) => t.id === themeId);
  if (!theme) {
    throw new Error(`[slides] unknown built-in theme: ${themeId}`);
  }
  const masterId = store.read().meta.masterId;
  store.batch(() => {
    store.addTheme(theme); // ensure present (idempotent on id)
    store.updateTheme(theme.id, {
      name: theme.name,
      colors: theme.colors,
      fonts: theme.fonts,
    });
    store.updateMaster(masterId, {
      background: { fill: DEFAULT_MASTER_FILL, image: null },
    });
    store.applyTheme(theme.id);
  });
}

function sameRecord(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => a[k] === b[k]);
}

/** True when the active master background differs from the pristine default. */
function isMasterBackgroundModified(master: Master): boolean {
  const f = master.background.fill;
  const isDefaultFill =
    f.kind === "role" &&
    f.role === "background" &&
    f.lumMod === undefined &&
    f.lumOff === undefined &&
    f.tint === undefined &&
    f.shade === undefined &&
    f.alpha === undefined;
  return !isDefaultFill || master.background.image != null;
}

/**
 * True when the theme-builder surface has been customized away from the
 * pristine built-in: theme name/colors/fonts differ from the built-in of
 * the same id, OR (when `master` is supplied) the master background was
 * changed. Returns false for a theme whose id is not a built-in (e.g. a
 * PPTX-imported theme) — there is no origin to compare against.
 *
 * Compares colors/fonts by key/value (not JSON.stringify) so a CRDT
 * round-trip that reorders object keys does not report a false positive.
 *
 * Drives the Theme panel's "In this presentation" section and the
 * Customize tab's "Reset to original" affordance.
 */
export function isThemeModified(theme: Theme, master?: Master): boolean {
  // Gate everything behind the built-in lookup: a non-built-in (imported)
  // theme has no origin to reset to, so it must report unmodified even if
  // the master background changed — otherwise the panel would show "Reset
  // to original", which calls applyBuiltInTheme(theme.id) and throws.
  const builtin = BUILT_IN_THEMES.find((t) => t.id === theme.id);
  if (!builtin) return false;
  if (master && isMasterBackgroundModified(master)) return true;
  return (
    theme.name !== builtin.name ||
    !sameRecord(theme.colors, builtin.colors) ||
    !sameRecord(theme.fonts, builtin.fonts)
  );
}
