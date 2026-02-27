# Lessons

- Once warning debt is cleared, immediately enforce `--max-warnings 0` so new
  warning regressions are blocked at the same layer as errors.
- Strict lint gates are most effective when paired with deterministic
  self-contained verification lanes (`verify:self`).
- Apply strict warning gates only after validation on the current branch to
  avoid introducing sudden breakage from pre-existing warning debt.
