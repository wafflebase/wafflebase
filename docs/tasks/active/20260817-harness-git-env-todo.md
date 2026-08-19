# Harness: scope the changed-areas git calls to their own repository

## Problem

`scripts/test/changed-areas.test.mjs` builds throwaway git repositories in
`os.tmpdir()` and drives them with `execFileSync("git", …, { cwd: dir })`. It
passes `cwd` but **not `env`** — and `cwd` does not decide which repository git
operates on. `GIT_DIR` does, and it wins. So when any of the git location
variables is present in the environment, every one of those `git init` /
`git add` / `git commit` / `git checkout -b` calls writes into whatever
repository `GIT_DIR` names.

That has happened twice against this repository — 2026-08-15 13:01 and again
2026-08-17 21:11, the second time hijacking a live branch
(`feat/design-editor-shell-build`, reset to a fixture commit named `second`).

`scripts/agent/git-env.mjs` exists for exactly this hazard and says so, and
four other test files already use it (`collect-captures.test.mjs`,
`novelty.test.mjs`, `git-env.test.mjs`, `eval/run.test.mjs`). This is one file
that missed an established convention, plus the two read sites in the module it
tests.

## What was reproduced, and what the hypothesis got wrong

Reproduced in throwaway clones under `/tmp` (never a worktree — a worktree
shares `.git` with the primary repository, so a reproduction there *is* the
incident). Each variable causes a different symptom:

| environment | symptom |
| --- | --- |
| `GIT_DIR=<repo>/.git` | fixture commits land on the victim's current branch; a `feature` branch appears; `core.filemode` flips; `user.name`/`user.email` are overwritten with the fixture's `T` / `t@example.com`; the index is rewritten. Test fails — loud. |
| `GIT_DIR=<repo>/.git/worktrees/<name>` | all of the above **plus `core.bare = true`**, after which the primary tree answers `fatal: this operation must be run in a work tree`. |
| `GIT_INDEX_FILE=<repo>/.git/index` | the victim's index is replaced by the fixture's: 3611 files staged as deleted, 855 522 deletions. **The test still exits 0** — entirely silent. |
| `GIT_WORK_TREE=<repo>` alone | test fails, no damage. |
| `GIT_INDEX_FILE=.git/index` | harmless: relative, so it re-resolves against the child's cwd. |

Two corrections to the hand-off's stated mechanism:

1. **`core.bare` comes from the GIT_DIR path's *shape*, not from bareness.**
   `git init` calls `guess_repository_type()`, which returns "bare" for any
   `GIT_DIR` that does not end in `/.git`. A linked worktree's gitdir
   (`.git/worktrees/<name>`) never does, and `core.bare` is written to the
   **common** config — the primary repository's `.git/config`. Isolated proof:
   `GIT_DIR=<r>/.git` → `bare=false`; `GIT_DIR=<r>/.git/worktrees/wt` → `bare=true`.
2. **`git push --dry-run` is not a dry run for this.** It runs the `pre-push`
   hook — and therefore `pnpm verify:self` — *before* git decides the push is a
   rehearsal. That is how the third incident happened: the operator used
   `--no-verify` on every real commit and push, then let one `--dry-run`
   through as self-evidently harmless (`.git/config`'s mtime matches the hook
   run to the second). Anyone defending against this class of bug with
   `--no-verify` has to apply it to `--dry-run` too. Recorded in
   `scripts/agent/git-env.mjs`'s header, where someone reaching for
   `--no-verify` will actually read it.
3. **`pre-push` does not export any location variable** on git 2.43. Probing
   every hook: `pre-commit` / `prepare-commit-msg` / `commit-msg` /
   `post-commit` export only `GIT_INDEX_FILE=.git/index`, which is relative and
   therefore benign; `pre-push` exports none. So the variable arrives from the
   **ambient environment**, not from the hook contract, and nothing in this
   repository sets it. The fix does not depend on knowing which wrapper does:
   an unscoped git call is wrong whatever put the variable there.

## Scope

- [x] `scripts/test/changed-areas.test.mjs` — pass `fixtureGitEnv(dir)` at all
      8 git call sites (the write path; two distinct `dir` variables, so not a
      blind replace).
- [x] `scripts/changed-areas.mjs` — pass `repoScopedEnv(repoRoot)` at the 2
      read sites (`resolveRefs`, `changedPaths`). Read paths, but they decide
      which CI lanes run, and the regression test below cannot hold without
      them: they are what answers "about the fixture".
- [x] Regression test asserting the **property**, not the call: build the
      fixture and resolve refs with hook-style variables aimed at a victim
      repository, then assert the victim is byte-identical (refs, `HEAD`,
      `.git/config`, index, worktree status) and the answers are about the
      fixture. Covers both GIT_DIR shapes, so `core.bare` is pinned.
- [x] Prove each fix by reverting it and confirming exactly the expected test
      fails.
- [x] Re-run the `/tmp` clone reproduction with the fix in place; confirm the
      clone is untouched.

## Non-goals

- The leaked `feature` branch and the reflog entries in
  `/home/hotsunchip/wafflebase`. Another session was actively repairing the
  shared repository while this ran; two writers on the same refs is worse than
  one leftover branch. Left alone deliberately, and reported instead.
- Three further unscoped **read-only** git call sites found by the sweep, none
  of which can corrupt anything (worst case they answer about the wrong tree):
  `scripts/verify-entropy.mjs:139` (`spawnAsync("git", ["ls-files"], { cwd })`),
  `scripts/agent/review-scope.mjs:61` (`execFileAsync`, `cwd: repo`), and
  `scripts/agent/eval/extract-corpus.mjs:547` (`-C repoSource`, and `-C` scopes
  git no better than `cwd` does). Each needs its own caller audit —
  `extract-corpus`'s `repoSource` is optional, so `repoScopedEnv(undefined)`
  would throw. Reported, not fixed here.
- `scripts/agent/spec-to-pr.mjs:100,141,288,289,301` pass neither `cwd` nor
  `env`: they act on "whatever repository I was run in" by design, which is
  outside the pattern rather than a miss of it.
