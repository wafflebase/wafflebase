**Created**: 2026-11-25

# Sheets: pin "the first tab is selected on first load" (#1196)

## Problem

Issue #1196 reports that opening a spreadsheet with several tabs selects the
**rightmost** tab instead of `tabOrder[0]`. The issue names the two surfaces to
check (`resolveActiveTabId`, the `setActiveTabId` calls in `document-detail.tsx`)
and asks for a test that opens a multi-tab document and asserts `tabOrder[0]` is
active.

## Acceptance criteria

- [ ] The first tab in the tab bar (leftmost, `tabOrder[0]`) is selected when a
      multi-tab document is opened.
- [ ] A test opens a multi-tab document and asserts `tabOrder[0]` is active.

## Investigation

Every writer of `activeTabId` on the authenticated sheet route was read:

| line | writer | runs on load? |
| ---- | ------ | ------------- |
| 173 | `handleUndoJump` | no — undo callback |
| 263 | pending XLSX import | only with a pending import, and it picks `pending.tabOrder[0]` |
| 340 | comment jump | no |
| 359 | `resolveActiveTabId` effect | **yes** — picks the first `tabOrder` entry with metadata |
| 413/447/473/489 | add tab | no |
| 563 | delete tab | no |
| 664 | duplicate tab | no |
| 701 | jump to peer | no |
| 874 | `TabBar onSelectTab` | no — user click |

`DocumentLayout` has six effects (137, 239, 245, 288, 352, 363); only 245 and
352 touch the active tab and both resolve to the first tab. `TabBar` marks
`tab.id === activeTabId` and renders in `tabOrder` order, so the highlight
cannot disagree with the selection. Yorkie's `initialRoot` is applied per
top-level key on attach and all three keys exist on a saved workbook, so no
seeding runs either. `SharedDocumentLayout` resolves `tabs[0]` the same way.

Conclusion: the selection logic already yields `tabOrder[0]`, and no reachable
path selects the last tab. What *is* missing is executable coverage — nothing
asserted which tab a multi-tab document opens on, so the behaviour was free to
regress. The issue asks for exactly that test.

## Plan

- [ ] Render the real sheet route against a three-tab fake Yorkie document and
      assert the leftmost tab is `aria-selected` and is the tab handed to the
      grid.
- [ ] Cover the shared (share-link) route's own resolution the same way.
- [ ] Keep `resolveActiveTabId`'s own unit coverage for the
      selected-tab-disappears case.

## Non-goals

- Changing which tab is selected (it is already the first).
- Scrolling the active tab into view when a workbook has more tabs than fit —
  real, adjacent, and not what this issue asks for.
