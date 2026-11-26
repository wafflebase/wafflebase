**Created**: 2026-11-25

# Lessons — Sheets: first tab on load (#1196)

## What the bug report asked vs. what the code does

The report asserted a symptom ("the rightmost tab is selected") and then
hedged with a hypothesis ("something else probably sets the active tab during
load … or the tab bar scrolls to the end so the selection looks wrong"). The
hedge was the useful part: reading every writer of `activeTabId` showed none of
them runs on load except the one that resolves `tabOrder[0]`, and the tab bar
has no scroll-on-mount at all.

So the deliverable is the test the report itself names, not a behaviour change.
Shipping a speculative "fix" for a path that already does the right thing would
have made the next reader believe the last tab used to be selected.

## Notes

- `TabBar` renders `tabs` in `tabOrder` order and marks
  `tab.id === activeTabId`, so the highlight and the mounted grid cannot
  disagree. Any "wrong tab looks selected" report therefore has to be about
  `activeTabId` itself or about visibility (scroll), never about the mapping.
- Yorkie's `initialRoot` is written **per top-level key** on attach
  (`client.attach`), so `initialSpreadsheetDocument()` is inert for any saved
  workbook — worth remembering before suspecting seeding for a tab-state bug.
- One genuinely missing affordance found on the way and deliberately left out
  of scope: the tab bar never scrolls the active tab into view, so a workbook
  with more tabs than fit can open with the selected tab off-screen to the
  left. That is the closest real mechanism to the reported symptom and belongs
  in its own issue.
