# Lessons — Mixed font-size runs share a common baseline

## What broke

On a line with runs of different font sizes, smaller glyphs floated upward
instead of sharing a baseline (Google Docs aligns them along the bottom).
`renderRun`'s baseline formula `lineY + (lineHeight + fontSizePx * 0.8) / 2`
mixed a **line-wide** term (`lineHeight`, sized to the tallest run) with a
**per-run** ascent term (`originalFontSizePx * 0.8`). The two references
disagreed, so each run centered on its own size and landed on a different
baseline.

## Lessons

- **When a formula mixes a line-wide term with a per-run term, suspect the
  mismatch.** The bug wasn't a wrong constant — `lineHeight` was already
  line-wide and correct. The defect was that the *ascent* half of the same
  expression used the run's own size. Fix = make both halves share one
  reference (the line's max font size), not tweak the multiplier.

- **The value you need is often already computed and thrown away.**
  `assignLineHeights` already called `getLineMaxFontSizePx` to size the line,
  then discarded it. Persisting it on `LayoutLine.maxFontSizePx` (one
  assignment) was cheaper and safer than recomputing in the painter, and gave
  every call site one shared source of truth.

- **Render formulas are copy-pasted across paint paths — grep before scoping.**
  The identical baseline expression lives in `paint-layout.ts` (screen),
  `table-renderer.ts` (table cells), and `export/pdf-painter.ts` (PDF). Fixing
  only the screen painter leaves tables and PDF export still floating. We
  scoped this PR to the screen painter deliberately and tracked the twins as a
  follow-up in the todo — but the trap is assuming one fix covers all.

- **Slides shares the docs painter, so a docs fix propagates for free — but
  test it.** Slides text boxes render through docs' `paintLayout`/`renderRun`,
  so this fix reached slides with no slides-side change. That cuts both ways:
  always run `@wafflebase/slides` tests when touching docs rendering, because
  slides is an invisible downstream consumer.

- **Canvas paint math is testable without a real canvas.** jsdom has no
  `getContext`, but `renderRun` takes the ctx as an argument — inject a mock
  that records the `y` passed to `fillText` and assert on the baseline
  directly. This caught the fix at the pixel level, not just "the field is
  populated."

- **Make the new param optional with a fallback to keep uniform lines
  byte-identical.** `lineMaxFontSizePx ?? originalFontSizePx` means a line with
  one size renders exactly as before (regression guard test locks this in),
  and the optional `LayoutLine.maxFontSizePx` field avoided editing the ~6
  inline-constructed non-text line literals (table/HR/empty).
