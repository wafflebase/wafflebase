# Lessons — slides dark theme on create

## Effect ordering between a context provider and its consumers

`ThemeProvider`'s `useState` initializer for `resolvedTheme` reads
`window.matchMedia(...)` only — it does not consult the `theme` value
loaded from `localStorage` on the same line above. When a user has
explicitly chosen `theme = 'dark'` but their OS is `light` (or vice
versa), the first render exposes a stale `resolvedTheme`. The provider's
own `useEffect` fixes it on the next tick.

React passive effects run bottom-up — a child's effect fires BEFORE its
parent's. So a child that reads `resolvedTheme` inside a mount effect
on the same commit gets the stale value, not the corrected one.

The fix used in `SlidesView` is to gate the mount effect on a
`didMount` state set by a separate `useEffect(() => setDidMount(true), [])`.
That state flip + the provider's `setResolvedTheme` are both batched into
the next render, so by the time the gated effect runs, the context has
caught up.

The first cut of `MobileSlidesView` mirrored the ref pattern but skipped
the gate, which the code review caught: a one-shot seed driven by context
state is only safe if the effect waits for context to settle. Whenever
you're reading provider state to make an irreversible decision at mount
time, copy the gating pattern, not just the ref pattern.

## "needsRoot" as the right boundary for new-vs-migration

`ensureSlidesRoot` runs for both brand-new decks and pre-v0.5 migrations.
Tying the dark-theme seed to the `needsRoot` branch — rather than to the
themes-backfill branch a few lines down — keeps the seed from repainting
someone else's existing deck just because the current viewer happens to
be in dark mode. The themes backfill still uses `defaultLight` for
migrations.

The corresponding unit test asserts that a doc with `meta` already set
(but no `themes`) is NOT repainted, even when `initialThemePreference: 'dark'`
is passed. Locking that behavior down in a test means the next person to
touch the function can't accidentally widen the seed scope.
