# Chat UI critique fixes — lessons

- **Parallel agents need file ownership and named seams.** Three agents
  edited the chat UI at once without conflict because each owned a disjoint
  file set, and every cross-file contract was named up front: the composer's
  `onArrowUpWhenEmpty` prop, the `useMentionAutocomplete` API for the edit
  box, and the `data-thread-link` hook the page uses to return focus after
  Esc. The one seam left implicit (finding the replies button by its text)
  was the one that needed a fix-up.
- **`role="log"` is a live region.** Putting it on a scroller that loads
  history makes a screen reader read whole pages; announce arrivals from a
  separate sr-only region instead.
- **Decide the failure owner once.** Optimistic send could recover in the
  composer (restore text on throw) or on the row (Retry). Doing both doubles
  the recovery path; the row owns it and `onSend` resolves.
- **A one-off vitest failure under parallel load did not reproduce** in nine
  reruns; rerun before chasing it.

## Self-review rounds

(logged below)
