# Slides Rich Fonts — Lessons

## Never `git stash` to "check baseline" with uncommitted WIP

While verifying that a batch of `tsc --noEmit` errors were pre-existing,
I ran `git stash` to compare against the committed state. `git stash`
silently swept all uncommitted tracked edits (the entire P0 catalog
change) into a new stash, leaving the tree looking reverted. Untracked
files (the generator + generated data) stayed, which made the partial
revert easy to miss.

**Why it matters:** a stash mid-task can read as "my edits vanished" and
trigger redundant re-work, or worse, edits made on top of the reverted
tree.

**How to apply:** to confirm whether errors are pre-existing, DON'T
stash. Either (a) run the same check on a fresh `git worktree` of
`origin/main`, or (b) reason from the error paths — if every error is in
files you never touched, they're pre-existing. Recover with
`git stash pop` immediately if you do stash by reflex.

## Generate the dangerous fields; don't hand-curate them

Font `weights` is a footgun: Google Fonts' css2 endpoint returns an
error CSS payload for an unavailable weight, and one bad family poisons
the whole `<link>`. Variable fonts hide their weight range in an
`axes { tag: "wght" }` block, not the static `fonts { weight }` entries,
so eyeballing the weight is unreliable. Deriving it from `METADATA.pb`
(static weights ∪ variable axis range, intersected with {400,700})
eliminated the error class the old manual `weights: '400'` overrides
were patching one-by-one.

**How to apply:** when a field has a correctness cliff and an
authoritative source exists, generate it from the source and commit the
output rather than hand-maintaining it.

## License lives in the repo, not the API

The Google Fonts webfonts REST API does not expose license. The
authoritative source is the `google/fonts` repo: the top-level dir
(`ofl`/`apache`/`ufl`) is the license, confirmed by `METADATA.pb`'s
`license:` field. Build-time generation captures it; runtime API calls
cannot.

## Frontend has no `tsc` gate — don't trust a raw `tsc -p`

`pnpm frontend` validates via `eslint` + `vitest` (esbuild transpile);
there is no `typecheck` script and `vite build` doesn't full-typecheck.
Running `tsc --noEmit -p tsconfig.app.json` directly surfaces ~110
pre-existing errors (Radix typings, readonly tuples) that are NOT part
of any gate. Use it only to scan for errors in *your* files, not as a
pass/fail signal.
