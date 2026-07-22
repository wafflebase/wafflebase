# Lessons — De-duplicate the line baseline formula

## What broke

Nothing new broke — this is the structural fix for *why* the #507 bug was
possible. The baseline formula lived in six copies across `paint-layout`,
`table-renderer`, and `pdf-painter`, each with a comment like "matching
doc-canvas's body path." Hand-synced duplication drifts; #507 was one copy
being fixed while the others kept the old per-run behaviour.

## Lessons

- **Fix the duplication, not just the instances.** The reviewer could have
  asked for the same three-line change pasted into two more files. Extracting
  `lineBaselineY` means the next baseline change happens once, and the
  "matching X" comments (which were load-bearing documentation of an invariant
  the compiler didn't enforce) become an actual shared function.

- **A shared helper must respect the callers' real differences.** The canvas
  paths `Math.round` the baseline to hit the pixel grid; the PDF path
  deliberately does not (continuous coords, rounding drifts between pages).
  The helper returns the raw value and lets each caller decide — collapsing
  the formula without collapsing that intentional difference.

- **Separate "which font sizes the glyph" from "which font positions the
  line."** For list markers the two had been the same value. The fix keeps the
  marker drawn at its own size but positions its baseline from the line max —
  a distinction that only surfaces when a marker sits beside a taller run.

- **The earlier PR's data model paid off here for free.** `LayoutLine`
  `maxFontSizePx` already reached table and PDF because they render the same
  `LayoutLine` objects. The follow-up touched only painters — a sign the #507
  field was placed at the right layer.

- **Refactors need regression guards more than new assertions.** The value was
  the existing table/PDF suites staying green (proving uniform content is
  unchanged) plus a pure-function test pinning the formula and its unrounded
  contract — not a large pile of new behavioural tests.
