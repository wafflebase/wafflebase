# Template Design Polish — Lessons

Todo: [20261121-template-design-polish-todo.md](./20261121-template-design-polish-todo.md)

## Lessons

- **Thumbnails captured during the first gallery registration (2026-11-20)
  came from a dark-mode browser.** Docs, boards and sheets carried the
  publisher's theme into the card. Capture must not depend on the viewer.
- **Two lanes reported the same out-of-scope bug** (board section titles
  cut to an ellipsis). Shared-file bugs surface in lane reports' "out of
  scope" lists. The coordinator should read those lists and fix the bug
  once, with a test, rather than let each lane work around it.
- **Reviewers found what implementers missed by rendering:** a freeze-pane
  band in every sheet thumbnail, 6px board section pills, and a seam that
  survived "paint it under the circle". Keep a render-based reviewer per
  lane.

## Self review

- Round 1: four blocking findings, all fixed. (1) The sheet thumbnail waited
  on two `requestAnimationFrame`s with no bound, so a publish in a hidden tab
  hung with the offscreen engine mounted → `waitForPaint(500)`. (2) It
  unwrapped the Yorkie worksheet with `toJS()` unlike everything else →
  `yorkiePlain` (`toJSON()`), so the engine never holds live CRDT objects.
  (3) The pipeline was untestable inside the view → pure
  `prepareSheetThumbnail` / `waitForPaint` in `sheet-thumbnail.ts` with
  tests. (4) The frame-crop test used a (0,0) container → a test with the
  host parked off-screen.
- **`visual:update` rewrites every baseline.** Most rewrites are within
  tolerance; keep only the ones the check run listed as mismatched.
- `verify-hunt-oracles` failed once in the Docker lane on a slides drag
  (badge landed at y=718, aimed at 800) and passed 2/2 run locally; the
  badge is a fixed-frame shape, so the master font change cannot move it.
  Treated as a lane flake; CI's verify-browser is the arbiter.
- Round 2: one blocking finding (blast-radius), fixed. PPTX imports cloned
  the raised `DEFAULT_MASTER` table, but an imported deck paints a point at
  2 px/pt (physical), so placeholders a file leaves unsized would have drawn
  1.5x larger than PowerPoint does. The importer now starts from its own
  physical table (OOXML's 18pt body), including the no-master fallback.
  **A default that is scaled for one unit system must not be shared with a
  path that runs in another.**
- Round 3 (the bound): two blocking correctness findings on the sheet
  thumbnail, both real. (1) Two animation frames do not mean the grid is
  painted: the engine's `render()` only schedules a frame and the paint
  behind it is async. A synchronous `render()` + capture, tried as the fix,
  produced a **blank** image — verified by capturing, not assumed. The fix
  waits for the engine's own completed-render signal
  (`onSelectionChange`, fired after every render) with a 3s bound, and
  publishes without a picture on timeout instead of with a blank one.
  (2) The offscreen read-only engine adds document-level keyboard/pointer
  listeners while mounted; bounding the wait to one completed render (and
  unmounting in `finally`) keeps that window to the mount plus one paint.
  Loop stopped at the bound; round 4 is a human's call.
