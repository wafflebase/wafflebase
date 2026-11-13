# Remove the eval subsystem — lessons

- A credential-backed workflow that fails red for six weeks unnoticed is the
  failure mode, not the expired token. Red notifications that go to merged-PR
  authors, not to whoever owns the credential, are ignored.
- Before deleting a subsystem, map couplings in the surviving files, not in
  the deleted ones: the breakage was a verify lane, a test import and a test
  that read a workflow file from disk, none of them in `eval/`.
- Guards that protect live code can live inside the subsystem being removed
  (`eval/test-lane.test.mjs`). Relocate them; deleting the directory would
  have silently dropped them.
- `verify:entropy` treats backticked file names in design docs as references;
  write removed files as prose in history notes.

## Self-review log

- `spec-to-pr.mjs review` cannot review this branch: it builds the diff with
  `execFileSync` at the default 1MB `maxBuffer`, and a 2.8MB diff of deleted
  files fails with `ENOBUFS`. Ran the same `review-panel.mjs` directly on
  `git diff --irreversible-delete` (150KB) instead.
- Round 1 (correctness/tests): test-adequacy blocked — the "every depth" lane
  check was vacuous once no test file lived in a subdirectory. Fixed by running
  the lane's real invocation in a fixture tree (top, nested, two
  `node_modules`); mutation to a flat `'*.test.mjs'` now fails it. Other five
  lenses clean.
- Round 2 (design fit): panel clean on all six lenses. The
  `superpowers:requesting-code-review` pass found `finding-match.mjs`'s grouping
  section (~650 lines) had only eval consumers — the coupling map covered
  imports into surviving files but not exports out of them. Removed it with its
  34 tests, kept `matchFindings` (tested entry to the live `matchAnchored`), and
  fixed four stale comments/task-doc lines it named.
- Lesson: after deleting a consumer, also grep every surviving module's exports
  for a remaining importer; "nothing imports the deleted code" is only half.
