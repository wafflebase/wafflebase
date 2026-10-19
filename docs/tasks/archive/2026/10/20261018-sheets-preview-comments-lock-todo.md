# Sheets: lock comments during a revision preview (#1094)

## Problem

Opening a revision preview on a sheet leaves the comments UI live, and
everything done there writes to the **current** document behind the preview:

1. `CommentSidePanel` is rendered as a sibling of `PreviewSurface` in
   `document-detail.tsx`, so the preview never covers it. Clicking a thread
   jumps the live grid.
2. That jump opens `SheetView`'s `CommentPopover`, which is `z-30` inside the
   `PreviewSurface` while the overlay is `z-20` — so covering does not contain
   it. It paints above the preview with Reply / Resolve / Edit / Delete, all of
   which `doc.update()` the live root.

Docs already applies the rule `preview-surface.tsx` states ("while a preview is
open, no editing control is both rendered and reachable") by withholding the
panel with `commentsPanelOpen && !previewing` (#1017). Sheets never did.

## Plan

- [x] `document-detail.tsx`: derive a single `previewing` flag
      (`Boolean(previewRevisionId && currentUser)`) and drive the overlay from
      it, matching `docs-detail.tsx`.
- [x] Withhold the side panel with `commentsPanelOpen && !previewing`. The
      user's toggle state is untouched, so closing the preview restores it.
- [x] Pass `previewing` into `SheetView` and gate the popover on it: the
      popover and its two position effects key off one
      `commentPopoverVisible = commentPopoverOpen && !previewing` value, so a
      popover already open when the preview opens disappears and re-measures
      its position when the preview closes.
- [x] Tests: extend `components/history/__tests__/preview-surface.test.tsx`
      with the source-level containment assertions for the comment surfaces
      (panel withheld in both docs and sheets, popover gated in `sheet-view`),
      plus a rendering test for the `SheetView` popover gate if it can be
      mounted cheaply.

## Out of scope

- The share-link view (`shared-document.tsx`) mounts no revision preview.
- Docs' own behaviour, which already matches.

## Acceptance criteria (from the issue)

- Neither the comments panel nor the comment popover renders while a preview
  is open.
- The panel comes back when the preview closes.

## Review (ticked at archive, 2026-10-19)

Shipped in #1099 (merged 2026-10-19). Each box was checked against `main`, not assumed from the merge.
