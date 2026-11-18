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
