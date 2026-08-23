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

## Merging with `main`

- The CLI-login hardening this branch carried alongside the `--dry-run` fix
  was independently re-implemented on `main` (#695), in a stronger form:
  PKCE-bound authorization codes, a confirmation page before the CLI flow
  starts, and `__Host-` double-submit state cookies binding both the browser
  and the CLI state to the browser that started the login. Two consent gates
  and two state-cookie schemes cannot both run, so the merge resolved every
  `packages/backend/src/auth/*` file and `packages/cli/src/commands/login.ts`
  to `main`, and the branch's `login-callback.test.ts` was dropped in favour
  of `main`'s `login.test.ts` / `login-command.test.ts` /
  `login-listen-failure.test.ts`.
- One defense was genuinely branch-only and was ported forward: the loopback
  listener's `Host` check (`isLoopbackHost`), which refuses a request
  addressed to a name that merely resolves to `127.0.0.1` (DNS rebinding).
  It now sits in `main`'s `startCallbackServer` in front of the nonce check,
  reported through the same `refuse()` path as every other refusal.
- Deliberately *not* ported: the branch made a present-but-malformed CLI
  nonce a `400`, where `main` degrades it to "no nonce". `main`'s
  `parseCliNonce` spec pins that silent drop, and the outcome is still
  fail-closed — the CLI's listener refuses a callback with no `state` and
  says why. Also dropped: `--allow-unbound-callback`, which existed to
  tolerate a backend older than the nonce echo. `main` requires the nonce
  unconditionally, which is strictly stronger than an opt-out.
- Ordering, where a command has both: `parseOutputFormat(opts.format)` runs
  first, then the `--dry-run` short-circuit. A dry run validates its inputs,
  so a bad flag is an error rather than a preview — the same rule the branch
  already applied to `--type` and `--file-format`.

## Follow-ups

- None. `files download`, the `*/content` commands and the import paths were
  re-checked and already honour the flag.
