---
title: CLI `import --replace --dry-run` must skip the confirmation gate
issue: 593
---

# Lessons — `import --replace --dry-run` confirmation gate

## What the bug taught

The three `import` runners each grew a `--replace` branch that reads
bytes, then checks `dryRun`. The confirmation gate was written as the
first thing in the `--replace` branch — the natural place for "this is
destructive" — which silently made it precede the one check that says
"nothing is going to be written". Safety guards belong *after* the
question "does this call actually mutate anything?", not before it.

## Notes

- The non-`--replace` paths were already correct, which is why the defect
  only reproduced under `--replace` and stayed unnoticed.
- `docs/design/cli.md` described the fixed behavior already; the code was
  the outlier. Worth checking the design doc before assuming the doc is
  the stale side.
