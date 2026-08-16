# Lessons — CLI --dry-run for read commands (#659)

## What went well

- The four fixes were the guard the issue predicted. The only judgment calls
  were ordering (`--type` validation before the preview, matching
  `sheets tabs create`) and faithfulness (`cells get` reproducing all three
  endpoints its `range` argument selects between, encoded the way
  `HttpClient.getCells` encodes it).

## What was surprising

- `scripts/test/changed-areas.test.mjs`'s empty-resolution case called the
  real `resolve()` against the real repo and asserted `full === true`. That is
  only true when the checkout's diff against `main` is empty, so the test
  failed on any branch that had changed a classified package — i.e. on every
  branch that runs it at pre-push, while passing on a clean `main`. A test
  whose fixture is "the repository as it happens to be" fails on the change it
  is supposed to be guarding.
- Running one CLI test file locally needs `@wafflebase/docs` and
  `@wafflebase/slides` built first; without them the failure surfaces as a
  Vite "failed to resolve entry for package" that looks like a broken import.

## Follow-ups

- None. `files download` and the `*/content` commands were re-checked and
  already honour the flag.
