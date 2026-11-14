# Prepare for yorkie's Shared Harness Core — Lessons

- Run a module's dependants against the version it is about to become, not
  only the one it is. The arms' suites were green on wafflebase's core and
  failed to load on yorkie's for three different reasons: a removed export,
  a predicate that now reads per clause, and a vocabulary the core no longer
  exports. A scratch copy with the new core laid over it found all three in
  one run.
- A test that compares an arm with the core is a test of the core. When the
  core is about to be someone else's, make the comparison report what differs
  (`todo` with the reason) on the core that cannot pass it, and keep it
  enforced on the one that can; otherwise the switch turns it red for a
  difference the arm cannot fix.
- Moving a hardened step to where another workflow calls it changes what is
  beside it. The install was written for a workspace holding one checkout;
  the shared workflows put main's copy of the action inside the workspace as
  `.trusted-toolchain` (with its own `.git`) and persist a token in `.git`.
  Both had to be handled — skipped in the walks, covered in the container —
  or the moved code would have refused every run, or handed the container a
  credential it never had before. And the exemption has to name the one
  checkout the job made, not a prefix: the first version skipped every
  `.trusted-*` directory, which a branch can simply carry.
- A `todo` that switches on "is the other side there yet" never fails, so it
  can hide a change on that side forever. Pin the other side's present state
  exactly in a normal test; the day it changes, the test says so.
- Read the guidance that disappears as carefully as the code. Today's
  prompts told the agent to push with `--no-verify`; the shared ones forbid
  it, so anything that re-arms the minutes-long pre-push (the root
  `postinstall`) becomes a stuck push.
- A launcher layout is part of an interface. `install-deps.mjs` finds pnpm by
  walking from the PATH entry; laying the fetched tarball out as `.bin/pnpm`
  beside `pnpm/` reused that resolution instead of changing it.
- `pnpm verify:fast` needs the engine packages built (`docs`, `slides`, …)
  before the typechecks that import them; a fresh worktree's first commit
  fails on that, not on the change.
