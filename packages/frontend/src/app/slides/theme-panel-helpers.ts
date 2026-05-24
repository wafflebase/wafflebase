import { BUILT_IN_THEMES, type SlidesStore } from "@wafflebase/slides";

/**
 * Apply a built-in theme to the document in a single batch so undo
 * collapses both the `addTheme` (idempotent) and `applyTheme` writes
 * into one entry. Throws if `themeId` is unknown.
 *
 * Extracted from `theme-panel.tsx` so it can be unit-tested without
 * rendering the React component — behavioural tests for the panel
 * exercise this helper directly against a `MemSlidesStore`.
 */
export function applyBuiltInTheme(store: SlidesStore, themeId: string): void {
  const theme = BUILT_IN_THEMES.find((t) => t.id === themeId);
  if (!theme) {
    throw new Error(`[slides] unknown built-in theme: ${themeId}`);
  }
  store.batch(() => {
    store.addTheme(theme); // idempotent on theme.id (Task 3)
    store.applyTheme(theme.id);
  });
}
