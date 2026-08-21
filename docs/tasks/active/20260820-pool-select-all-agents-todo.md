# Let every agent step use the credential pool, not just the SDK ones

## What broke

Issue #883's `@claude fix this issue` failed twice, 40 minutes apart, both in ~52
seconds:

```json
{ "type": "result", "subtype": "success", "is_error": true,
  "duration_ms": 432, "num_turns": 1, "total_cost_usd": 0 }
```

Authenticated, then nothing — no work, no cost. In the same hour the review panel's
fixer spent **5.7M tokens** successfully on #899. The pool was healthy. Slot zero was
not.

## Root cause

`token-pool.mjs` spreads load across several Claude accounts and survives one hitting
its usage window — but only for SDK-driven steps, because `claude-code-action` takes a
single credential and cannot import a Node module. So every action-based step was
hardcoded to `secrets.CLAUDE_CODE_OAUTH_TOKEN`, which is **slot zero of that same
pool** (`TOKEN_ENV`, "the unsuffixed variable is slot zero"). Five workflows shared
the pin:

| workflow | consequence while slot zero is down |
|---|---|
| `agent-implement` | **issue→PR is dead** — this is the pipeline's entry point |
| `agent-fix` | `@claude fix` on a PR does nothing |
| `agent-iterate-ci` | CI failures never get fixed |
| `agent-review-reply` | review replies never post |
| `agent-summarize` | no summary comment |

#894 fixed this for the panel's own `fix` job, using the pool state the panel records.
In its task doc I deferred the other five with the reasoning that "none of them runs
immediately after the panel drains the pool, so the exposure is much lower". **That
was wrong.** It assumed slot zero only fails transiently. A persistently dead slot
zero takes down every consumer regardless of timing, and I had deferred the most
important call site in the pipeline.

## The fix

- **`token-pool.mjs`** gains `currentSlotName()` — exactly `current()`, returning the
  slot's env-var NAME instead of the credential. That is what lets a workflow be told
  which slot to use without the token entering a step output.
- **`slotSuffix()` moves here too**, from `pick-fix-credential.mjs`. This module owns
  `TOKEN_ENV` and `MAX_SLOTS`, so it is the only place that can answer the
  name→suffix question without a second copy of the naming rule drifting from it.
  `pick-fix-credential.mjs` re-exports it, so its contract and tests are unchanged.
- **`pick-credential.mjs`** (new) selects by RUN ID via `createTokenPool`, the same
  rule the SDK path has always used, and emits `slot` / `reason` / `capacity`.
- **Four workflows wired**: `agent-implement`, `agent-fix`, `agent-iterate-ci`,
  `agent-review-reply`.

### Selection, not liveness

This cannot tell whether the slot it names is live — nothing short of spending a call
can, and a probe would cost the round trip it is trying to save. It converts "always
the same account" into "spread across the accounts that exist". A pool of one dead
credential still fails, and that is a capacity problem for an operator, not a routing
one.

### How this differs from `pick-fix-credential.mjs`

That one reads pool STATE the panel recorded — which slots it retired — so it can
refuse to spend a fix round when everything is spent. It only works where a panel ran
first. These jobs have no panel before them and no artifact to read, so they select
instead. Same output contract, different evidence.

### Trust posture, per call site

The picker receives all nine pool secrets, so a branch-controlled copy of it could
read every credential the pool holds. Each site runs a trusted copy:

| workflow | picker path | why it is trusted |
|---|---|---|
| `agent-implement` | `scripts/agent/…` | `issue_comment` default ref IS main; the workspace is main |
| `agent-fix` | `$RUNNER_TEMP/agent-tools/…` | staged from a main checkout before the branch checkout |
| `agent-iterate-ci` | `$RUNNER_TEMP/agent-tools/…` | same |
| `agent-review-reply` | `.trusted-cred/scripts/agent/…` | NEW sparse main checkout, placed AFTER the branch checkout because `actions/checkout` cleans its target path |

The nine secrets reach the picker step only. The action step gets exactly one, resolved
from the slot number through the `secrets` context — the same split
`ask.mjs::credentialEnv` keeps when it subtracts the pool from a child that reads an
untrusted checkout.

### Fail direction

Every failure path emits an empty slot, which the workflow resolves to the unsuffixed
secret — precisely how these steps behaved before. A broken picker can never be worse
than not having one. Each site also carries a `[ -f ]` guard, so a branch older than
the script skips rather than redding, and `continue-on-error: true`.

## Tasks

- [x] `currentSlotName()` on the pool; `slotSuffix()` moved to `token-pool.mjs`
- [x] `pick-credential.mjs` with `chooseSlot` / `capacityLine`
- [x] Wire `agent-implement`, `agent-fix`, `agent-iterate-ci`, `agent-review-reply`
- [x] Fleet invariant test + documented exception list
- [x] Mutation coverage 12/12; full `agent:tests` lane green (2296 pass)

## Deliberately not wired: `agent-summarize`

It has **no repo checkout at all**, and its Claude step is named "Summarize
(read-only; no repo credentials)" — it was deliberately built without them. Running
the picker needs a trusted copy of it on disk, so wiring it would mean adding a
checkout to the one job designed not to have one, for the least consequential step in
the pipeline. It is listed in `AMBIENT_ALLOWED` in the test with that reason, so the
exception is explicit rather than an oversight.

## Still the binding constraint

Only 2 credentials are registered. Selection spreads across whatever exists, so with
2 accounts it spreads across 2 — and if both are down, everything still fails. The
capacity line now says so out loud (`N of 9 credential slot(s) configured — register
more`). The immediate unblock for #883 is unchanged and needs no code: point the
unsuffixed secret at a working account, or register `_3..8`.
