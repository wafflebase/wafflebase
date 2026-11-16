# Slides critique fixes — lessons

## Self-review log

- Round 1 (correctness/tests lens): panel clean — 0 blocking across all six
  lenses. Fixed the cheap minors anyway in three commits (selector built from
  a collaborator slide id, narrow-panel overflow, ARIA on rows without a 2D
  context, contrast helper's overstated AA claim, mobile edit mount not
  seeding, stale docs-presence/axis-id-selection references, a sheets-side
  palette guard, a vacuous test, `isEmptyPlaceholder` comment). Remaining
  minors go into the PR body as known limitations. Loop stopped (clean round).

## Lessons

- Parallel agents in worktrees integrate cleanly when file ownership is
  partitioned up front (each brief named the files the others own). The one
  cross-cutting trap was semantic, not textual: making the filmstrip a
  `listbox` silently disabled canvas keyboard handling, because the keyboard
  router skips keys aimed at any listbox. An existing test caught it — keep
  such guard tests.
- Commit-msg hook enforces body lines ≤80 chars; write messages to a file and
  wrap before committing, or the full verify:fast runs twice.
- Shared scratch filenames collide between parallel agents (`msg1.txt`,
  `/tmp/x`); give each agent a unique prefix.
- Under heavy machine load `upload-queue-lazy-deps.test.ts` hits its 5s
  timeout; it is unrelated to this branch.
- `pnpm tasks:archive` archives every fully-checked task in `active/`, not
  just this branch's; archive only your own pair (`git mv`) and re-run
  `pnpm tasks:index`, so the PR does not sweep other work.
- The pre-push `verify:self` flaked on load-sensitive frontend tests while
  another checkout ran its suite; a plain retry passed. `--no-verify` is
  refused by the harness, so plan push time around shared-machine load.
