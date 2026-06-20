# Lessons: table cell paste across a merged region

## What broke

Table cell copy/paste preserved merge span metadata (`colSpan`/`rowSpan`,
including `colSpan: 0` covered markers) verbatim. The layout trusts a grid
invariant — anchor spans match in-bounds `colSpan: 0` covered cells — and
paste silently violated it (orphaned covered cells, anchors overrunning the
grid). Only edge clamping existed; no structural repair.

## Lessons

- **When data carries a structural invariant, every mutation path that copies
  it must re-establish that invariant, not just clamp indices.** `pasteTableCells`
  clamped loop bounds but trusted the copied spans. The merged-cell grid is an
  invariant (anchor ⇔ covered cells, in bounds); copy/paste is a mutation path
  that broke it.
- **Repair at the destination, in one helper, beats sanitizing N sources.**
  There are several paste sources (internal payload, HTML, markdown) and two
  consumers (Docs, Slides). A single `normalizeTableMerges(td)` after the write
  covers all of them and also handles destination merges that straddle the
  paste boundary.
- **Reproduce the data flow before asserting a cause.** The private
  `getSelectedTableCells` / `pasteTableCells` weren't unit-reachable, so I
  mirrored their exact logic on a real merged table to produce the broken grids
  and confirmed the invariant violation empirically before writing any fix.
- **Slides reuses the Docs engine for table cell text** — a fix in the Docs
  `TextEditor` paste path automatically covers Slides table cells. Worth
  checking the shared engine before assuming a bug is package-local.
