# Switch to yorkie's Shared Harness Core — Lessons

- A guard written against one shape of a workflow keeps its value across a
  rewrite only if each check is restated as the property it protects. Most of
  the old checks named steps that no longer exist (the staged install, the
  digest); the properties behind them — the branch enters at one checkout,
  nothing trusted runs from the workspace, nothing writes where a later step
  reads — still applied and needed new anchors, not deletion.
- Mutate the real files, not only the fixture. The fixture cases all passed
  while a mutation of the reply job slipped past two older guards: their
  branch-ref regex did not know `steps.<id>.outputs.ref`. Only an edit of the
  actual workflow showed it.
- A difference the copy cannot fix is pinned, not relaxed. Exact known lists
  (tag-pinned actions, the reply job's silent refusal) fail both when a new
  case appears and when upstream fixes one, so the guard tells us to tighten
  it again.
- Commit order follows the gates: the lint scoping had to land before the
  sync, or the sync commit could not pass `verify:fast` without being edited.
- On a shared machine, backend socket tests fail with a parse error when the
  load is near 20; wait for the load to drop rather than retrying blindly.
- A guard that names a job's steps breaks when upstream restructures the job;
  one that names what the job may hold survives it. When `agent-implement`
  went from one job with a revoked App token to four jobs, "the agent's job
  holds no credential that writes" needed new anchors (no App secret
  referenced, no token minted, a read-only token), not a new property.
- Keep the scratch tools a run depends on until the work is merged. Deleting
  the `npx` shim during cleanup made the next `verify:self` fail on knip
  again.
- At a load near 30, vitest workers time out before they answer, and
  `frontend:test` fails with every test passing. Read the failure before
  rerunning: "Timeout waiting for worker" is the load, not the change.
- A shared gate brings its own preconditions on repository settings, and a
  green test suite says nothing about them: the protection gate passed every
  test against fixtures and refused wafflebase's live `main`. Read the gates
  a sync adds against the live settings before the switch, not after.

