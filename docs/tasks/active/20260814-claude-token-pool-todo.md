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

- reads the slots from the environment, filters empties, preserves declared order;
- `pick()` — the run-derived starting token;
- `advance(reason)` — marks the current token exhausted and returns the next live one, or
  `null` when the pool is dry (the point at which failing is right);
- pure and injectable (env and run id as arguments) so the tests need no runner.

### `scripts/agent/ask.mjs`

- `buildSessionOptions()` gains `env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: <token> }`.
  The spread is load-bearing: the SDK's `Options.env` **replaces** the subprocess
  environment rather than merging it (verified against the pinned 0.3.217 `sdk.d.ts:1408`),
  so omitting it strips `PATH`/`HOME` and the CLI never starts.
- Per-call `env` rather than mutating `process.env` because the panel runs lenses and
  samples concurrently; a global swap mid-failover would hand a half-changed environment to
  calls already in flight.
- `withRetry` learns one new case: an error that is `kind: 'api-error'` and non-retryable
  **because it matched `SESSION_LIMIT_RE`** consumes a failover instead of throwing. Every
  other non-retryable error throws exactly as it does today — a 401 from a bad token must
  not burn the whole pool.
- Exhaustion is process-scoped, so the six lenses of one panel round make the discovery
  once instead of six times.

### Action lane

A composite action, `.github/actions/claude-agent-run`, wraps `claude-code-action` with the
same pick-then-failover ladder and takes the pool as inputs. Six workflows change one
`uses:` line each rather than growing a retry ladder apiece.

Open question to settle in implementation, not now: whether the second attempt can tell an
exhaustion apart from an ordinary agent failure. `claude-code-action` writes
`claude-execution-output.json` (already uploaded as an artifact by every one of these
workflows), so the ladder can read the same `SESSION_LIMIT_RE` signal out of it. If that
proves unreliable, the fallback is to retry on any failure and accept one wasted attempt.

### What is deliberately not in scope

- **Cross-job exhaustion state.** Two jobs starting inside the same window can both
  discover the same dead token. Sharing that costs a store; the waste is one failed call
  per job.
- **Usage-aware balancing.** Nothing reports remaining quota per token, so "even" here
  means even in job count, not in tokens consumed.

## Tasks

- [ ] `scripts/agent/token-pool.mjs` + `token-pool.test.mjs` — discovery, ordering, run-id
      selection, `advance()` past exhausted slots, dry-pool returns `null`, single-token
      pool behaves exactly as today
- [ ] `ask.mjs` — `options.env` wiring with the `process.env` spread; `askStructured`
      threads the pool's current token
- [ ] `ask.mjs` — `withRetry` failover on the session-limit signal only; assert in
      `ask.test.mjs` that a 401 and a `kind: 'limit'` (our own turn ceiling) still throw
      without consuming a token
- [ ] `.github/actions/claude-agent-run/action.yml` — pick + ladder; confirm composite
      steps honor `continue-on-error` on this runner before relying on it
- [ ] Verify `secrets[format('CLAUDE_CODE_OAUTH_TOKEN_{0}', N)]` dynamic indexing on a real
      runner via `agent-sdk-smoke-test.yml` **before** the composite action depends on it
- [ ] Register `CLAUDE_CODE_OAUTH_TOKEN_1..N` in the `agent` environment
- [ ] Roll out: SDK lane first (`agent-sdk-smoke-test` → `eval-replay` → panel), action lane
      after
- [ ] `pnpm verify:fast`
- [ ] Update `docs/design/harness-engineering.md` with the pool and the per-job constraint

## Review

_(filled in after implementation)_
