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
