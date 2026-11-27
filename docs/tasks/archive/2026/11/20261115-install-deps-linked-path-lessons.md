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

- **Round 3 (review panel: blast-radius).** One blocking finding, and the
  mirror image of round 2's: that round read the callers of the *scripts*, this
  one read the callers of the *file*. `command.mjs` is not checked out as part
  of `scripts/agent` — seven workflows fetch it **by name** with a non-cone
  sparse-checkout for their cheap `route` job, so wiring it to
  `direct-run.mjs` gave the `@claude` router its first local import and a file
  that is not on disk there. Every verb would have died with
  `ERR_MODULE_NOT_FOUND` before `parseCommand` was reached, and the unit tests
  could not see it because they import the router from a full checkout.

  The obvious fix — widen all seven sparse-checkouts to carry
  `direct-run.mjs` too — was written, tested, and then **could not be pushed**:
  this pipeline's App token has no `workflows` permission, so any commit
  touching `.github/workflows/` is rejected outright (`refusing to allow a
  GitHub App to create or update workflow … without workflow permission`) and
  nothing in the commit lands, fix included. A fix that cannot be delivered is
  not a fix; the constraint belongs in the design, not in a retry.

  So the router keeps its own copy of the comparison and imports node builtins
  only, which is what its delivery shape actually requires. Three things keep
  the copy honest: `router-checkout.test.mjs` reproduces the delivery — it
  copies `command.mjs` out ALONE and runs it, asserting the verb on stdout and
  in `GITHUB_OUTPUT`, plus a linked-path run that would catch the original
  symlink bug in the copy; `direct-run.test.mjs` asserts `command.mjs` is still
  the only exemption and that it has not grown the import; and the banned
  hand-rolled forms still apply to it, since the correct comparison matches
  none of them.

  The general lesson, twice over now: a shared module's blast radius is the set
  of ways its importers are *delivered*, not just the set of ways they are
  invoked. Round 2 read the callers of the scripts; this one had to read how the
  file reaches the disk — and then how the fix reaches the remote.

  `scripts/agent-arms/` is deliberately still on `path.resolve(argv[1])`:
  those are started from the checkout (`node ./scripts/agent-arms/classify.mjs`),
  not from a staged copy under the runner's temp directory, which is the
  directory that can pass through a link. That is the distinction the round-1
  claim should have rested on.
