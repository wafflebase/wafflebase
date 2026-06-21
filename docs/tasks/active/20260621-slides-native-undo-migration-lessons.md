# Slides native undo migration — lessons

**Created**: 2026-06-21

## Lessons

(filled in when the migration work starts)

- Starting point from the #388 churn fix: Slides was the only store on
  snapshot-based undo; Sheets and Docs already use `doc.history`. The
  snapshot rebuild is what made undo/redo O(document) and caused the
  node-OOM incident — native undo is O(change) by construction.

- Known central challenge before any code: slides `batch()` runs N
  independent `doc.update()` calls, so a multi-edit batch is N native undo
  units. Grouping a batch into one undo unit is the prerequisite refactor.
