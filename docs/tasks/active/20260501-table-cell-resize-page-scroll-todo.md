---
title: Cell resize on page 2 with cursor on page 1 scrolls back to page 1
date: 2026-05-01
status: not-started
parent: 20260501-table-resize-row-split (archived)
---

# Cell resize on page 2 scrolls back to page 1 when caret is on page 1

## Symptom

Split out from `20260501-table-resize-row-split` after the row-resize
guideline fix shipped in #172.

When the text caret is positioned on page 1 and the user starts a
cell-border resize drag on page 2, the viewport snaps back to page 1
during the drag. The drag itself appears to apply, but the user loses
their scroll position.

## Hypothesis

Likely a side effect of caret-driven scroll restoration kicking in
during the resize drag. The caret position belongs to page 1, and some
post-edit pass calls `ensureCaretVisible()` (or equivalent) which
overrides the scroll the user established by scrolling to page 2.

## Tasks

- [ ] Reproduce on a multi-page document with a table on page 2
- [ ] Identify whether scroll restore happens on `mousedown`,
      `mousemove`, or `mouseup` of the resize drag
- [ ] Decide policy: drag should suppress caret-based scroll restore,
      or resize commit should not move the caret
- [ ] Apply fix and verify scroll position is preserved
- [ ] Run `pnpm verify:fast`
