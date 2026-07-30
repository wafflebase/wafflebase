# Lessons — Docs "Edit link" in place (#494)

- **A helper extracted from one call site inherits that site's blind
  spots.** `removeLink`'s run walk was "correct" only because a
  zero-width match made `removeLink` a harmless no-op; reused for
  `insertLink`, the same match silently swallowed the Apply action.
  When promoting inline logic to a shared helper, re-derive its edge
  cases against *each* new caller, not just the original one.
- **`normalizeInlines` keeps the emptied run's style.** A fully-emptied
  paragraph retains `inlines[0].style` — including `href` — so
  "empty block" is not the same state as "no formatting". Any feature
  that keys off inline style at the caret (link popover, pending
  style, style summaries) must decide explicitly what a zero-width
  styled residue means for it.
- **Boundary tie-breaks must be owned by one function.** `removeLink`
  (last match) and `getLinkAtCursor` (first match) disagreed at the
  boundary between two adjacent links, so the popover could show link A
  while Apply/Remove targeted link B. Detection and mutation now share
  `findLinkRunAt`; the popover's display source is the contract.
- **The adversarial-review step earns its cost.** The zero-width-run
  regression passed the full suite (1136 tests) and a green
  `verify:fast`; it was found only by a review agent explicitly told to
  refute the change, which reproduced it through the real delete path.
