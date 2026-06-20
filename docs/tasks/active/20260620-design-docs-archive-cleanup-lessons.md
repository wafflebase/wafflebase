# Design docs archive cleanup — Lessons

## Read the whole doc before classifying it for archive/merge

Two parallel-agent recommendations were wrong on a skim:
- `context-menu.md` looked like a single-PR note, but a cross-reference
  grep showed **6 active docs cite it as the canonical shared menu pattern**.
  Cross-reference count is a strong signal of a load-bearing reference.
- `slides-layout-change.md` reads as a "UI" doc from its title, but the body
  defines the `placeholderRef` data model + `applyLayoutToSlide` algorithm +
  ghost-text rendering. Title ≠ surface; read the Proposal Details.

**Rule:** before archiving/merging a doc, (1) grep for inbound references —
many = load-bearing, and (2) confirm the successor actually covers the same
surface (grep the successor for the unique symbols). A merge that loses an
algorithm/model is laziness, not cleanup.

## Archive vs delete is a real distinction

Per `archive/README.md`: shipped single-PR notes whose content is NOT absorbed
elsewhere → `git mv` to archive/ (history + discoverability). Content that IS
folded into a successor → delete (git log points back). Don't archive a doc
you just merged — that double-counts it.

## Fix relative links after a move

Moving `slides/foo.md` → `archive/foo.md` breaks every `](foo.md)` and
`](./foo.md)` inbound link (now needs `../archive/foo.md`). Grep for the
basename across `docs/design`, fix each, then verify every link resolves with
a small shell loop before claiming done.
