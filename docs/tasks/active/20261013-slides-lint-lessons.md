# Slide Lint — Lessons and Improve-Loop Log

Inputs every iteration: the 19 slides seed templates and the 2026 OSSCA
final-evaluation deck (26 slides, PPTX import). Each iteration ran lint +
layout report, rendered every slide to PNG with the editor's renderer
(`render:slides`), and classified findings by looking at the pixels.

## Iteration 0 — first draft of the six rules

69 findings: seeds 19 (17 overlap, 2 contrast), 2026 deck 50 (26 overlap,
14 overflow, 4 out-of-bounds, 3 contrast, 20 edge-margin info, …).
Contrast check against the pre-#1090 Workshop cover: 2.7:1 — the same
pair the review caught by hand.

## Iteration 1 — text by ink, not frame

False positives, all confirmed on the PNGs:
- Frame-based overlap: seed body frames over bands/dots, wide centered
  title frames on slide 8, a subtitle frame over bar labels on slide 15.
- Empty text boxes counted as overlapping (slides 11, 16).
- Overflow (`none`) on tight one-line PPTX labels whose box is shorter than
  the line-height (slide 15 bar labels, slide 25 "Any Questions?").
- Out-of-bounds on frames at x = −83 / −15 around centered text.
- Image frames' transparent padding over captions (slide 5 chevrons,
  "Yorkie Server").
- Line leading made two stacked legend lines collide (slide 16).

Changes: ink boxes (run extents × line em box, renderer's vertical origin),
`paintsNothing`, overflow(`none`) only when a whole line leaves the box,
image–text overlap only when the text sits on the picture.
Result: 69 → 31 (seeds 2, deck 26 + edge info).

## Iteration 2 — missing coverage: groups

The PNG of slide 2 (table of contents) shows "01"–"04" colliding with their
labels; lint said nothing — they are number+label groups and overlap
skipped group children. Changes: group children at world position in
overlap (ink scaled into the group) and in contrast (backdrop includes what
the group painted first). +4 real findings; contrast on slide 2 correctly
stays silent (background art image ⇒ unknown).

## Iteration 3 — measurement accuracy

Compared `layoutReport` line counts from `estimateMeasurer` with the
browser's `CanvasTextMeasurer` on every text element: 346/346 equal, but
these decks barely wrap. A wrap stress set (EN/KO × 5 widths × 4 sizes):
27/60 equal, all others over-counted. Calibrated per-class widths against
Chromium `measureText` (Latin lowercase 0.5, caps 0.68, digits 0.56, space
0.28, Hangul measured 0.87–1.06 by face → 0.95): 42/60 equal, the rest still
over-count only (safe direction). Real decks stay 346/346.

## Iteration 4 — stop

Same findings as iteration 2 (32: seeds 2 contrast warnings; deck 7 overlap,
3 contrast errors, 20 edge-margin info), no new false positive or miss on the
PNGs. Stopped.

## Iteration 5 — independent agent review

Two agents checked the work independently: one against the PNGs, one
reviewing the code against the renderer.
- Visual audit: 12/12 error/warning findings real, no misses, no false
  positives. Text baked into screenshots (2026 s4/s6/s7) is invisible to
  any model-level rule (noted, not a lint miss).
- Code review, three confirmed bugs, each reproduced and fixed with a test:
  shape text ignored the preset text rectangle (an ellipse laid out ~48%
  wider than the renderer); a rotated group's child got a sliver ink box;
  a scaled group's text was judged at its unscaled size. Also fixed:
  inline highlight as the run's contrast backdrop, a slide without
  `background` crashing the run, allowlist text longer than 40 chars never
  matching, the CLI hiding stale allowlist entries, the seed gate
  de-duplicating identical findings, `--fail-on constructor` accepted,
  `--rules ""` running nothing.
- A dead-code fix in the estimate (`i`/`l` narrow) made it under-count lines
  on the stress set (8 cases) — reverted to punctuation-only; under-counting
  is the unsafe direction.
Finding counts unchanged (32); measurement still 346/346 on real decks.

## Iteration 6 — building a real deck with it

Authored the 2026 OSSCA deck from scratch (~/2026-ossca-deck/agent-build,
log in its iterations.md). One miss surfaced that no seed or import deck
had: two-line labels in 60 px chips spill past the chip's drawn edge while
no whole line leaves the box, so `overflow` said nothing. New check in
`overflow`: text spilling past the edge of a filled or bordered box.
Also found (outside lint): the PPTX exporter writes 96-DPI in-app font
sizes verbatim, so builder/in-app decks open 1.5× too large in PowerPoint.

## Classification of what remains

- Real, seed defects (baselined as such): product-launch-plan cover subtitle
  4.4:1; marketing-campaign cover subtitle 3.6:1 (block preset).
- Real, 2026 deck: section numbers colliding with titles (slides 3, 9, 14)
  and TOC numbers with labels (slide 2); yellow numbers at 1.6:1 (intent —
  allowlist candidates).
- Info, deck style: titles ~0.2 in from the top edge (20).
- Not a rule (reported, not encoded): seed body text renders at 12 slide-pt.

## Lessons

- A frame is where an element is allowed to paint, not where it paints. For
  text, every geometric rule wanted the ink.
- Every false positive class above was visible in one glance at a PNG and
  invisible in the JSON — the render step is what made tuning honest.
- PPTX import regenerates element ids; allowlists for local decks need a
  stable handle (element text), and seed tests need slug + slide number.
- `slides layout` was already an alias; check command names against the
  registry before naming a new one.
