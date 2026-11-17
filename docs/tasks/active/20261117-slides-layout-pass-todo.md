# Slides editor layout pass

Source: `/impeccable` layout review of the Slides editor (2026-11-17), run
against a live deck at 1440×723 and 1024×591, light and dark, idle /
object / text-edit / Format-panel states. The detector scan was clean;
every item below came from the rendered editor.

Work runs as parallel agents on disjoint files, collected into one PR.

## Items

- [x] **A. Canvas starved at narrow widths.** At 1024px the app sidebar
  (256) + thumbnails + Format panel (288) leave the slide ~295px wide.
  Decision: on the Slides editor route, auto-collapse the app sidebar
  while the viewport is below 1280px, without overwriting the user's
  persisted sidebar preference. (`slides-detail.tsx`, sidebar wiring)
- [x] **B. Toolbar overflow hides panel toggles.** At 1024px the toolbar
  scrolls horizontally (760 visible / 853 content), pushing Motion /
  Background / Theme off-screen. Fold overflowing controls into a "More"
  menu as Docs does, and pin the panel toggles so they never scroll
  away. (`toolbar/*`) The review also asked to keep the toggles in one
  form across states; that was dropped — the labelled-idle /
  icon-otherwise split is documented Google parity (see lessons).
- [x] **C. Ruler unit and legibility.** The ruler shows cm while the
  Format panel's deck unit is inches: `SlidesRuler.setUnit` is never
  called, so the ruler follows locale and the panel follows `meta.unit`.
  Sync the ruler to the deck unit. Labels are `8px Arial` in hard-coded
  `#b0b0b0` (below the 10px floor, ~2.1:1, not tokenized). (`ruler.ts`,
  `slides-view.tsx` ruler wiring)
- [x] **D. Format panel rhythm.** Size & Position rows sit at 36px while
  Units / Drop shadow / Reflection / Alt text are spaced at a uniform
  ~48px, so groups don't read as groups; the two rotate buttons are both
  labelled "90°". (`format-panel/*`)
- [x] **E. Thumbnail selection frame.** The selected thumbnail's 1px
  border is hard to spot at narrow panel widths; thicken it without
  changing the thumb's box. (`packages/slides/src/view/editor/thumbnail-panel.ts`)

Out of scope: the vertical ruler sitting far from a centred slide (matches
Google Slides); "Saving…" flashing on text-edit entry (separate
investigation).

## Verification

- [x] `pnpm verify:fast` green
- [x] Rendered check at 1440 and 1024, light + dark
- [ ] `/self-review` rounds logged in the lessons file

## Review

(filled in at the end)
