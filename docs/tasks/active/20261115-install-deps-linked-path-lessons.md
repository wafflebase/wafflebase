# Lessons — install-deps linked-path entry check

## What the bug taught

An entry check that compares a *typed* path with a *resolved* one fails open
in the quietest way available: the module simply does not run its top-level
block, so the process exits 0. Nothing refuses, nothing installs, and the
caller reads success. Both sides of such a comparison have to go through the
same resolution.

The two linked paths in this script are not the same question. `argv[1]` —
the staged directory the job starts the file from — is what this fix is
about; a linked **workspace** is checked separately and refused
(`install-deps.mjs`'s `the workspace path is, or passes through, a symbolic
link`). The first draft of the fix comment conflated them.

## Review rounds

- **Round 1 (correctness / test adequacy).** The machine panel
  (`scripts/agent-arms/spec-to-pr.mjs review`) could not run: every lens
  returned `PANEL_INFRA_ERROR: [NO_RESPONSE] no response from the API`, i.e.
  this headless run has no API credential. Reported as a non-round, not as a
  clean one. An independent fresh-context reviewer read the diff instead and
  found **nothing blocking**: it reproduced old-vs-new behaviour across
  direct / linked-directory / linked-file / imported / `--preserve-symlinks-main`
  invocations, and confirmed the new test fails against the pre-fix code
  (exit 0, no output) and pins the specific refusal. Fixed from its
  non-blocking list: the entry-check comment's conflation of the two linked
  paths, the stale `docs/tasks/README.md`, and this log. Left alone: the same
  `path.resolve(argv[1])` shape in ~25 sibling scripts under `scripts/agent/`
  and `scripts/agent-arms/` (out of scope for #1151, and none of them has the
  staging arrangement that makes the silence consequential), and a test-style
  preference (`assert.equal(status, 1)` vs the neighbours'
  `assert.notEqual(status, 0)` — the stricter one is deliberate here).

- **Round 2 (review panel: blast-radius, security, correctness).** Three
  blocking findings, all one mistake: *"none of them has the staging
  arrangement"* was simply wrong. The sibling scripts under `scripts/agent/`
  are launched by the same four workflows from the same
  `$RUNNER_TEMP/agent-tools` copy — `node "$RUNNER_TEMP/agent-tools/set-state.mjs"`,
  `…/loop-status.mjs`, `…/pick-credential.mjs` — so the premise of the fix
  applies to every one of them verbatim, and `pick-credential.mjs` carried the
  weaker `file://${argv[1]}` form on top of it. The scope judgement was made by
  reading the scripts and not the callers.

  Fixed by moving the answer into one module, `scripts/agent/direct-run.mjs`,
  and wiring all 25 tools in that directory to it. Its `isEntryPoint` **throws**
  on an entry path it cannot resolve instead of answering "imported" — the
  third finding, that `catch { return false }` reinstated the exact silent
  `exit 0` the fix exists to remove — and `install-deps.mjs` turns that throw
  into its usual loud refusal. `direct-run.test.mjs` pins the behaviour and
  holds the whole directory to the shared module, so the next tool cannot
  hand-roll the broken form again.

  `scripts/agent-arms/` is deliberately still on `path.resolve(argv[1])`:
  those are started from the checkout (`node ./scripts/agent-arms/classify.mjs`),
  not from a staged copy under the runner's temp directory, which is the
  directory that can pass through a link. That is the distinction the round-1
  claim should have rested on.
