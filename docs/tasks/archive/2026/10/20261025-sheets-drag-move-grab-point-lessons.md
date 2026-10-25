# Lessons — sheets drag-move grab point

- A fixed "grab offset" point (a cell's centre) only reproduces Excel's feel
  when cells are uniform. With variable sizes the lag equals half the
  anchor cell's size; carry the point the user actually pressed.
- Tests that only measure *travel* can feed coordinates that ignore the
  headers and still pass. Once the absolute press position matters, the
  helpers must add `RowHeaderWidth` / `DefaultCellHeight` — and a stale
  geometry comment is a hint the coordinates were never absolute.

## Self-review log
- Round 1 (correctness/tests): no blocking findings. Fixed minors anyway —
  clamp inset now divided by zoom (hit band is CSS px, clamp is sheet px);
  press point reused from `beginSheetTravel` instead of recomputed; stale
  `snapToVisible`/`carryPoint` comments and two design-doc sentences; added
  direct `carryRange` tests (edge step, inset cap, hidden-row snap, fully
  hidden span). Not changed: the "minimum drag always steps one cell"
  finding is the intended behaviour change (PR body); `finishEditing`
  resizing the grid before the press is read is consistent — both the grab
  point and the travel origin are taken after it.
