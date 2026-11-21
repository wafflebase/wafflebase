# Template Design Polish — Todo

Polish the public gallery's board, slides and sheet templates, and make the
card thumbnails worth looking at. One PR, parallel agents with disjoint file
ownership.

## Why

Looking over the 38 public templates on wafflebase.io (2026-11-21):

- **Thumbnails depend on the publisher's theme.** Docs, board and sheet cards
  were captured from a dark-mode browser, so they show a black page or a grey
  plane next to light slide cards.
- **Sheet thumbnails are mostly empty grid**, with the data a speck in the
  top-left corner; board thumbnails carry wide margins.
- **Slides:** title-slide titles are small for the slide, placeholder
  subtitles barely read, and most decks share one "half panel + circle"
  pattern; some themes show a seam line crossing the circle.
- **Sheets:** headers have no fill, summary blocks don't separate from data.
- **Boards:** sound structure; spacing and title hierarchy can tighten.

## How changes reach production

A public listing tracks its live document: editing it returns the listing
to review. The catalog code is the source of truth, so the order is code →
release → `seed:templates --force-content` → re-capture thumbnails →
re-approve (one pass, after this PR ships).

## Plan

- [x] Lane thumbnails (frontend): capture in the light theme regardless of
      the viewer's; sheets capture the used range; boards fit to content.
- [x] Lane slides (catalog `builders.ts`, `compositions.ts`, `slides*.ts`,
      `briefs*.ts`): title-slide scale and hierarchy, placeholder legibility,
      deck variety within the existing theme set.
- [x] Lane sheets (catalog `sheets.ts`): header fill, summary blocks, number
      formats, widths within the seed's constraints.
- [x] Lane boards (catalog `boards.ts`, `note-and-board.ts`): spacing,
      section/title hierarchy.
- [x] Independent reviewer per lane, rendering the result locally.
- [ ] `jest src/template`, frontend tests, `verify:fast`, `/self-review`, PR.
- [ ] After release: production re-seed, re-capture, re-approve.

## Review

Workflow `wf_6073f76f-a09`, 9 agents: four lanes, a reseed, and an
independent render-based reviewer per lane.

- **Thumbnails:** the capture no longer photographs the live view. Docs
  paint under `withTheme('light')`. Notes always use the light theme.
  Sheets mount a read-only light engine on the used range, framed at
  16:10, with the freeze band dropped. Boards rasterize the content bounds
  with legible section pills. Captured from a dark-scheme browser, every
  type now comes out light and framed.
- **Slides:** cover titles are 80pt bold, subtitles 40pt, and the title
  block sits at the bottom. Statement titles are 60pt and big numbers are
  bold. Covers vary across 10 decor/theme pairings. The sidebar/split
  edge rule is removed, which fixes the seam through the circle. The lint
  baseline is now empty.
- **Sheets:** one visual grammar for all seven: a tinted header, numeric
  headers right-aligned, ruled totals, washed summary blocks, and muted
  guidance.
- **Boards:** one 48-unit section gap, a 40px/20px title hierarchy, sticky
  colours that match their section, and a 2×2 weekly sync.
- **Coordinator:** fixed `board-section-paint.ts`. Titles were cut at
  fractional zoom ("Ideas" → "Ide…") because the pill width rounded under
  the label width after `* zoom / zoom`. It now allows half a screen pixel
  of slack, with a regression test.

Not changed (out of scope, recorded for follow-up):

- ~~Slides body copy reads small~~ — done by request (2026-11-21):
  `DEFAULT_MASTER` body 18→27, subtitle 24→36, caption 14→18 (1.5x Google
  Slides' 18/28/12pt, because a native deck paints a stored point at 96 DPI
  on a 2 px/pt slide, i.e. at two thirds of a point). Each deck stores its
  own master copy, so existing decks are unchanged; new decks, PPTX imports
  without placeholder styles, and the catalog pick it up. Ten slides visual
  baselines (title-body, big-number, and the full mobile page) were
  re-recorded in Docker; the other rewritten-in-tolerance baselines were
  reverted.
- The slides editor draws decor past the slide edge. Thumbnails and the
  slideshow clip it.
- Sheet notes in muted ink (#857060) are 3.56:1 on the dark grid.
  `CellStyle` has no font size, so the INVOICE title relies on weight and
  a rule for hierarchy.
- Docs thumbnails keep the editor viewport's aspect, not 16:10.

`jest src/template` 365/365, board tests 619/619, `verify:fast` green. The
one tsc error in `docs-view.tsx` predates this branch.
