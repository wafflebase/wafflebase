---
title: Docs editor improvements
created: 2026-03-25
status: done
---

# Docs Editor Improvements

## Tasks

- [x] Fix SidebarInset viewport shrink — add `min-w-0` so flex item shrinks below canvas min-content
- [x] Fix Korean word jump — remove Hangul from CJK category so Option+Arrow treats Korean as space-delimited words
- [x] Fix Arrow Up/Down on first/last line — move cursor to line start/end at document boundaries
- [x] Implement remote peer selection highlighting — show peer text selection ranges in collaborative editor
- [x] Create deferred task for arrow pixel accuracy fix

## Review

All changes verified with `pnpm verify:fast` (lint + unit tests pass).
Browser-tested docs editor renders correctly with peer cursors and selections.
