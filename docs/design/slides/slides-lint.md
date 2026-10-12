---
title: slides-lint
target-version: 0.6.13
---

# Slide Lint and Layout Report

## Summary

An agent authoring a deck as JSON (`slides set-content`) cannot see what it
made. Issue #1091 found that the problems it then ships are visual: text
running into the next element, a title cut off at the slide edge, a pale
subtitle on a pale cover. The review of #1090 caught one of those by hand
(the Workshop cover's white subtitle on light cyan, 2.7:1).

This adds the cheap, deterministic half of a visual QA lane:

- **`layoutReport(doc)`** — per element: world box, on-slide fraction, and
  for text the line count, laid-out height, box height, shrink scale and
  whether it overflows. Computed in Node on the same docs layout engine the
  canvas renderer uses; no browser.
- **`lintSlides(doc): Finding[]`** — six rules, one file each, over the
  same model and layout:
  `{ rule, severity, slideId, slideIndex, elementId?, text?, message }`.
- **CLI**: `wafflebase slides layout-report` and `wafflebase slides lint`,
  on a document (`<doc-id>`) or a local deck (`--file x.pptx|x.json`).
- **Seed regression gate**: every slides template in the gallery catalogue
  is linted in the backend test suite against a short, reasoned baseline.
- **Offline PNG render** (`pnpm frontend render:slides <deck.json> --out
  dir`): the opt-in final check, painting each slide with the editor's own
  `renderSlideCanvas` in headless Chromium. No backend, no login — the
  complement of `slides render <doc-id>`, which drives the live editor.

### Goals

- Catch the visual defects blind authoring produces, before a human looks.
- Be deterministic and fast enough to run on every authoring pass and in CI.
- Keep findings advisory: a rule reports what is likely wrong; intent is
  recorded, with a reason, in an allowlist.

### Non-Goals

- A vision-model checker. It may come later on top of the PNGs; the
  linter is the part that can be a test.
- Replacing the screenshot-free `hunt-ui` hunter. This lane is additive.
- Pixel-exact text measurement in Node (see Risks).

## Proposal Details

### Where it lives

`packages/slides/src/lint/` — pure and Node-safe, exported from both the
browser and the `node` entry:

| File | Role |
| --- | --- |
| `context.ts` | Deck context (theme, slide size, deck font scale, measurer), element placement with world boxes (group children composed), text layout mirroring the canvas painter, ink boxes |
| `layout-report.ts` | `layoutReport` |
| `estimate-measurer.ts` | Font-free width estimate for Node |
| `color.ts` | CSS color parsing, alpha compositing, WCAG ratio |
| `rules/*.ts` | One rule per file |
| `index.ts` | `lintSlides`, `applyAllowlist` |

### Text is measured by its ink, not its frame

The first version judged text by its frame. On the 2026 OSSCA deck (a real
PPTX import, 26 slides) and the 19 seed templates, that produced mostly
false positives: wide, centered title frames "overlapping" each other or
hanging off the slide while their text sat well inside, a subtitle frame
reaching down over a bar label it never touched. So text geometry comes
from the layout itself:

- Horizontally, the extent of the laid-out runs (alignment applied).
- Vertically, each line's em box (`maxFontSizePx`), not its line box: the
  leading a line-height multiplier adds is empty, and counting it made two
  closely stacked legend lines collide.
- Placement follows the canvas `computeVerticalOriginY`: text taller than
  its box overflows down (top anchor), both ways (middle) or up (bottom).
- A text element that paints a fill or border covers its frame too.
- Shape text lays out inside the OOXML preset text rectangle (an
  ellipse's is ~15% in from each side), as the canvas `shapeTextInset`
  does; group children are sized by the group's scale.

### The rules

| Rule | Reports | Severity |
| --- | --- | --- |
| `overflow` | `shrink` text taller than its box even at the minimum scale; `none` text with at least one whole line outside its box (a box merely shorter than its single line's line-height is fine) | error / warning |
| `out-of-bounds` | Text, tables or charts past the slide edge (text by ink, so a frame hanging off around centered text is fine and text grown past the bottom is caught). A text-less shape or image only when entirely off the slide | warning (error when entirely off) / info |
| `overlap` | Two elements, at least one with text, whose painted regions intersect by ≥ 15% of the smaller. Excludes backgrounds (≥ 80% of the slide), thin decoration (≤ 24 px), a text-less shape enclosing the other (cards), elements that paint nothing. An image counts only when the text's center lies within its inner 80%: its frame includes transparent padding we cannot see. Group children are checked at their world position | warning |
| `contrast` | WCAG 2 AA: 4.5:1, or 3:1 for large text (18 pt, 14 pt bold). Backdrop at three points across the text: own fill, then filled shapes / text boxes beneath (alpha-composited), then the slide background (slide → layout → master). A gradient counts as its worst stop. An image, table, chart or background image underneath makes the point unknown — skipped, never guessed | error below 3:1, else warning |
| `min-font` | Text rendering below 12 slide points (9 for footer-like text) | error below 75% of the minimum, else warning |
| `edge-margin` | Text ink within 0.5 in of an edge; footer-like text (a short element in the bottom 0.9 in) exempt | info |

**Slide points.** The canvas is 1920 px wide for every deck, which the
product treats as a 13.333-inch widescreen slide (2 px per point). Stored
font sizes are docs points at 96 DPI, scaled by the deck's PPTX pre-scale
(`pxPerPt`) and shrink-autofit. Rules convert to the size a viewer sees on
that widescreen slide, so an imported deck and an in-app deck are judged by
the same yardstick rather than by the number in the toolbar.

### Allowlist

`AllowlistEntry = { rule, slideId, elementId? | text?, reason }`. An entry
matches rule + slide, then the element by id, or by a prefix of its text
(the handle for a deck re-imported from PPTX, whose element ids are
regenerated on every import), or any element on the slide. `reason` is
required. `applyAllowlist` returns `{ open, allowed, unused }` so a stale
entry is visible.

### Seed regression gate

`packages/backend/src/template/seed/lint.spec.ts` lints every slides
template and fails on any non-`info` finding not in `lint-baseline.ts`, and
on a baseline entry that no longer matches. Keys are template slug + slide
number + rule + element text: seed slide ids come from a module-wide counter
and element ids are random, so neither survives a catalogue edit. The two
entries today are known defects, labelled as such, not design decisions.
Reverting the Workshop cover to its pre-#1090 `block` preset fails the gate
on exactly the two elements the review flagged.

### CLI

```bash
wafflebase slides layout-report <doc-id> [--slide N]
wafflebase slides lint <doc-id> [--rules contrast,overlap] [--allowlist a.json] [--fail-on error]
wafflebase slides lint --file deck.pptx      # or deck.json; no server needed
```

`lint` exits 0 by default (advisory); `--fail-on <severity>` turns it into
a gate. `layout-report` is named so because `slides layout` is already an
alias of `slides layouts` (the deck's layout ids).

### The authoring loop

author → `layout-report` + `lint` → fix, or record intent in the allowlist
→ PNG render as the final check → any new visual-only problem becomes a
rule candidate. The deck-author skill update is a separate change.

## Risks and Mitigation

- **Node line breaks are estimated.** With no Canvas, widths come from
  `estimateMeasurer`, calibrated against Chromium's `measureText`
  (lowercase Latin 0.5 em, capitals 0.68, digits 0.56, space 0.28, wide
  CJK/Hangul 0.95). Against the browser's own measurer it matched the line
  count of all 346 text elements in the seed templates and the 2026 deck; on
  a wrap stress set (English and Korean paragraphs, 5 widths × 4 sizes) it
  matched 42 of 60 and was off only by over-counting. It errs toward
  reporting an overflow that is not there, which the PNG check settles.
  Callers with a real measurer (Canvas in the browser, fontkit with the
  deck's fonts) pass it as `measurer`.
- **Image pixels are unknown.** Contrast skips text over images; overlap
  ignores text beside an image. The PNG render is the check for both.
- **Not covered yet:** text in table cells (contrast, min-font). Rotated
  elements — and children of a rotated group — are judged by their
  axis-aligned box. Contrast samples three points across the whole text,
  so a run sitting only on a small chip is also judged against the
  backdrop beside it.
- **Thresholds** (15% overlap, 0.5 in margin, 12 pt) are defaults, each an
  option, chosen on the decks above. Tune them only with a deck that shows
  why.
