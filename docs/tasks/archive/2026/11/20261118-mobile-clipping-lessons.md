# iPhone 16 clipping — lessons

- **Measure at the visible viewport, not the screen.** iPhone 16 Safari shows
  ~393×659 with toolbars; 100vh is the *large* viewport (~760px). Anything
  sized in `vh`/`h-screen` hides its bottom row on iOS while Chromium at 659
  looks fine — emulate the iOS value to see it.
- **A shared primitive's missing cap is everyone's bug.** `DialogContent`
  centred with a translate and no `max-h` cut every tall dialog top *and*
  bottom; fix the primitive, not each caller.
- **Grid children default to `min-width:auto`.** One nowrap row inside a
  `grid` dialog widened the whole dialog past its `max-w`; `[&>*]:min-w-0`
  restores the cap.
- **Real right-clicks in audits mutate state.** Playwright's right-click
  released over a menu item and fired it (inserted a column, duplicated a
  tab). Open context menus with a dispatched `contextmenu` event.
- **Parallel agents in one checkout work with disjoint file ownership.** Four
  fix agents shared a working tree without conflicts because each owned an
  explicit file list and nobody committed until the lead integrated.
