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
- [x] Downgrade both settling waits from hard-fail to warn-and-shoot
      (`settle()`), for the reason in Notes below.
- [x] `pnpm verify:fast`.

## Notes

**Risk posture — deliberately *not* hard-fail.** An earlier draft of this plan
kept the `check()` wait's 10s timeout fatal, on the theory that a clear timeout
beats an opaque pixel diff. That reasoning does not survive widening the set to
the `index.html` families: those three come from `fonts.googleapis.com` on
*every* harness page, so a fatal wait turns a third-party outage into a total
harness failure across all ~200 captures — a much worse failure than the one
being fixed. Both settling waits therefore go through `settle()`, which warns
(naming the families that never settled) and shoots anyway. A genuinely
unloaded font still surfaces as a baseline diff, now with a warning line in the
log that says which family to blame. Anything that is not a timeout — a broken
selector, a closed page — still throws, because that is a harness bug rather
than a slow font.

Baselines are unchanged — the fix pins capture to the Inter-loaded state the
baselines already record.

## Why this rides on the CLI branch

This is unrelated to that branch's subject, and would normally be its own PR.
It landed here because `verify-browser` is a required check on PR #770 and
failed there on a race the branch does not touch (see Problem above): without
the fix the CLI change cannot go green, and with it split out the two PRs
would each be blocked on the other.
