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

- Fixing the four commands the issue named, then documenting the result as a
  general rule ("a dry run never reaches the network"), turned a local fix
  into a false global claim. The re-check found the same bug in `notes`,
  `slides`, `files`, `sheets export`, and — worst — `api-keys`, where the
  ignored flag mints a live key or irreversibly revokes one. A contract
  sentence in a design doc is a promise about every command, so either sweep
  the namespace or scope the sentence.
- The audit for "which commands ignore the flag" is `grep getClient(opts).`
  and check each hit for a preceding `opts.dryRun` branch — a per-namespace
  reading missed `api-keys` because it lives outside the v1 API base and so
  never appeared in a `printDryRun` search.

## Follow-ups

- None. `files download`, the `*/content` commands and the import paths were
  re-checked and already honour the flag.
