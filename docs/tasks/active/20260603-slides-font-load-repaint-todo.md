# Slides: invalidate measure cache on font load + repaint

**Owner:** @hackerwins
**Date:** 2026-06-03

## Why

CJK runs in slide text (e.g. a title `"Yorkie, 캐즘 뛰어넘기"`) render with
a visibly wider inter-run gap in view mode than in the in-place
text-box editor — even after the user navigates between slides and
comes back. Reproduces at slide 1 of
`http://localhost:5173/shared/a9ccf804-5ed0-4661-baeb-ca4361acc8dc`.

Root cause is two compounded facts:

1. The Latin-Korean subsets of `Noto Sans KR` are loaded lazily by the
   browser via `unicode-range`. On first paint of the slide canvas,
   the relevant subsets are not yet loaded, so `ctx.measureText("캐즘")`
   returns **fallback** advance widths (≈ 311 px for `"캐즘 "` at 138.67 px
   in this deck) rather than the real Noto Sans KR widths (≈ 286 px).
2. `cachedMeasureText` (`packages/docs/src/view/layout.ts:48`) memoises
   results in a `WeakMap<TextMeasurer, Map<key, width>>` whose key
   doesn't include font-load state and is **never invalidated**.
   `clearMeasureCache` is defined but has no callers
   (`grep -rn clearMeasureCache packages` → only the definition).

The slides text renderer uses a **module-scoped singleton**
`CanvasTextMeasurer` (`packages/slides/src/view/canvas/text-renderer.ts:28`);
its cache persists for the page's lifetime. Even after fonts finish
loading and the user navigates between slides (`renderer.markDirty()`
is hit), `computeLayout` reads the stale fallback widths from the
cache, leaving the next run's `run.x` anchored ~25 px past the actual
glyph end. The gap appears as visibly wide character spacing.

The in-place text-box editor doesn't show the bug because
`initializeTextBox` constructs a **fresh** `CanvasTextMeasurer` per
mount (`packages/docs/src/view/text-box-editor.ts:390`); its cache
starts empty and the first measurement uses the now-loaded font.

Measured evidence (captured `fillText` + `measureText` in a fresh page):

| Source | `measureText("캐즘 ")` |
|---|---|
| Fallback (font not in `document.fonts`) | **311.71 px** ← layout used this |
| Loaded `Noto Sans KR` | 286.13 px ← editor uses this |
| Captured slide-canvas gap (`run("뛰어넘기").x - run("캐즘").x`) | **312 px** |

## Scope

- Subscribe to `document.fonts` load events from the slides editor.
- When fonts finish loading, call `clearMeasureCache()` from
  `@wafflebase/docs` and request a repaint of the main canvas + the
  thumbnail panel so both pick up fresh widths.
- Clean up the listener on `SlidesEditor.detach()`.
- Out of scope: docs editor (same class of bug — `DocCanvas`'s
  measurer is also module-scoped — but the user-reported case is
  slides, and docs has its own follow-up surface). PDF / PPTX export
  paths already preload fonts via `document.fonts.load`.

## Plan

- [ ] Export `clearMeasureCache` through the `@wafflebase/docs` index
      (already exported from `view/layout.ts`; verify the re-export).
- [ ] Add a `SlidesEditorOptions.onFontsLoaded?` hook so the React
      `SlidesView` (which owns both the editor and the thumbnail panel)
      can refresh thumbnails too.
- [ ] In `SlidesEditorImpl` constructor, register a
      `document.fonts.addEventListener('loadingdone', handler)` via the
      existing `this.on(...)` infrastructure so it gets torn down in
      `detach()`. Handler calls `clearMeasureCache()`,
      `this.renderer.markDirty()`, and `options.onFontsLoaded?.()`.
- [ ] In `SlidesView`, wire `onFontsLoaded` to call
      `panel.refreshContent()` so painted thumbnails repaint at the
      new widths.
- [ ] Guard for SSR / Node test envs where `document` /
      `document.fonts` are absent — no-op the registration.
- [ ] Vitest: in `packages/slides/test/view/editor/` (or a new file),
      mount a `SlidesEditorImpl` against a stubbed `document.fonts`
      that exposes `addEventListener`/`removeEventListener`. Dispatch
      `loadingdone`; assert (a) `clearMeasureCache` was invoked
      (spyable via a re-export wrap), (b) `renderer.markDirty()` was
      invoked, (c) `detach()` removes the listener.
- [ ] `pnpm verify:fast` green.

## Out of scope (deliberate)

- Pre-loading deck fonts at mount time. Lazy unicode-range subsets
  make a full preload non-trivial (would need to walk every block's
  text + force load each subset). The reactive `loadingdone` path
  catches every subset load with one listener.
- Mirroring the fix in `DocCanvas`. Same class of bug exists for docs
  but is a separate ticket; bundling would blur the diff and require
  a docs-side regression sweep.
- A `clearMeasureCache` call in the slide renderer's own `dispose` —
  the cache is module-scoped and shared by every other consumer
  (thumbnails, text-box-editor mounts past detach). Premature drain
  would punish unrelated paths.

## Review

(filled in after implementation)
