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
