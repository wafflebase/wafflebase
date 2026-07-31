# Detect stalled review rounds

Page a human as soon as the review-fix loop is demonstrably re-litigating the
same findings, instead of waiting for the blunt `MAX_REVIEW_ROUNDS` cap.

Script-only; no workflow edit required.

## Motivation

`MAX_REVIEW_ROUNDS = 5` is the only exit from the fix loop today. On PR #521 the
loop burned all five rounds on overlapping findings before anyone was paged —
five panel rounds plus five fixer sessions of budget spent re-covering the same
ground. Detecting the shape earlier pages at round 3 and saves the difference.

This also matters more after the recall work later in this series: a
coverage-first rubric and a stricter verifier both raise the number of findings
that survive to the gate, so rounds get more expensive before they get cheaper.

## The trap this design exists to avoid

**Round-to-round overlap is not evidence of a stall.** `review-panel.mjs`
deliberately re-merges every unresolved prior finding into the current round
(the cross-round re-check that guards against false negatives), so a *healthy*
PR that fixed 2 of 5 findings still shows 3 identical findings next round.
Keying on overlap alone would page on essentially every PR.

What separates #521 from a healthy PR is that **the blocking count did not go
down**. So a round pair stalls only when it is both highly overlapping *and* not
shrinking, and two consecutive such pairs are required before paging.

## Scope

- [x] `scripts/agent/rounds.mjs` — new pure exports: `summaryTokens`,
      `findingSimilarity`, `repeatRatio`, `groupReviewRounds`,
      `detectStalledRounds`, `DEFAULT_SIMILARITY`.
- [x] `scripts/agent/review-round-guard.mjs` — run the check before the
      round-cap branch; page naming the repeated findings. Tuning via
      `STALL_REPEATS` / `STALL_SIMILARITY` env, so no workflow edit is needed.
- [x] `scripts/agent/rounds.test.mjs` — 15 new cases.

## Design decisions

- **Similarity is calibrated on real findings, not guessed.** The first draft
  used Jaccard at a 0.6 threshold. Measured against PR #564's four *verbatim*
  design-fit rephrasings of one defect (vs. four unrelated real findings from
  #564/#548):

  | metric | same defect | different defect |
  |---|---|---|
  | jaccard | 0.19 – 0.52 | 0.00 – 0.04 |
  | dice | 0.32 – 0.68 | 0.00 – 0.09 |
  | **overlap** | **0.39 – 0.71** | **0.00 – 0.08** |

  Jaccard at 0.6 would have matched **none** of the four real rephrasings.
  Shipping the overlap (containment) coefficient at **0.3** — widest margin, and
  the right semantics, since the panel restates one defect at different levels
  of detail and Jaccard penalises the extra specifics in the longer wording.
  Backed by an absolute `shared >= 3` token floor (true pairs share 7–17 tokens,
  false pairs at most 1).
- **Matching is many-to-one, not greedy one-to-one.** A one-to-one pairing was
  tried first; it scored #564's "2 priors became 4 rephrasings" at 0.5 and
  missed, under-reporting precisely when the loop is most obviously spinning.
  The question is "how much of this round is recycled", and four wordings of two
  priors is all of it. The inflation risk one-to-one guarded against is covered
  by the count test instead.
- **Similarity is gated on lens + file.** A different lens or file scores 0
  outright, so three distinct bugs in one file — fixed one per round — never
  read as one finding repeated three times.
- **Fails toward NOT paging.** Malformed rounds, an unreadable check payload, an
  infra/quota round, or too little history all return `stalled: false`. This is
  the one place in this pipeline where safe means *keep going*:
  `MAX_REVIEW_ROUNDS` is still the backstop, and a spurious page — summoning a
  human off a converging loop — is the more expensive error.
- **Fuzzy matching stays out of `dedupeFindings`.** That function *drops*
  findings, and over-merging two distinct bugs there is exactly the fail-open its
  own comment warns about. This path only ever reports.
- **No new API calls in the happy path.** The guard already paginates every PR
  commit and its check runs. `output.text` can be omitted from the list
  response, so it is back-filled — but only for the newest `STALL_REPEATS + 1`
  commits carrying lens runs, and only where the field is missing.
- **Env-tuned, not positional.** The guard already takes five positional args,
  and env config means this ships without a workflow edit (the agent App cannot
  push `.github/workflows/**`).

## Relationship to `detectFlips` (#568)

Complementary, not overlapping. `detectFlips` reads severity **counts** from the
metrics ledger to spot a lens going blocking → clean (a false-negative signal,
reported only). This reads finding **text** from check runs to spot rounds that
never converge, and it **acts** by paging. No shared machinery.

## Verification

- `agent:tests` lane: 93 tests green (15 new).
- Similarity calibrated and asserted against the verbatim #564 strings, so a
  regression in tokenisation or threshold fails the suite.
- End-to-end against the real script with a stubbed `gh`: a 3-round repeat pages
  with `paged=true proceed=false`; a shrinking 2→1→0 sequence sets
  `proceed=true`; a list response missing `output.text` is back-filled and still
  detected; and when the back-fill *also* fails the rounds go partial and it
  correctly does **not** page.
