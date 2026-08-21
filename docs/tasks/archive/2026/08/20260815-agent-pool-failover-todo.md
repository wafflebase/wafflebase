# Make the credential pool survive a bad slot and a weekly window

## Context

Five `agent:blocked` PRs (#648, #757, #770, #786, #810) sat frozen for a day.
None of them was blocked by its own code: the review panel could not run.

Two distinct pool faults produced that, and neither was visible from a PR.

**Fault 1 — a weekly window is not recognised as a limit.** On 2026-08-14 an
account returned `You've hit your weekly limit · resets 11pm (UTC)`.
`SESSION_LIMIT_RE` matched only `session`/`usage`, so the message fell through
to `RATE_LIMITED` (it arrives under a 429). `isAccountLimit` is keyed on
`USAGE_LIMIT`, so no failover happened, and one account's weekly reset froze the
panel across every open PR while three healthy credentials sat unused. The
regex existed in two copies — `ask.mjs` and `redact.mjs` — each with a comment
promising it matched the other.

**Fault 2 — a refused credential stops the job instead of moving off it.**
`CLAUDE_CODE_OAUTH_TOKEN_2` expired. `selectStartIndex()` shards on the run id,
so roughly a quarter of runs landed on it, and every one of those died on its
first call — with three valid credentials in the same process. `nextCredential`
failed over only on `isAccountLimit`, and its docblock said so deliberately:
failing over on a 401 "would burn the entire pool on a problem no other token
can solve". That was correct for ONE credential and wrong for a POOL of
independent accounts, where a 401 is a fact about one slot.

Confirmed live, per secret name, by `Agent SDK Auth Smoke Test`:

```
✅ CLAUDE_CODE_OAUTH_TOKEN     authenticated
✅ CLAUDE_CODE_OAUTH_TOKEN_1   authenticated
❌ CLAUDE_CODE_OAUTH_TOKEN_2   401 OAuth access token is invalid
✅ CLAUDE_CODE_OAUTH_TOKEN_3   authenticated
```

## Plan

- [x] Widen `SESSION_LIMIT_RE` to the closed set of billing periods
      (`session|usage|weekly|daily|monthly`), each still anchored to ` limit`
- [x] Export it from `redact.mjs` and import it in `ask.mjs`, deleting the
      second copy — the drift is the fault, not the omission
- [x] Use it in `auth-smoke.mjs`'s `QUOTA` list too, so the pre-arm check cannot
      disagree with the pipeline it pre-flights
- [x] Add `isCredentialRejected` (`AUTH_REJECTED`, falling back to 401/403) and
      fail over on it in `nextCredential`
- [x] Restate the pool-exhausted message as "retired" rather than "hit its usage
      limit" — a slot is now retired for either reason, and the two remedies are
      opposite
- [x] Regression tests, each verified to fail against the pre-change sources

## Acceptance criteria

- [x] A `weekly`/`daily`/`monthly` limit classifies as `USAGE_LIMIT`, and
      `rate limit exceeded` still classifies as `RATE_LIMITED`
- [x] A 401/403 fails over to the next healthy credential
- [x] A wholly-rejected pool drains, stops, and reports every credential retired
      — it does not loop
- [x] `auth-smoke` reports a weekly limit as quota (exit 2), not auth (exit 1)
- [x] One definition of the limit rule in the repo

## Out of scope

- Replacing the expired secret. Done by the maintainer out of band;
  `readPoolSlots()` drops empty slots, so removal alone restores a healthy pool.
- Proactively health-checking the pool before a run. A pre-flight per job costs
  a live call per slot; failover already makes a bad slot survivable, and
  `Agent SDK Auth Smoke Test` covers the deliberate check.

## Review

Both faults were found while unblocking the five PRs above, not from a report.
The diagnosis is reproducible: the smoke test names the bad secret without
printing it, and the panel's own check-run summaries distinguish an infra
failure (~9s, "review did not run") from a real verdict (minutes).
