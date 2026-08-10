# Make the review side as legible as the fix side (observability, phase 4)

## The problem

Phases 1–3 (#681, #688, #690) made the loop's *decisions* visible from the PR
page. Reading the agent PRs since, three gaps are left, and only one of them is
the gap it looks like.

**The panel never reports in the PR conversation on an autonomous PR.**
`review-comment.mjs:17` says so outright — the triage renderer "is used only by
`agent-review-on-demand.yml`, which posts no checks". The two arms are
complementary and neither is complete: on-demand posts a comment and no checks,
the autonomous panel posts checks and no comment. Measured across 19 `agent/*`
PRs, panel comments = 0 on every autonomous one. The findings themselves are
good (#737 round 3's `design-fit` body carries a verdict headline, the blocking
finding with verifier confidence, and two minors); they are parked in per-commit
check runs that nothing in the conversation links to, because `loop-status.mjs`
renders each round's head SHA as a plain code span.

**Disputes are unreadable in both directions.** The channel is complete — a
rebuttal renders a visible `### ⚖️ Finding disputed` comment, the panel reads it,
adjudicates, and `severity.mjs::adjudicationNote` renders the outcome. But **0
rebuttals have ever been filed on any agent PR**, and nothing renders a negative,
so a round where nobody disputed anything is byte-identical to a round where the
channel broke. `rebuttal.mjs::cmdPost` exits 0 silently when a post fails.

**#695 was never a missing fix report.** The fix agent ran ONCE and reported
once; the round count was wrong.

| commit | at | pushed by | panel | counted? |
|---|---|---|---|---|
| `8d85caa13` | 09:49:04 | implement | real, 4❌ (first verdict 09:57:43) | no — before the floor |
| `66b5b2833` | 10:00:33 | implement's **self-review** | **cancelled** → 6 fail-closed ❌ | **yes** |
| `3a6f5859f` | 10:01:30 | implement's self-review (docs) | real, 3❌ | **yes** |
| `6d0b9229f` | 10:38:05 | **the fix agent** — the one report | real, 4❌ | **yes** |

Two independent causes stack. `fixAttemptCommits` discriminates on "committed
after the panel first spoke", which is a race the implement job's self-review
push can lose: on #695 it lost by 2m50s and two implement pushes were charged as
fix attempts; on #737 the same push won by **20 seconds** and was correctly
excluded. And a panel CANCELLED by the concurrency guard still ran its
`always()` verdict step, found no `panel.json`, and wrote six fail-closed reds
onto a commit nobody reviewed — a third phantom round, with nothing paging
because the `fix` job was cancelled too.

## The change, phase 4a — the round count means what it says

- [x] **Dispatch ledger** (`scripts/agent/rounds.mjs`, marker
      `<!-- agent-fix-dispatch -->`): the guard records each dispatch and counts
      the records instead of inferring from commit shape. `fixRoundsUsed` falls
      back to `countFailedReviewRounds` on a PR that predates the ledger, and the
      first record carries a `prior` baseline so a PR mid-flight does not earn
      its already-spent rounds back. A `@claude rerun` that cuts the ledger drops
      the baseline with it.
- [x] **A narrower author gate than the paged latch's, on purpose.** Records are
      believed only from `github-actions[bot]` — the guard's `GITHUB_TOKEN`
      identity — with no association path. `yorkie-agent[bot]` is refused even
      though it is a trusted latch author, because that is the **fixer's** App
      identity: records become authoritative the moment one exists, so allowing
      the bounded party to write one lets it choose the rule it is counted by.
      The latch can accept more because over-accepting there only stops the loop.
- [x] **The write is not best-effort.** A dispatch whose record never landed is a
      round spent off the books that the next guard hands out again, so an
      unwritable record reds the step (and the `stalled` net pages) rather than
      being swallowed like the fail-safe writes around it.
- [x] **The round is spent immediately before the fixer, not at the guard.** The
      guard STAGES the record to `$RUNNER_TEMP`; the workflow posts it in the step
      right before `Address panel findings`. The first version posted from the
      guard — fourteen steps and a `pnpm install` earlier — and since this
      workflow is `cancel-in-progress`, a push during that one-to-three-minute
      window would have consumed a round for a fixer that never started: the same
      phantom-round shape this change exists to remove, reintroduced smaller.
      (#695 itself had pushes 57 seconds apart.) The window cannot be closed
      entirely, but from the new position a cancellation costs a round for a fixer
      that had genuinely begun. Raised by CodeRabbit on #742.
- [x] **Visible line above the hidden record**, the shape `fix-report.mjs` and
      `rebuttal.mjs` already use. #690's lesson was written about exactly this:
      a marker-only body is "an empty-looking bot comment". A dispatch was also
      the one loop event with no timeline surface at all — the panel's verdict
      lives on the commit's checks and the fixer's account is its own comment,
      but nothing said *round 2 starts here*. One line, since the loop-status
      dashboard already carries the budget.
- [x] **A superseded round is not a failed round**
      (`.github/workflows/agent-review-panel.yml`): the verdict step is
      `!cancelled()` instead of `always()`, and `close-stuck-checks` closes a
      cancelled panel's lenses as `cancelled` rather than `failure`, with a
      summary saying the newer commit's panel is the verdict of record.
- [x] **Both surfaces read the same number.** `loop-status.mjs` calls
      `fixRoundsUsed` too, and the budget line is relabelled **"Fix rounds
      dispatched"** — the guard's job-summary prose that described the old
      counting method is corrected in `guard-verdict.mjs`.

### Verification (4a)

- `scripts/agent` lane run as CI runs it (recursive glob, `scripts/agent/node_modules`
  absent): 0 failures.
- **Sixteen mutation tests, all caught.** Dropping the login check, dropping the
  bot-type check, dropping the fallback, dropping the baseline, letting the
  baseline survive a rerun cut, forgiving an undatable record, reverting the
  workflow to `always()`, reverting the superseded conclusion to `failure`,
  drifting either surface back to `countFailedReviewRounds`, and wrapping the
  staging write in a `try/catch` each turn exactly one test red. So do the five
  guarding the cancellation window: posting from the guard again, slipping a step
  between the record and the fixer, making the post `continue-on-error`, dropping
  the empty-staged-file check, and letting the guard's staged path drift from the
  one the post reads.
- `rounds.test.mjs` carries #695's real commit/verdict timestamps: the old rule
  returns 3, the ledger returns 1.
- **Branch protection checked** before changing a check conclusion: only
  `verify-self`, `verify-browser` and `verify-integration` are required on
  `main`, so no `agent-review-*` conclusion can affect merge eligibility. The
  promote gate is unchanged either way — `checks.mjs::checkPassed` accepts only
  `success`, and treats an absent check as a failure.

## The change, phase 4b — the panel's verdict reaches the conversation

- [x] **One comment per round** (`scripts/agent/panel-round-comment.mjs`, marker
      `<!-- agent-panel-round:<sha> -->`, upserted per SHA so a CI re-run updates
      rather than duplicates). Composition, not new rendering: `collectLenses` +
      `renderReviewComment` from `review-comment.mjs`, `buildRounds` from
      `loop-status.mjs` — so the round number this comment prints and the one the
      dashboard's table prints come from the same function and cannot disagree.
- [x] **Marker neutralization is load-bearing, not hygiene.** The panel job posts
      as `github-actions[bot]`, a trusted paged-latch author, over lens summaries
      that quote this repo's own markers as a matter of course — #681 is the
      recorded incident. Everything interpolated goes through
      `loop-status.mjs::neutralizeHiddenMarkers`, covered by a test that plants a
      live latch inside a finding summary and asserts exactly one live
      HTML-comment opener survives: ours.
- [x] Wired into the `review-panel` job beside `Update loop status`; no
      permission change (that job already holds `issues: write` and already posts
      a comment through the same token and the same `.trusted` copy).
- [x] **Three bodies, because silence is ambiguous.** `renderReviewComment`
      returns `""` for a round with no findings, so a clean round would otherwise
      render empty and read as "the panel never ran" — it gets its own sentence.
      A round that blocked without producing readable findings gets a third,
      because "no findings" there would be a lie in the dangerous direction. And
      `panel.json` missing is detected directly rather than inferred: with it
      absent every lens reads `failure` with no findings, byte-identical to a real
      all-red round, and reporting six fail-closed reds as findings would present
      a review that never happened.

### Verification (4b)

- 15 unit tests; `scripts/agent` lane green; `pnpm lint:scripts` clean.
- **Eight mutation tests, all caught** — dropping neutralization, the clean-round
  branch, the fail-closed branch, the SHA from the marker, the marker-leading
  ownership check, the paged-latch refusal, the workflow invocation, and `--sha`.
  The wiring test needed strengthening to catch the seventh: its first version
  matched the `[ -f … ]` existence guard, so deleting the `node …` line left it
  green with the script never running.
- Rendered against a fixture (`--dry-run`) and read as a human would.

## The change, phase 4c — the round table becomes a map

- [ ] Link each round's head cell to that commit's checks, with `commitBase`
      derived inside `main()` from `GITHUB_SERVER_URL`/`GITHUB_REPOSITORY` rather
      than a new CLI flag — `renderLoopStatus` has six call sites across four
      workflows and the module requires caller-independent values, so a flag some
      arms pass would make the link flap.
- [ ] A `Fixer` column per round — `N fixed · N skipped · N disputed`, or `—`
      when the fixer was never dispatched — from `collectFixReports`,
      `collectRebuttals` and 4a's dispatch records.
- [ ] Render 4a's new `cancelled` lens conclusion as **superseded** rather than
      letting it fall through `lensCell`'s trailing branch, which currently shows
      a superseded round as `➖ 0 ✅ / 6 neutral`. Correct but unreadable, and it
      is the one display consequence 4a leaves behind.

## The change, phase 4d — disputes legible even when there are none

- [ ] `**Disputed (N)**` in the fix report, `_Nothing._` at zero, matching the
      existing `Skipped (0)` treatment.
- [ ] `rebuttal.mjs::cmdPost`'s failure path routed through
      `emitBestEffortWarning` (#690 added it for exactly this class of silent
      bail).
- [ ] Export `severity.mjs::adjudicationNote` and render it in
      `review-comment.mjs`, so an adjudicated dispute shows its outcome in both
      the on-demand comment and 4b's per-round comment. Verify first that #689
      really persisted adjudicated copies into `verdict.json`.

## Deliberately not done

- Counting on-demand `@claude fix` rounds against `MAX_REVIEW_ROUNDS`.
  `agent-fix.yml` does not run the round guard and writes no dispatch record, so
  it stays outside the budget — which is the point of the verb, and is recorded
  as intentional in `harness-engineering.md`.
- Any change to the fixer prompt over the zero-rebuttal finding. The hypothesis
  worth testing is that dispute instructions ~60 lines into a prompt headlined
  *"Converge in ONE round"* suppress legitimate pushback, but 4c/4d make the
  number visible first and it should not be acted on without data.
- An adjudication record in the metrics comment (`harness-engineering.md`,
  "Not yet built" under Phase 28).

## Risks

- **In-flight PRs.** The ledger takes over the first time the guard proceeds, and
  `prior` freezes the inference at that moment, so the hand-over is exact rather
  than a budget bump. Already-paged PRs are latched and unaffected until
  `@claude rerun`.
- **Spend.** PRs that previously paged early now get their full three attempts,
  at roughly $3–7 a round. Watch the metrics comment on the first few; the lever
  if it reads badly is `MAX_REVIEW_ROUNDS`, not the counting rule.
- **These PRs cannot verify themselves.** They come from a fork, and both
  `agent-review-panel.yml` and `agent-iterate-ci.yml` gate on
  `head_repository.full_name == github.repository`. End-to-end verification is
  `@claude rerun` on #695 (paged, latched, and a PR whose correct answer is now
  known — the budget should read 1 dispatched, not 3) plus the next autonomous
  agent PR after merge.
