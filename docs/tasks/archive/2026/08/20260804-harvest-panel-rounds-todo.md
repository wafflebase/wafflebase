# Harvest: derive the cutoff from the panel's own check runs

The feedback corpus proposer keyed "when did the panel let go of this PR" off a comment
and, through it, "what had the panel concluded" as well. Both now come from the panel's
check runs, and the second is resolved per CodeRabbit comment rather than once per PR.

## The problem

`harvestPr` had one cutoff, `handoffTime`, built from the `<!-- agent-handoff -->`
comment with the `ready_for_review` timeline event as a fallback. Four things were wrong
with it, and the fourth is the one that cost data.

1. **No marker, no harvest.** `mark-ready.mjs` posts the marker inside a `try/catch`
   AFTER flipping the PR ready, so a genuinely promoted PR can carry none. Measured: 18
   of 33 agent PRs have neither a marker nor a `ready_for_review` event, because they
   were opened ready rather than promoted.
2. **`ready_for_review` answers a different question.** It fires whether or not the
   panel ever spoke, so on a manually-readied PR every later human commit became a
   candidate. It over-fired on the PRs it covered and covered none of the PRs it was
   reached for.
3. **A rebase erased it.** The cutoff was a comment timestamp compared against COMMITTER
   DATES. A force-push after promotion rewrites every one of those, so every commit
   post-dated the cutoff, `beforeHandoff` emptied, and `headAtHandoff` went undefined.
4. **Signature 2 read the panel THROUGH signature 1's cutoff.** The comparison set came
   from whichever commit was head at hand-off. So (a) no hand-off meant no comparison
   set and every CodeRabbit candidate withheld on a PR whose check runs were readable
   the whole time, and (b) one set was applied to every finding regardless of which
   commit it was about — wrong in both directions depending on where the hand-off commit
   sat relative to the comment.

Signature 2 never needed a hand-off. "CodeRabbit flagged something our panel reviewed and
did not raise" is exactly as true on a human PR reviewed via `@claude review`, where
nothing was handed off at all.

## The change

- [x] `panelRounds(commits, runsFor)` — one entry per commit the panel CONCLUDED on,
      `{sha, index, conclusion, reviewedSha, completedAt, runs}`. Pure, with `runsFor`
      injected, so the ordering decision is testable without an API.
- [x] `panelApprovedAt(rounds, markerAt)` replaces `handoffTime`. Check runs first,
      marker as a fallback, `ready_for_review` **removed outright** rather than demoted —
      keeping it as a last resort would preserve the over-fire in exactly the cases
      nothing else can check. The timeline request is gone with it.
- [x] `commitIndex` + `roundsUpTo(rounds, index)` — the comparison set is now the union
      of rounds AT OR BEFORE the commit a finding is about, resolved per comment.
- [x] `commentRounds` — an `@claude review` is a round too, with `conclusion: ""`. It was
      a whole-PR fallback; as a round it gets the same per-commit treatment the gating
      arm does, and it can never become signature 1's cutoff.
- [x] `panelRoundAt` splits the CHEAP half of a verdict (conclusion, reviewedSha,
      completedAt — all in the check-runs LIST response) from the expensive half. Two
      phases: one list call per commit to establish the history, and the per-run
      `withFullOutput` refetch only for rounds a candidate is actually compared against,
      cached by sha. `panelVerdictAt` now calls it, so the aggregate conclusion rule
      ("one failing lens means the panel did not let it through") stays in one place.
- [x] `markerHandoffAt` keeps "FIRST marker, not the last".

## Corrected while building

- **The newest approval is self-defeating, and only real data showed it.** The first
  implementation took the NEWEST all-success round. Every human fix opens a new round,
  and that round approves too — so on #548 the cutoff landed on 2026-07-28, four days
  after the three human fixes of 2026-07-25, and **lost all three, including rows a
  human has already curated into `misses.jsonl`**. It is the FIRST approval, matching
  `markerHandoffAt`'s own rule: a later re-approval does not un-say the first one.
- **An unreadable commit keeps its sha.** Dropping the round entirely lost the property
  the previous code deliberately had — "we know which commit the panel was looking at
  and we could not read what it concluded" — which is what tells an API hiccup apart
  from a PR the panel never touched. It is now an `unreadable: true` round: carries the
  sha, never counts as evidence, and makes the comparison set refuse rather than resolve
  to `[]`.
- **Timestamps are compared as parsed instants.** Lexicographic order works for the `…Z`
  form GitHub returns and stops working silently for any offset form.
- **Bug 4's direction was stated backwards in the first draft of its test.** Measured,
  the old code UNDER-suppressed on that fixture (filing a genuine restatement as a
  miss); the over-suppression direction is real but needs the hand-off commit to sit
  later than the comment. Both are now described, and the test says which one it
  demonstrates.

## Fail directions

| path | on doubt | why |
|---|---|---|
| `panelApprovedAt` | **null** | null means "cannot classify" and signature 1 goes silent. Treating it as "approved at time zero" makes every commit on the PR a candidate — the over-fire that removing `ready_for_review` exists to end |
| an unreadable round | **`null` blockers**, never `[]` | `[]` claims "this round raised nothing blocking" about a round nobody has seen, which files every CodeRabbit finding on the PR as a miss |
| one unreadable commit | costs its round, not the walk | a PR is not forfeited by one bad request; the rest of its history still resolves |
| an unplaceable finding or round | **widen** the comparison set | what cannot be placed cannot be excluded. Widening can only over-suppress a finding the panel really did raise; narrowing on a guess writes a false row, and a curated false row is permanent |
| a round we could not read inside an eligible set | collapse the whole set to `null` | a union missing one round would claim the panel raised nothing where it may have raised exactly this |
| the `ROUND_WALK_LIMIT` cap | proceed, and **log** | a silently truncated history makes "the panel never approved" indistinguishable from "we stopped looking" |

## Explicit non-goals

- **No schema change.** `wafflebase/miss@1`, same fields, same order. `handoffAt` keeps
  its name and now means "when the panel approved", which is what every consumer already
  assumed. Existing ids are unchanged, so `dedupeById`'s first-wins rule still protects
  every curated `verifiedBy` — verified on #548, which re-harvests to the same four ids.
- **No change to `attributeToPanel`, `bestMatch` or `clusterFindings`.**
- **No widening to `minor`/`nit` CodeRabbit findings.** That needs the panel's
  non-blocking findings to compare against, which is the collector's job.
- **`--append` untouched**, including both refusal paths. It was not run.

## Verification

- [x] `node --test "scripts/agent/*.test.mjs"` — **676 tests, 675 pass, 0 fail, 1
      skipped**; 662/661 on `upstream/main` (`35206e585`). 14 new tests.
- [x] `eslint scripts` — clean, under the repo's pinned `eslint@9.24.0` from
      `pnpm-lock.yaml`. Worth naming: `eslint@9.39` (what a bare `^9.21.0` install
      resolves to today) adds `no-useless-assignment` to `recommended` and flags the
      pre-existing `let files = []` in the signature-1 loop, on `upstream/main` as well
      as here. That is a version difference, not a defect this PR introduced or should
      fix.
- [x] **Each bug pinned by a test named after the failure**, and a before/after harness
      confirms the old code behaved differently on 4 of 5:

      | case | before | after |
      |---|---|---|
      | 1 · no marker anywhere | 0 candidates, `skipped` | human-fix + coderabbit, not skipped |
      | 2 · manually readied, never approved | 1 human-fix (the over-fire) | 0, `skipped` |
      | 3 · rebase rewrote every committer date | CodeRabbit withheld | compared against the real verdict |
      | 4a · finding earlier than the round that raised it | not suppressed | not suppressed *(regression guard, not a fixed bug)* |
      | 4b · finding on the commit the panel raised it at | filed as a miss | suppressed |

- [x] **Real PRs, read-only, before vs after — #548, #559, #578, #582, #591, #649, and
      the no-marker population #581, #590, #605, #652. Candidate sets IDENTICAL on all
      ten.** #548's `handoffAt` moves 22 seconds (the check run at 15:48:06 rather than
      the marker at 15:48:28) with the same four ids. #591 and #605 change only their
      `skipped` reporting, correctly: the panel reviewed but never approved, and there
      is no CodeRabbit input.
- [x] **API cost, measured.** #548 (9 commits) 13 → 24 calls; #582 (7 commits) 4 → 10.
      The increase is one check-runs LIST per commit, minus the timeline request that is
      now gone. Real PRs here run 1–9 commits, so `ROUND_WALK_LIMIT = 100` never binds.

## Not built, and the honest limit of this change

- **No measurable gain on today's data.** This is the part worth stating plainly: the
  plan predicted more candidates on no-marker agent PRs, and on live data there are
  none. #581, #590 and #605 have no marker, but the panel never APPROVED them either, so
  signature 1 has no referent under the new cutoff any more than the old one; and they
  carry no CodeRabbit blocking findings, so signature 2 has no input. The gains here are
  demonstrated synthetically, not measured. What the change buys is a mechanism that is
  correct for the next PR — the rebase case and the per-comment anchoring are latent
  bugs, not observed losses.
- **The `minor`/`nit` population.** Waits on the stage-detail collector.
- **A third signature.** `scripts/agent/eval/github-signals.mjs` on the eval-harness
  branch derives an `is_real` vote from an author's reply to a bot finding
  ("Done in `<sha>`" / "not a defect because…"). It needs no cutoff at all — it reads a
  thread, not a timeline — and is the natural next signature. Out of scope here.
