---
title: Cell resize on page 2 with cursor on page 1 scrolls back to page 1
date: 2026-05-01
status: obsolete
parent: 20260501-table-resize-row-split (archived)
---

# Cell resize on page 2 scrolls back to page 1 when caret is on page 1

## Resolution

Already fixed by PR #172 (`888d1ad1`). When this task was split out we
assumed #172 only covered the row-resize guideline, but the same PR
also routed `applyBorderDrag` through a new `requestRenderNoCursorScroll`
path so cell-border drags no longer trigger caret-driven scroll
restoration. Verified in current code: `text-editor.ts:1281`
(`applyBorderDrag`) calls `requestRenderNoCursorScroll` at line 1317,
wired up from `editor.ts:1219`. No further work needed.

## Symptom (historical)

Split out from `20260501-table-resize-row-split` after the row-resize
guideline fix shipped in #172.

When the text caret is positioned on page 1 and the user starts a
cell-border resize drag on page 2, the viewport snaps back to page 1
during the drag. The drag itself appears to apply, but the user loses
their scroll position.

## Tasks

- [x] Reproduce on a multi-page document with a table on page 2 —
      already fixed in #172, no repro needed
- [x] Identify whether scroll restore happens on `mousedown`,
      `mousemove`, or `mouseup` of the resize drag — #172 traced to
      `applyBorderDrag` using the cursor-scrolling render path
- [x] Decide policy: drag should suppress caret-based scroll restore,
      or resize commit should not move the caret — #172 chose the
      former via `requestRenderNoCursorScroll`
- [x] Apply fix and verify scroll position is preserved — shipped
      in #172
- [x] Run `pnpm verify:fast` — covered by #172's pre-merge gate
