# Agent-effort summary: cost + weighted tokens

Follow-up to the review-panel-metrics work. Makes the `## 🤖 Agent effort`
summary comment report resource weight honestly instead of leaning on a raw
token total that over-counts cheap work.

## Problem

The summary's headline was a raw token sum:

```
tokens = input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens
```

`cache_read_input_tokens` is re-processing of an already-cached prompt prefix.
It is billed at roughly **1/10** of fresh input, yet the raw sum counts it at
full weight — so a run dominated by cache reads looks far heavier than it was.
Raw tokens also can't reflect that the review panel may run pricier/other models
per token. Token count alone is not a good proxy for how expensive a run was.

## Change

- **Cost is the headline.** `total_cost_usd` is already parsed and summed into
  `costUsd` on every ledger record (`parseExecution` / `sumExecutions` /
  `aggregate`) — it was simply never rendered. It's the truest weight measure:
  the model prices cache reads at ~0.1× and pricier panel models correctly.
- **Weighted tokens** replace the raw headline token figure. `weightedTokensFor`
  re-weights the four usage fields toward spend: cache reads **0.1×**, cache
  writes **1.25×**, input/output **1×**. Raw is still shown in parens for
  reference. (Output stays 1× — an accurate output multiplier is model-specific,
  and cost already captures that exactly.)
- Per-section **Cost** + **Tokens** carry the code-fix vs. review split, so the
  "review panel is pricier per token" effect is visible.

Rendered shape:

```
## 🤖 Agent effort

- Total-cost: $4.10 (code-fix $3.30 + review $0.80)
- Total-tokens: ~340K weighted (~1.4M raw)

### Code-fix agent
- Cost: $3.30
- Tokens: ~300K weighted (~1.1M raw)
- Agents / Scope-size / Attempt / Sessions / Total-time / Turns

### Review panel
- Cost: $0.80
- Tokens: ~40K weighted (~300K raw)
- Agents / Rounds / Total-time / Turns / (existing panel-stat lines)
```

The weighting rationale lives in the PR description, not the rendered comment
(kept terse on purpose).

## Tasks

- [x] `weightedTokensFor` + `TOKEN_WEIGHTS` helper (exported, unit-tested).
- [x] Record `weightedTokens` in `parseExecution` and `sumExecutions`.
- [x] Sum `weightedTokens` in `aggregate`, falling back to raw `tokens` for
      pre-rollout records that lack the field (no silent under-count mid-rollout).
- [x] `formatUsd` (`$X.XX`, `<$0.01` for sub-cent non-zero).
- [x] `renderSummary`: Total-cost + Total-tokens headline; per-section Cost then
      Tokens; drop the old raw-only `Total-tokens` line.
- [x] Update `metrics.test.mjs`.
- [x] Update `.claude/skills/maintainer-merge/SKILL.md` (it documented that cost
      is never rendered — no longer true).
- [ ] `pnpm verify:fast` green; open follow-up PR.

## Notes / non-goals

- No per-model pricing table — deliberately. Weights are a fixed, coarse proxy;
  `costUsd` is the accurate figure and comes straight from the model.
- Ledger record schema gains one field (`weightedTokens`); `serializeRecord` /
  `parseMetricComment` are generic JSON and unchanged. Old records degrade
  gracefully via the raw-token fallback in `aggregate`.
