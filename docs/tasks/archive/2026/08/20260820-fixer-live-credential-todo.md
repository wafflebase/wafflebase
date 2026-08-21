# Stop dispatching the fixer onto a credential that is already dead

## What happened

`@claude rerun` on #873 and #876 both failed, and neither failure was about
findings or convergence. Both were credentials.

**#873** paged with "a review lens did not produce a valid verdict". The
`blast-radius` lens said why: `every credential in the pool (2) was retired —
nothing left to fail over to`. The other three failing lenses had real findings; the
page came from the INFRA path, so no gate was ever consulted.

**#876** completed review (with the verifier erroring on 2 of 3 findings —
"commonly an API/session-limit 429"), dispatched fix round 1 of 3 on `dcff43ecf`,
and then:

```
10:06:10  Claude Code initialized
10:06:12  ##[error]Claude result reported subtype success with is_error:true
          recorded review-fix for PR #876: turns=1 tokens=0
```

Dead 1.6 seconds after init, zero tokens spent, branch head unchanged — and the
round had already been recorded, so the PR paid a fix round for a session that
never started.

## Root cause

Two defects, one of them structural.

**1. Capacity.** The workflow passes nine slots (`CLAUDE_CODE_OAUTH_TOKEN` plus
`_1..8`) but only **2 distinct credentials** are registered — the pool reports its
own size as 2. One round spends 6 lenses plus a verifier per blocking finding;
#873's last round alone was $62 of review. Two accounts cannot cover that.

**2. The fixer never had failover, and used the credential most likely to be dead.**
`token-pool.mjs` is a Node module, so only SDK-driven steps can consult it. Every
`claude-code-action` step takes the single unnumbered secret instead —
`agent-fix.yml`, `agent-implement.yml`, `agent-iterate-ci.yml`,
`agent-review-reply.yml`, `agent-summarize.yml`, and the `fix` job here. The `fix`
job receives **zero** pool variables.

And the unnumbered secret is **slot zero of that same pool** (`TOKEN_ENV`, "the
unsuffixed variable is slot zero"). So the panel burns the accounts' windows and the
fixer then runs on slot zero inside the same run. `isExhausted`'s own docblock
already named the hazard:

> falling back there would re-use the ambient token, **which in these workflows is
> slot zero: a credential the pool has already retired**

The fixer was structurally set up to fail immediately after any heavy panel round.

## The fix

A one-way channel from the job that owns the pool to the job that cannot consult it.

- **`token-pool.mjs`** — `createTokenPool` now keeps slot NAMES (via `readPoolSlots`
  rather than `readPoolTokens`) and exposes `liveSlotNames()` /
  `retiredSlotNames()` / `slotNames()`. Names only: the report travels in a workflow
  artifact, which is not a credential store.
- **`review-panel.mjs`** — writes `review-pool-state.json` beside the existing
  execution log: `{v, size, maxSlots, live, retired}`. Best-effort, like every other
  file there.
- **`pick-fix-credential.mjs`** (new) — reads that state and emits `slot=` /
  `available=` / `capacity=`. `slotSuffix` re-derives the suffix from the KNOWN slot
  list rather than trusting the artifact, because the caller interpolates the result
  into a `secrets[...]` lookup and a tampered name must not be able to aim it
  elsewhere.
- **`agent-review-panel.yml`** — the picker runs BEFORE the dispatch record; the
  dispatch record and the fixer are both gated on it; the fixer is handed
  `secrets[format('CLAUDE_CODE_OAUTH_TOKEN_{0}', slot)]`, so only the slot NUMBER
  passes through a step output and the token stays inside GitHub's masking.

### The fail directions are deliberately NOT uniform

- **Cannot read the state** (no artifact, malformed JSON, picker skipped on an older
  branch, step errored) → **proceed**. Not knowing whether the fixer would work is
  no reason to skip a fix that might. This is exactly today's behaviour, so a
  half-wired hand-off costs nothing.
- **KNOW every slot is retired** (`live: []` with `size > 0`) → **refuse, and spend
  nothing**. Here we do know, and dispatching burns one of three rounds on a session
  that cannot start.
- **`size: 0`** is a repo with no pool, not a drained one → proceed on the ambient
  credential.

Both gates are written `!= 'false'`, never `== 'true'`, so an unset output proceeds.

### A refusal has to page

Skipping the steps leaves the `fix` job GREEN, and the `stalled` net keys on
`r.fix === 'failure'` — so without its own page the PR would stall silently with no
comment at all. The page states that no fix round was consumed, carries the capacity
line, and carries the handoff sentence the latch invariant requires (caught by
`rounds.test.mjs`'s "every site that writes the latch also says the panel has
stopped" — my first version violated it).

## Tasks

- [x] `token-pool.mjs`: slot names, `liveSlotNames`/`retiredSlotNames`/`slotNames`
- [x] `review-panel.mjs`: write `review-pool-state.json`; add it to the artifact upload
- [x] `pick-fix-credential.mjs`: `slotSuffix`, `chooseCredential`, `readPoolState`, `capacityNote`
- [x] Workflow: picker before the dispatch record, both gates, slot-resolved token, refusal page
- [x] Tests (15 + 4) and mutation coverage (11/11)
- [x] Full `agent:tests` lane green

## NOT done here — the capacity half needs a human

Registering credentials needs the token VALUES, which this change cannot and should
not handle. The implementable half is done: the pool's size is now reported, and the
refusal page says `N of 9 credential slot(s) configured — register more`, so the
next occurrence is self-explaining instead of mysterious.

The remaining action is manual, and it is the binding constraint:

```bash
gh secret set CLAUDE_CODE_OAUTH_TOKEN_3 --repo wafflebase/wafflebase
gh secret set CLAUDE_CODE_OAUTH_TOKEN_4 --repo wafflebase/wafflebase
# ...up to _8; each prompts for the value on stdin so it never enters shell history
```

No workflow edit is needed — all nine variables are already passed, and
`readPoolSlots` drops the empties. Distinct accounts only: identical values dedupe to
one slot on purpose, so the pool cannot "fail over" from a dead token to itself.

## Deliberately out of scope

- The other five `claude-code-action` call sites (`agent-implement`, `agent-fix`,
  `agent-iterate-ci`, `agent-review-reply`, `agent-summarize`). They share this
  defect, but none of them runs immediately after the panel drains the pool, so the
  exposure is much lower — and each needs its own pool-state source, since only this
  workflow has the panel's artifact to read. Worth a follow-up once this shape is
  proven in production.
- Reserving a slot exclusively for the fixer. With 2 credentials that halves the
  panel's pool; revisit once more are registered.

## Review findings on #894 — both valid, both fixed

**The gate was INERT as first written.** I guarded and invoked the picker from
`.trusted/scripts/agent/pick-fix-credential.mjs`. The fix job has no `.trusted`
directory — that belongs to the review-panel job. This job snapshots trusted main into
`$RUNNER_TEMP/agent-tools` *before* checking out the branch, and every other script it
runs uses that path. So the `[ -f ]` guard was always false, the step exited 0, and
nothing downstream changed: the fixer still got slot zero.

My own wiring test asserted the `.trusted` path and passed, which is the failure mode
I keep guarding against elsewhere — a path assertion proves nothing unless the path is
one the job actually creates. The replacement test asserts the staged invocation AND
that **no fix-job step references `.trusted` at all**, which is the invariant that
would have caught it. Verified by reverting the path: two tests go red.

**The refusal now requires a self-consistent artifact.** Refusing stalls the PR and
pages a human; proceeding costs at most one wasted round. So `available: false` is
reachable only when the artifact agrees with itself: known `v`, an integer `size`
within bounds, an empty `live`, and a `retired` list of recognised, unique slot names
whose count equals `size`. Previously `{live: [], size: "banana"}` refused — `Number()`
gave NaN, NaN !== 0, and a malformed artifact stalled the PR, contradicting this file's
own stated fail-open rule.

The version check is the widest of these: `v` is the only thing asserting that these
field names mean what the reader thinks, so an unrecognised version makes `live: []`
uninterpretable rather than conclusive. A future panel that bumps the format degrades
to today's behaviour instead of refusing every fixer until the reader catches up. A
writer/reader mismatch would silently disable the whole feature, so the two literals
are now pinned against each other by a test.

One honest note on that validation: the `size` sanity check is **outcome-redundant** —
the retired-count check rejects the same inputs, so its mutation survived at first. It
is kept because it produces the precise `reason`, which is logged, published as a step
output, and is the operator's only clue about what went wrong. The reasons are now
asserted individually, which is what makes the check load-bearing for real behaviour
rather than decoration.
