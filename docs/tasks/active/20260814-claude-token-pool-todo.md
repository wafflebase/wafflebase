---
title: claude token pool
target-version: 0.2.0
---

# A token pool for the agent pipeline — even distribution plus failover

## The problem

Every Claude call the pipeline makes authenticates as one account. `CLAUDE_CODE_OAUTH_TOKEN`
is a single environment secret of the protected `agent` environment, and eight workflows
declare that environment to reach it. That account's usage window is therefore the
pipeline's throughput ceiling: when it closes, every lane fails at once, and the failure is
not a graceful one — `classifyResult` marks an account limit `retryable: false`
(`ask.mjs:336`, via `SESSION_LIMIT_RE`), so `withRetry` throws immediately and the round
dies. That verdict is correct for one token and wrong for a pool.

The two consumption shapes need different mechanisms:

| lane | workflows | how the token is consumed |
|---|---|---|
| **SDK** | `agent-review-panel` (:761), `agent-review-on-demand`, `eval-replay`, `agent-sdk-smoke-test` | `askStructured()` → `query()` in `scripts/agent/ask.mjs` — one chokepoint for all of them |
| **Action** | `agent-implement`, `agent-fix`, `agent-iterate-ci`, `agent-review-reply`, `agent-summarize`, `agent-review-panel` (:1636) | `anthropics/claude-code-action@v1`, input `claude_code_oauth_token` — no in-process hook |

## The constraint that sets the design

**Distribution has to happen per job, not per call**, because prompt caches are scoped to
the account that wrote them.

`createWarmupGate()` (`review-panel.mjs:1873`) exists precisely to pay for the shared diff
prefix once and have every other lens and sample read it — including across lenses, which
is where most of the saving comes from. Rotating tokens per call gives each token a cold
cache, so the panel pays the warm-up N times a round instead of once. With four tokens that
costs more in input tokens than the distribution saves.

So: **one token per job, chosen deterministically from the run id; switch only on
exhaustion.** Within a job the cache holds. Across runs the load spreads. Both lanes obey
the same rule, which is what keeps this from becoming two designs.

Failover does forfeit the warm cache for the remainder of that job. That is the correct
trade — the alternative is not a cheaper round, it is no round.

## The change

### Pool shape

`CLAUDE_CODE_OAUTH_TOKEN_1` … `_8`, all in the existing protected `agent` environment.
Unset slots resolve to the empty string and are filtered out, so the pool grows by adding a
secret with no workflow edit. `CLAUDE_CODE_OAUTH_TOKEN` (unsuffixed) stays valid as slot
zero, which is what makes this land without a flag day.

Selection is `startIndex = GITHUB_RUN_ID % poolSize`, so consecutive runs land on different
tokens without any shared state. `GITHUB_RUN_ATTEMPT` joins the key so a re-run of a job
that died on exhaustion does not immediately re-pick the exhausted token.

### `scripts/agent/token-pool.mjs` (new)

- reads the slots from the environment, filters empties, de-duplicates, preserves declared
  order, and carries each token's secret NAME so a diagnostic can name a bad slot without
  printing a credential;
- `current()` — the run-derived token, stable for the process;
- `advance(reason, deadToken)` — retires the current token and returns the next live one, or
  `null` when the pool is dry (the point at which failing is right). `deadToken` makes a
  concurrent report idempotent, which the panel needs: its lenses hit one closed window
  within milliseconds, and without it the second report retires the healthy token the first
  just moved to;
- `isExhausted()` — separates "drained" from "never configured". Both make `current()` null,
  and they must not be confused: unconfigured falls through to ambient credential
  resolution, drained must fail, because the ambient token in these workflows is slot zero —
  one the pool has already retired;
- `shardOffset()` — mixes a per-job discriminator into selection. `GITHUB_RUN_ID` identifies
  the run, not the job, so every leg of `eval-replay`'s matrix would otherwise land on one
  credential — no distribution for the lane whose `max-parallel: 1` exists because legs
  contend on one account;
- pure and injectable (env, run id, shard as arguments) so the tests need no runner.

### `scripts/agent/ask.mjs`

- `buildSessionOptions()` gains `env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: <token> }`.
  The spread is load-bearing: the SDK's `Options.env` **replaces** the subprocess
  environment rather than merging it (verified against the pinned 0.3.217 `sdk.d.ts:1408`),
  so omitting it strips `PATH`/`HOME` and the CLI never starts.
- Per-call `env` rather than mutating `process.env` because the panel runs lenses and
  samples concurrently; a global swap mid-failover would hand a half-changed environment to
  calls already in flight.
- Failover lives in `askStructured`, **not** in `withRetry` as this plan first had it. The
  token is bound where the session is built, and keeping `withRetry` a generic helper means
  the two retries stay separable: it still owns transient errors, and the new loop owns
  credential exhaustion. `nextCredential()` is the pure decision, exported so it is testable
  without the SDK on disk.
- Only an error that is `kind: 'api-error'` and matched `SESSION_LIMIT_RE` consumes a
  failover. Every other non-retryable error throws exactly as it does today — a 401 from a
  bad token would otherwise burn the whole pool on a problem no credential fixes.
- Exhaustion is process-scoped, so the six lenses of one panel round make the discovery
  once instead of six times.

### Action lane — deferred to its own PR

`claude-code-action` takes the token as an *input*, so selection must happen before the step
and failover must be a second step. A composite action wrapping both was written and then
**removed from this PR**: nothing referenced it, and the `verify:entropy` dead-code gate
refused it — correctly. Unwired code does not belong on `main`, and the gate is the reason
it does not get there. It lands with the verification it is waiting on.

Two behaviours have to be confirmed on a real runner before that, and both fail silently if
the assumption is wrong: `continue-on-error` on a composite step, and passing a credential
through a step output.

Open question to settle then: whether the second attempt can tell an exhaustion apart from an
ordinary agent failure. `claude-code-action` writes `claude-execution-output.json` (already
uploaded as an artifact by every one of these workflows), so the ladder can read the same
`SESSION_LIMIT_RE` signal out of it. If that proves unreliable, the fallback is to retry on
any failure and accept one wasted attempt.

### What is deliberately not in scope

- **Cross-job exhaustion state.** Two jobs starting inside the same window can both
  discover the same dead token. Sharing that costs a store; the waste is one failed call
  per job.
- **Usage-aware balancing.** Nothing reports remaining quota per token, so "even" here
  means even in job count, not in tokens consumed.

## Tasks

- [x] `scripts/agent/token-pool.mjs` + `token-pool.test.mjs` — discovery, ordering, dedup,
      run-id selection, `advance()` past exhausted slots, dry-pool returns `null`,
      single-token pool behaves exactly as today
- [x] `ask.mjs` — `options.env` wiring with the `process.env` spread; `askStructured`
      threads the pool's current token
- [x] `ask.mjs` — failover on the session-limit signal only; `ask.test.mjs` asserts a 401
      and a `kind: 'limit'` (our own turn ceiling) still throw without consuming a token
- [x] `auth-smoke.mjs` — check every registered credential, report by secret name
- [x] `pnpm verify:fast` (exit 0) and `pnpm verify:self` (the pre-push gate)
- [x] Update `docs/design/harness-engineering.md` with the pool, the per-job constraint, and
      the invariant it relaxes
- [ ] Register `CLAUDE_CODE_OAUTH_TOKEN_1..N` in the `agent` environment
- [ ] Dispatch `agent-sdk-smoke-test.yml` — every credential green, pool size as expected
- [ ] Roll out the SDK lane: `eval-replay` → panel
- [ ] Action lane, as its own PR: confirm composite `continue-on-error` and step-output
      masking on a real runner, then land the wrapper wired to the six workflows
- [ ] **Reduce the untrusted-cwd credential count from nine to two** — see Review below

## Review

Landed as `7085a4ab6` plus the review fixes below. Self-review over the branch diff
(five reviewers) found five things worth acting on; three of them were the same finding.

**The one that mattered.** Three reviewers independently caught that the SDK steps'
env blocks previously carried a *count*-based invariant — "Export ONLY that one — no
second credential in a process whose cwd is the untrusted branch checkout" (#508) and
"The only credential this job holds" (#740) — and that the first draft both added eight
more secrets AND rewrote those comments to say "CLAUDE credentials only", keeping the
security prose while dropping the constraint it stated. Rewriting the comment was the
worse half: it made a real relaxation read as no change. Fixed by restoring the
invariant's force and stating the relaxation, its bound, and what is tracked to undo it,
in the workflows and in `harness-engineering.md`. Reducing nine to two is left open above
rather than attempted here, because the mechanism (choose in a trusted step, hand the
untrusted step two tokens) needs the same runner verification the action lane is waiting
on, and a wrong version of it is worse than an honest comment.

**Also fixed.** A drained pool fell through to ambient credential resolution — which in
these workflows is slot zero, a token the pool had already retired — spending a live call
to fail identically, or reporting "not logged in" for a pool merely out of quota;
`isExhausted()` now separates that from "never configured". And every leg of
`eval-replay`'s matrix shares one `GITHUB_RUN_ID`, so all legs picked the same credential:
`CLAUDE_POOL_SHARD` (fed `matrix.runId`) now distinguishes them, which matters most for
the one lane whose `max-parallel: 1` exists because legs contend on a single account.

**Not acted on.** A reviewer read the reworded comments as correct; the two reviewers with
commit-level evidence were right and it was not.

**Caught by the pre-push gate, after the review.** `verify:entropy`'s dead-code lane refused
the branch: `.github/actions/claude-agent-run/pick.mjs` was an unused file, because the
wrapper was written but deliberately not wired. That is the gate doing its job — five
reviewers read the wrapper's "NOT YET WIRED" header as a documented decision, and none of
them said the obvious thing, which is that unwired code should not be on `main` at all. It
was removed and deferred to the PR that verifies and wires it; the design survives here and
in `harness-engineering.md`. This also moots the step-output-credential concern a reviewer
raised, since that code is no longer in this change.
