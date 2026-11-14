# Harden the Agent Jobs' Dependency Install — Lessons

- Flags are not the whole install. Where a package manager writes also follows
  from the shape of the tree, from configuration files, from the lockfile and
  from manifests. "Which flags" is the last question, not the first.
- Enumerating the inputs that steer an install did not converge: symlinks, then
  lockfile resolutions, then `bin` names, each found by a separate review.
  When a third family appears, change the shape of the defence — bound what the
  process can reach — and keep the lists as the early, readable refusal.
- A check that reads a file with a looser parser than the tool it guards is a
  second opinion the tool never asked for. Either use the tool's parser or
  accept only a subset in which both must agree, and test that they do.
- Deny-lists of bad values lose to spelling; allow-lists of known shapes, with
  a test that holds main to them, fail loudly and early instead.
- Containing the tool is not containing the work around it. Whatever the host
  does to the workspace after the contained process ran follows what that
  process left behind; do that work inside the container or only read.
- A step that "regenerates what the skipped script would have produced" runs
  the same branch-defined build the skip was meant to avoid.
- Setting a tool up reads the workspace too. Run toolchain setup actions before
  the untrusted checkout and give them explicit versions.
- Test a locator against the real install layout: pnpm installed by pnpm is a
  launcher script in `.bin`, not a link into the package.
- An install experiment that inherits the developer's environment writes into
  the developer's real package store. Run them under `env -i` with an explicit
  `HOME` and store.
- Mutation-check a guard before trusting it; a suite that passes on the first
  run has said nothing yet. Some survivors are equivalent — say which.
