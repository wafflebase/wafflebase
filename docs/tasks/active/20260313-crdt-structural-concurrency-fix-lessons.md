# CRDT Structural Concurrency Fix — Lessons

## Start From Executable Repros

- For structural collaboration bugs, do not start by editing the algorithm in
  the abstract. Keep a small red repro lane and drive the fix from those cases.

## Stable Ids Are Necessary But Not Sufficient

- Stable row/column identity fixes insert-heavy structural races, but it does
  not by itself make concurrent `delete(index)` compose like two serial
  deletions. Treat delete/delete as a separate semantic problem early.

## Audit Raw Readers With Storage Migrations

- When introducing an alternate worksheet storage model, audit every direct
  `worksheet.sheet` reader and writer immediately. Otherwise the store can be
  correct while charts, pivots, merges, or APIs still read stale projections.

## Match Red Tests To Current Scope

- When the user explicitly defers a residual edge case, move that coverage to
  characterization or skipped repros instead of leaving an opt-in failing
  contract that no longer matches the iteration scope.
