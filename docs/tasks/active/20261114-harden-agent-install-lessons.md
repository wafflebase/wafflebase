# Harden the Agent Jobs' Dependency Install — Lessons

- Flags are not the whole install. Where a package manager writes also follows
  from the shape of the tree and from configuration files, so "which flags" is
  the second question; "what does it read" is the first.
- An audit of a tool is an audit of one version. pnpm 10 reads settings from
  `pnpm-workspace.yaml` that pnpm 9 did not; pin the version next to the
  hardening and make the pin fail loudly when the repository moves.
- Comparing a configuration file byte for byte with main's is cheaper and
  stronger than parsing it for forbidden keys, when ordinary pull requests have
  no reason to touch it.
- A step that "regenerates what the skipped script would have produced" runs
  the same branch-defined build the skip was meant to avoid. Either the agent
  does it, as part of verifying, or it is not done.
- Setting a tool up reads the workspace too. Run toolchain setup actions before
  the untrusted checkout and give them explicit versions.
- A test harness that inherits the developer's environment can write into the
  developer's real package store (`PNPM_HOME`). Run install experiments under
  `env -i` with an explicit `HOME`.
- Mutation-check a guard before trusting it: all new assertions passed on the
  first run, which says nothing until each one has been seen to fail.
