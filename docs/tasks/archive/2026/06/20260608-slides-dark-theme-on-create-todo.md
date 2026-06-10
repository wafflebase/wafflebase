# Slides — seed dark theme for new decks in dark mode

When a user creates a new Presentation while the app is in dark mode,
seed the document with `defaultDark` instead of `defaultLight` so the
editor and slide canvas don't clash on first open. The theme switcher
in the right pane remains the escape hatch.

## Scope

- New decks only. A migrated pre-v0.5 deck (one that already has `meta`
  but no `themes` array) keeps its existing look — we don't repaint
  someone else's deck just because the current viewer is in dark mode.
- Both desktop (`slides-view.tsx`) and mobile (`mobile-slides-view.tsx`)
  call sites.

## Plan

- [x] `ensureSlidesRoot(doc, { initialThemePreference?: 'light' | 'dark' })`
      — gate dark seeding on `needsRoot` so migrations stay on light.
- [x] Pass `useTheme().resolvedTheme` from both call sites.
- [x] Unit tests: dark seeds `defaultDark`; light seeds `defaultLight`;
      dark preference does NOT replace themes when `meta` already exists.
- [x] `pnpm verify:fast`.

## Notes

- `defaultDark` already exists at `packages/slides/src/themes/default-dark.ts`
  with id `'default-dark'`. No new theme work needed.
- The theme-provider already exposes a `resolvedTheme: 'light' | 'dark'`
  that respects both explicit user choice and the OS `prefers-color-scheme`
  media query — exactly what we want for seeding decisions.
