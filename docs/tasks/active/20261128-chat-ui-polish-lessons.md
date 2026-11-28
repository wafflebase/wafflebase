# Chat UI Polish — Lessons

- An `invisible` element still takes its width. The hint was hidden until
  the box had text but kept half the footer row, so the checkbox label
  wrapped even when nothing showed beside it. Hide by `display`, keyed to
  the space actually available.
- Chat columns are sized by the layout, not the viewport: the same composer
  is 700px on the Chat page, ~310px in a thread and ~250px in the editor
  panel. A `md:` breakpoint says nothing about any of them; container
  queries (`@container/<name>`) do.
- A toolbar that rides over its row's top edge needs room above the first
  row of a scroller, or `overflow` clips it.

## Self-review rounds
- Round 1: correctness (major) — the caret-to-end effect did not re-run
  when a draft arrives after mount (user resolves late). Added `draftSwaps`
  to its deps, plus two composer tests; the mount one fails without the fix.
  Minor (not blocking): toolbar still clipped by `pt-1` — the row's own
  `mt-2` adds 8px, and the toolbar was checked fully visible in the browser.
