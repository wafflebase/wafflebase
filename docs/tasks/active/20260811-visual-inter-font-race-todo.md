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

## Follow-up: the first fix was wrong about `check()`

`verify-browser` then failed on the fix itself — `page.waitForFunction:
Timeout 10000ms exceeded` out of `waitForFontsReady`, mid-capture, with no
screenshots, no diffs and no per-target report. The review panel landed on
the same code from the other side. Both point at one bad assumption:

- **`fonts.check()` is vacuous, not strict.** Per CSS Font Loading it is
  *true* when no registered face matches the query (the text renders with a
  system fallback). So a blocked `fonts.googleapis.com` — the case the note
  below claimed was now "loudly reported" — makes every check pass trivially
  and captures fallback glyphs silently. It only ever goes false for a family
  that *is* registered and whose face is unusable, i.e. `status: "error"`,
  which no amount of further waiting recovers — hence the hard timeout.
- **A hand-kept family list drifts.** It named 4 of the 8 `eager: true`
  catalog families and demanded weights `index.html` never requests
  (Fraunces 400, JetBrains Mono 600/700), each an unnecessary way to hang.
- **Aborting mid-capture is the least diagnosable failure available** — it
  loses the artifacts the CI job exists to upload.

### Plan

- [x] Derive the awaited set from `document.fonts` itself — every registered
      face, at the weights it declares — so it cannot drift from
      `index.html`, `FONT_CATALOG`'s eager set or a lazily injected link.
- [x] Pair `check()` with a per-family "at least one face reached `loaded`"
      assertion, which is what makes an unreachable CDN fail rather than pass.
- [x] Poll in-page with a deadline (re-reading the registry each tick) so a
      timeout yields the missing families by name, not a `TimeoutError`.
- [x] Bound `document.fonts.ready` with that same deadline.
- [x] Refetch the Google Fonts stylesheets and settle again (×2) — the only
      recovery for an `error` face. Stop retrying once a pass has exhausted
      them, so a broken network does not add ~24 × 30s of waiting.
- [x] Record the failure and keep capturing; fail the run at the end, after
      the artifacts are written, and refuse `visual:update` outright.
- [x] `pnpm verify:fast` + the Docker browser lane.

## Known limitations

- If `fonts.googleapis.com` is genuinely unreachable the lane still fails —
  now by name, with artifacts, instead of a bare timeout. Making it *pass*
  offline would mean vendoring the woff2 bytes and re-recording all 220
  baselines against them; worth doing, out of scope here.
- `packages/frontend/scripts/capture-docs-screenshots.mjs` still uses a bare
  `document.fonts.ready`. Same weakness, different (non-gating) script.
