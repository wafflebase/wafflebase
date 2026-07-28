# Model refresh: Claude Opus 4.8 → Opus 5

Move every live Opus slot in the agent pipeline to `claude-opus-5`, plus the
prompt and token-budget changes the model change actually requires.

## Motivation

`claude-opus-5` is the current Opus at **the same price as 4.8** ($5/$25 per
MTok). For this pipeline the relevant documented improvements are on exactly the
weak axis: high precision *and* high recall on code review, with accuracy
retained at lower effort.

This does **not** substitute for the coverage-first rubric work later in the
series — the severity-filter recall problem (a lens that is told "only report
high-severity" faithfully declines to report) persists on Opus 5.

## Scope

- [x] Five workflows — `--model claude-opus-5` in `claude_args`:
      `agent-implement`, `agent-iterate-ci`, `agent-review-panel`,
      `agent-review-reply`, `agent-summarize`.
- [x] `scripts/agent/lenses/lenses.json` — all four lenses.
- [x] `scripts/agent/classify.mjs` — `MODEL_B`, **plus a raised token budget**
      (see below). `MODEL_A` stays on Haiku 4.5: it is the deliberate cheap
      first-pass tier, not a stale reference.
- [x] `agent-implement.yml` — scope-discipline instruction.
- [x] `agent-sdk-smoke-test.yml` — a `model` dispatch input, so the pre-flight is
      actually runnable.

## The one real breaking hazard

`classify.mjs` is the only caller that hits the **raw Messages API**, and it is
the only place `max_tokens` is set by hand.

On Opus 4.8, omitting the `thinking` parameter means no thinking. **On Opus 5 it
runs adaptive thinking by default**, and `max_tokens` bounds thinking *and*
response text together. The existing `max_tokens: 400` was sized for a
no-thinking model; under Opus 5 it would be consumed before the structured record
was emitted, truncating the response so `JSON.parse` throws.

Raised to 4000 rather than disabling thinking: these are analysis calls
(`MODEL_B` runs the bug-classification and skeptic passes), disabled thinking on
Opus 5 carries its own documented failure modes, and the records are small enough
that the ceiling is only ever headroom. Haiku has no adaptive default and never
reaches it.

## Corrections to the planned scope

- **Five workflows, not three.** `agent-review-reply` and `agent-summarize` also
  pin the model. Leaving them would have stranded two stale references for
  someone to swap blindly later.
- **The planned "subagent cap" prompt is not applicable.** Opus 5 delegates more
  readily than 4.8, but `Task` is absent from every `--allowedTools` list, so
  delegation is already blocked *mechanically* — a stronger control than a prompt
  instruction, and a cap would have been dead text. (The panel's own per-lens
  subagents are spawned by `review-panel.mjs` through the SDK, a separate
  mechanism, deliberately fixed at one per lens.)
- **`--max-turns` is a turn budget, not a token budget.** The
  thinking-on-by-default hazard therefore does not touch the five
  `claude-code-action` call sites at all; it is confined to `classify.mjs`.
- **Test fixtures left alone.** `metrics.test.mjs` uses `"claude-opus-4-8"` as an
  arbitrary model-name string in aggregation fixtures. Churning them would add
  diff noise and assert nothing.

## Deliberately kept, flagged for the reviewer

- **`agent-implement.yml` step 6 (SELF-REVIEW) stays.** Opus 5 guidance says to
  delete verification scaffolding because the model verifies unasked and explicit
  instructions cause over-verification. That targets "double-check your answer"
  phrasing; step 6 is a bounded step that produces a reviewer-facing artifact and
  demonstrably caught a real blocking finding on PR #548. Removing it is a
  reasonable follow-up, but it is a behaviour change this PR cannot measure, so
  it is left for a decision rather than bundled with a model swap.
- **`classify.mjs` `MODEL_B` is a measurement discontinuity.** The issue
  classifier (#566) records a two-pass agreement signal
  (`b1.bug_class === b2.bug_class`). Changing the model changes what that signal
  measures. Included for consistency — no stale Opus reference should survive —
  but if that data is being compared over time, pinning `MODEL_B` back to
  `claude-opus-4-8` is a one-line reversal.

## Pre-flight (do this before arming)

`auth-smoke.mjs` already honoured `SMOKE_MODEL`; the workflow never passed it, so
the documented pre-flight was not actually executable. Now:

**Actions ▸ "Agent SDK Auth Smoke Test" ▸ Run workflow ▸ model = `claude-opus-5`**

A green run proves the model id resolves on the pinned SDK (0.3.217) with the
configured token, before any real run spends budget on it.

## Verification

- All six touched workflows re-parse as YAML; the smoke-test input is confirmed
  to reach the step env.
- `agent-implement.yml`'s prompt builder executed end-to-end: parses, renders,
  zero unsubstituted placeholders, scope block present.
- `classify.mjs` passes `node --check`.
- `agent:tests` lane: 101 tests green.
- `pnpm verify:self` green.

Note the limits of that list: **none of it exercises the model.** The pre-flight
above is the only live check, and the real signal is rounds-to-converge, cost,
and sample agreement on the next few autonomous PRs.
