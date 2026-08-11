# Visual lane: settle the app's own webfonts before capture

## Problem

`verify-browser` failed on PR #770 (a CLI-only branch) with two visual
baseline mismatches, both `desktop.dark` only:

- `slides-theme-panel` — 339 diff px (allowed 142)
- `slides-pickers` — 818 diff px (allowed 142)

The diff artifacts localise the change precisely: only glyphs rendered in
**Inter** differ. In `slides-pickers` it is the `Heading` / `Body` preview
buttons plus the `Inter` row of the System list; in `slides-theme-panel` it is
the `aA` sample of exactly the theme thumbnails whose `fonts.heading` is Inter
(6 of the 23 built-ins). Every serif/system row matched. Cropping baseline vs
actual confirms the baseline has Inter glyphs and the failing run has the
browser's default *serif* fallback — i.e. Inter had not loaded when the
screenshot was taken.

Nothing on the branch touches the frontend, and `main` is green on the same
baselines, so this is a pre-existing race in the capture harness, not a
regression.

## Root cause

`waitForFontsReady()` in `packages/frontend/scripts/verify-visual-browser.mjs`
has three gaps:

1. `VISUAL_FONT_FAMILIES` lists only the lazily-injected Korean families plus
   `Roboto`. The families the app loads itself from `index.html`'s Google Fonts
   stylesheet — `Inter`, `Fraunces`, `JetBrains Mono` — are never `load()`ed
   and never `check()`ed, so they are covered only by the weak
   `document.fonts.ready`, which can resolve before a remote face is usable.
2. Only weights 400 and 700 are awaited. `ThemeThumbnail` renders its `aA`
   sample at weight **600**, which `css2?family=Inter:wght@400;500;600;700`
   can serve as its own face — so a 400/700 check can pass while the 600 face
   is still unloaded.
3. `waitForFontsReady()` runs *before* the section-ready wait, so text that is
   only laid out once the section mounts triggers its font fetch after the
   harness has already stopped waiting.

## Plan

- [x] Add the `index.html` families to `VISUAL_FONT_FAMILIES`.
- [x] Await the weights the UI actually renders (400/500/600/700).
- [x] Settle fonts *after* the root + section ready waits.
- [x] Add a catch-all poll: no registered `FontFace` left in `status === "loading"`.
- [x] `pnpm verify:fast`.

## Notes

The `check()` wait already hard-fails (10s timeout) if a family never becomes
available, so pulling Inter into the same set keeps the existing risk posture:
an unreachable `fonts.googleapis.com` now reports a clear timeout instead of an
opaque pixel diff. Baselines are unchanged — the fix pins capture to the
Inter-loaded state the baselines already record.
