# Lessons — sheets drag-move grab point

- A fixed "grab offset" point (a cell's centre) only reproduces Excel's feel
  when cells are uniform. With variable sizes the lag equals half the
  anchor cell's size; carry the point the user actually pressed.
- Tests that only measure *travel* can feed coordinates that ignore the
  headers and still pass. Once the absolute press position matters, the
  helpers must add `RowHeaderWidth` / `DefaultCellHeight` — and a stale
  geometry comment is a hint the coordinates were never absolute.

## Self-review log
