# Stream the self-review diff instead of buffering it

`node scripts/agent/spec-to-pr.mjs review` died with `spawnSync git ENOBUFS`
on #1132 (≈75k deleted lines): the diff was read back through
`execFileSync`'s 1 MB default buffer, so the local panel never ran on the
branches that most need a review. CI never hit it — its shell redirects to a
file — and it also filters ANTLR tooling output out of the body, which the
local path did not, so local and CI rounds reviewed different diffs.

- [x] `writeReviewDiff`: stream both files through an fd, apply CI's
      pathspec excludes, fall back to the unfiltered diff when empty.
- [x] Regression test: a >1 MB deletion + an `.interp` file through the
      real `review` command; fails on the old code, passes now.

## Review

`spec-to-pr.test.mjs` 49/49; `pnpm lint:scripts` clean.
