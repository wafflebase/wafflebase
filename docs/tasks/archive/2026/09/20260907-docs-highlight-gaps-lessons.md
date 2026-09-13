# Lessons — Docs highlight background gaps (#1036)

- Rounding one edge of a rect and not the other is the whole bug: the
  fix is not "round less", it is to round **both** edges with the same
  expression a neighbour will use, so `round(x + w)` is literally the
  next rect's left edge. `table-renderer.ts` rounded neither and was
  already continuous, which is what made the seam look like a docs-only
  defect.

- The per-run background was painted twice on the slides path:
  `paintLayout` ran the layout-wide sweep *and* passed
  `skipRunBackgrounds: false` down to `renderRun`, which painted its own
  fill. Invisible with opaque colours, so it survived. Coalescing would
  have made it visible (band painted once, words painted twice), which
  is why the double paint had to go with the same change.

- Zero-width `'\n'` runs sit inside lines to keep cursor offsets
  continuous. Any per-run sweep has to decide explicitly whether they
  extend, split, or are ignored by a span — `renderRun` early-returns on
  them, but the background sweeps did not.
