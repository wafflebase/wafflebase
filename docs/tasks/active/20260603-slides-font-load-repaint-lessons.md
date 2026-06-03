# Slides: font-load repaint — lessons

**Owner:** @hackerwins
**Date:** 2026-06-03

## What surprised me

- Two-layer cache. Knowing that `Noto Sans KR` is loaded via
  unicode-range subsets is half the story; the load timing itself
  wouldn't be sticky if `cachedMeasureText` re-ran on every
  `computeLayout`. The real reason "navigate away and back doesn't
  fix it" is the **module-scoped `WeakMap<TextMeasurer, …>`** holding
  the fallback widths against the slides text-renderer's singleton
  measurer. The first hypothesis ("font loads late, paint is stale")
  was directionally right but stopped short — and would have been
  defeated by the user's counter-test (re-render with fonts already
  loaded). Always pressure-test a hypothesis against the obvious
  retry path before claiming root cause.
- The in-place text-box editor doesn't share this measurer.
  `initializeTextBox` allocates a fresh `CanvasTextMeasurer()` per
  mount (`packages/docs/src/view/text-box-editor.ts:390`), so its
  cache starts empty. That's why the bug felt "view-mode only" —
  the editor accidentally side-stepped it.

## Evidence I should have collected earlier

- Captured `fillText` calls + a side-by-side `measureText` probe
  against (a) a loaded font and (b) an intentionally-bogus font name
  pegged the layout-time width to the fallback metric within ~1 px.
  That single comparison is more convincing than any amount of
  source-tracing.
- `grep -rn clearMeasureCache packages` returning only the
  definition was the moment the second-half hypothesis became
  obvious. Worth checking "is the safety valve actually wired up?"
  whenever a stale-state bug is in play.

## Choices made

- **Listener over preload.** Lazy unicode-range subsets keep loading
  throughout the session; a single `loadingdone` listener catches
  every subset load, while a one-shot preload at mount would need to
  walk every block's text and force-load each matching subset.
- **Slides only.** `DocCanvas` has the same class of bug (its
  measurer is also module-scoped, and `clearMeasureCache` has no
  callers from docs either). Bundling the fix would have expanded
  the diff and the regression sweep; the user reported slides, ship
  slides, follow up on docs separately.
- **Editor-owned, host-notified.** The editor self-invalidates +
  re-paints the main canvas (so headless or mobile mounts already
  benefit) and exposes a single `onFontsLoaded` hook for hosts that
  own sibling renderers (the desktop `SlidesView` uses it to refresh
  the thumbnail panel). Avoids duplicating the listener / cache-drain
  logic in two places.
- **No `?` chaining inside `attachInteractions`.** The font-load
  listener registers OUTSIDE the `if (!options.readOnly)` block so
  share-link viewers — which see the exact same gap — also get the
  invalidation. The existing `this.on(...)` infrastructure handles
  cleanup uniformly via `detach()`.
- **`thumbHandle` became `let … | null`.** The editor's
  `onFontsLoaded` closure runs at some later tick, but
  `mountThumbnailPanel` mounts after the editor. Capturing a `let`
  binding the assignment can later fill in is cleaner than a ref or a
  pre-construction promise dance.

## What to watch in PR review

- A reviewer might ask "why not call `clearMeasureCache` inside
  `paintTextBody` if `document.fonts.status === 'loaded'`?" — that
  bumps the check into the hot paint loop and doesn't help when the
  status was `loaded` at paint time but a *new* subset finished
  loading two frames later. Reactive listener stays clean.
- Vitest mock of `@wafflebase/docs` spreads `...actual` so every
  other export keeps real behavior. Keep an eye on partial-mock drift
  if future docs exports gain test-relevant side effects.
