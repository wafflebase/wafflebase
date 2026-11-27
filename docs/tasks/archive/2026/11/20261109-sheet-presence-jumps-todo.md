# Sheet Presence Jumps — Task Tracking

Design doc: [axis-id-selection.md](../../design/sheets/axis-id-selection.md)

Peer cursors on a busy sheet (six editors in a sprint-planning document)
were seen jumping around. Instrumenting the live document and reproducing
in a fresh sheet with two clients pinned two causes:

1. Deleting the row (or column) under a cursor sends that cursor to A1 —
   both the deleter's own cursor (deleting from the row header always
   selects the row first) and any peer's cursor on that row. Peers see it
   fly to A1 and back.
2. Switching tabs changes only `activeTabId`. The previous tab's
   `selection` / `activeCell` stay in presence until the user next moves,
   so peers on the new tab see the cursor either vanish (the old anchor's
   axis IDs do not exist on this tab) or sit on the old tab's cell.

A third pattern — presence arriving in ~1 s bursts from some clients — is
sender-side timer throttling and out of scope here.

## Tasks

- [x] Keep the cursor at its visual position on the deleted axis instead of
      snapping to A1 (`Sheet.resolveAnchorsToRefs`)
- [x] Publish the initial selection when a tab's `Spreadsheet` mounts
      (`Spreadsheet.initialize`)
- [x] Tests for both
- [x] Update "Deleted Axis ID Handling" in axis-id-selection.md
- [x] `pnpm verify:fast`
