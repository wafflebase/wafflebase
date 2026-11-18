# Board sticky + stamp polish — lessons

- A sticky has no stroke, so "the border is too big" meant the `roundRect`
  default radius plus the preset's built-in text rect. Read the shape's
  adjustments and `SHAPE_TEXT_RECTS` before assuming a stroke.
- `shapeTextInset` adds the preset text rect *on top of* `text.inset`, so a
  target margin has to subtract the rect (~4.9% per side for `roundRect`).
- Filling a preset default on read is safe only for the kind that defines it:
  `adjustments[0]` is a corner radius on `roundRect` and something else on
  other kinds, and a marked sticky can be reshaped.
- A stamp node animates on creation, which also happens on board load and on
  un-hiding a section; gate the pop on how recent `stamp.at` is.
- The ritual layer is a later, unstacked sibling of the editor container, so
  it painted over the editor's DOM selection handles: a stamp on a corner hid
  the resize handle. Annotations belong under selection chrome — give the
  overlay a z-index rather than reordering DOM.
- `Button`/`Toggle` carry `[&_svg:not([class*='size-'])]:size-4`, which beats
  an SVG's width/height attributes — an icon that must not be 16px needs a
  `size-*` class or an inline style. It hid the stamp-badge sizing bug twice:
  first forcing the glyph too big, then (once fixed) exposing that the
  computed size was too small at menu scale.
- Worktree agents (`isolation: worktree`) start from `main`, not the current
  branch. Tell them to reset to the branch tip first, or merge their diff
  with `git apply --3way` and expect conflicts.
- A test file that empties `document.body` in `afterEach` must `cleanup()`
  first, or React and any open Radix portal remove nodes that are gone.
- Self-review round 1: blocked on two read-path crashes from peer-written CRDT data — an unknown `stamp.kind` indexed `STAMP_ART` every frame, and `withStickyDefaults` dereferenced a null `text`. Fixed both at the read boundary (`stampsByElement` drops undrawable stamps; `text` must be a non-null object) with tests.
