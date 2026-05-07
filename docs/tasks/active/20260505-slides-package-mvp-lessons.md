# Slides Package (v1 MVP) — Lessons

Captured corrections and validated approaches during this task. Append
new entries as work progresses.

## Brainstorming session (2026-05-05)

### "Yorkie store lives in frontend, not the domain package"
- **Pattern:** Domain packages (`sheets`, `docs`) intentionally have no
  Yorkie/React dependency. Yorkie adapters live in
  `packages/frontend/src/app/<package>/yorkie-*.ts`.
- **Why:** Keeps the engine usable from CLI, tests, and future
  non-browser hosts. Reused initially-incorrect placement was caught
  during design review.
- **How to apply:** `packages/slides` has only `MemSlidesStore`; the
  Yorkie adapter is `packages/frontend/src/app/slides/yorkie-slides-store.ts`.

### "Properties live in the top contextual toolbar, not a fixed right panel"
- **Pattern:** Google Slides puts contextual property editing in a
  selection-driven top toolbar; the right side is reserved for
  on-demand panels (Format options, Themes).
- **Why:** Default view should be "two-pane" (thumbs + canvas) with
  maximum canvas area. A fixed right panel is unnecessary for the v1
  surface.
- **How to apply:** v1 toolbar carries text/shape/image/slide
  properties. Right-side Format options panel deferred to v2.

### "v1 must cover the day-one keyboard / editing affordances Google Slides users reach for reflexively"
- **Pattern:** Slide duplicate (Cmd+D), element copy/paste/cut,
  arrow-key nudge, z-order shortcuts, right-click context menu, lasso
  select, multi-slide selection, and per-slide speaker-notes data are
  all *table stakes*, even though none of them are needed to render a
  single slide.
- **Why:** The spec originally listed only `addSlide` /
  `updateElementFrame` etc. — store-level primitives but no editor
  affordances. A user opening v1 without Cmd+D or Cmd+C would not
  recognize it as "Google Slides-shaped" no matter how good the
  rendering is. Identified during a side-by-side comparison with the
  Google Slides feature set.
- **How to apply:** When designing any package that has a clear
  reference product, audit the day-one keyboard / context-menu /
  duplicate flows of that reference *before* freezing scope, not
  after. Treat them as part of the MVP, not as polish.

### "State the gap to the reference product as an explicit, ongoing goal"
- **Pattern:** v1 of slides is a slice of Google Slides, not a clone.
  The spec now contains a "Future parity with Google Slides" section
  listing v1.1 / v2 / not-currently-planned items, with a note that
  closing items off the list updates both that section and the
  matching Non-Goals entry.
- **Why:** Without a tracked gap list, deferred items quietly die. The
  goal is to *close* the gap, not just to ship v1.
- **How to apply:** Any future slides PR that lands a parity item
  should remove it from "Future parity" and from Non-Goals in the
  same commit.
