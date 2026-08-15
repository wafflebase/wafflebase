# Measure how long a CodeRabbit review takes, and say what the clock is measured from

*Extends `archive/2026/08/20260807-coderabbit-adapter-todo.md` (#739) and the
follow-up `20260811-coderabbit-window-identity-todo.md` (#771). The record shape,
the window rule and the severity translation are unchanged; this adds a duration
beside them and one refusal to the fetch.*

The adapter could say **what** CodeRabbit found on the frozen snapshot and not **when**
it landed. It now emits two named intervals, the trigger that caused the review, and
twelve reasons a duration can be missing — none of which is zero.

## The problem

Three separate defects, and only the first is the obvious one.

**1. The start instant was looked for in the wrong two places and declared absent.**
A duration needs a start, and neither `buildItemMeta` (which records `merged_at`) nor
`fetchCodeRabbitPr` (which reads commit **author** dates) holds one. Concluding from
those two that no start exists anywhere is an inference from two call sites. Two are
available: **the check runs on the frozen commit** (`GET
/repos/{owner}/{repo}/commits/{sha}/check-runs`, which resolves on 7 of 7 pilot items)
and **CodeRabbit's own marker comments**, which it stamps when it takes a job.

**2. A push-anchored figure measures the wrong interval whenever a human asked for the
review.** Anchored to the earliest check run on its frozen commit, `pr-549` reads
**183.7 min** — 26× the median of the other six, enough to move the mean from 7.0 to
32.6. It was never a slow review. The pull request's timeline:

```
2026-07-26T01:02:46Z  verify-self starts on 158c6faa…   ← the anchor
2026-07-26T03:58:27Z  hackerwins: "@coderabbitai review this."
2026-07-26T03:58:37Z  CodeRabbit acknowledges (invocation ad4e5877…)
2026-07-26T04:06:25Z  CodeRabbit's finding on 158c6faa…
```

**8.0 min from the ask, 7.8 min from CodeRabbit's own acknowledgement**, and the other
176 minutes are a human deciding to ask. `pr-605` is the same shape — two asks, the
review 7.6 min after the second acknowledgement — and it is the dangerous one, because
its push-anchored figure is an entirely ordinary **9.8 min**. Nothing about the number
says it is timing the wrong thing. Any outlier rule that caught pr-549 would have kept
pr-605.

**3. `gh` reports an unexpandable `{owner}/{repo}` as an empty result.** Run from a
directory with no git remote and no `GH_REPO`, every call fails identically with
*"unable to expand placeholder in path"*, each one degrades to `absent`, and the output
is a complete, plausible, entirely empty census — previously measured as 0 CodeRabbit
records across a whole corpus version. #790 closed the CI half of this by setting a
workflow-level `GH_REPO` and asserting it in `checks.test.mjs`; no workflow assertion
can see a local invocation, which is where this CLI runs.

## The change

**Two intervals, each naming what it is measured from**, because "CodeRabbit's latency"
is not one number:

| key | from → to | pilot, n=7 |
|---|---|---|
| `self_timed` · `coderabbit-start-marker-to-first-finding` | CodeRabbit's own marker comment → its first in-window finding | 2.6–14.4 min, **median 6.8** |
| `push_proxy` · `earliest-check-run-start-to-first-finding` | earliest check run on the frozen commit → the same finding | 2.8–183.7, poolable on 5: 2.8–14.8, median 6.7 |

`self_timed` is the one to prefer, for two measured reasons: it needs no guess about
what triggered the review, and it is the only one of the two that survives an
on-demand re-review. `push_proxy` is kept because it is **independently derived** —
our CI's clock rather than CodeRabbit's — so agreement is evidence. On the five
automatic items the two agree to within **0.1–0.4 min**.

**The trigger is read, not assumed.** `START_MARKERS` holds the two HTML comments
CodeRabbit stamps for its own bookkeeping: a per-invocation
`<!-- CodeRabbit review command invocation: … -->` (⇒ `on-demand`) and the per-PR
`<!-- This is an auto-generated comment: summarize by coderabbit.ai -->` (⇒
`automatic`). Where the trigger is not `automatic`, `push_proxy.poolable` is `false` —
the figure is still **reported**, because deleting an unexplained number silently is
how pr-549's 183.7 min became a three-hour review in one document and a missing row in
the next.

**The latest marker before the finding wins.** The status comment is created once per
pull request and edited afterwards; the ack is created once per invocation. On pr-549
that ordering is the difference between 7.8 min and 1048.6.

**`updated_at` is not used anywhere.** The pair (`created_at`, `updated_at`) on the
status comment looks like a self-timed duration and is not one, because the last edit
is the last edit of anything: on pr-415 it reads **53.7 min against a true 6.6**, an 8×
error. On the per-invocation ack it happens to be right to within 4 s, and a rule that
is right on one comment kind and 8× wrong on the other is not a rule.

**Twelve absences, six of which end the interval** (`LATENCY_ABSENT`). Three are the
same sentence in English and different facts: *CodeRabbit reviewed this snapshot
cleanly* (`no-finding`), *we could not read what it wrote* (`findings-unavailable`),
and *it reviewed a later snapshot* (`no-in-window-finding`). `no-check-run` is the one
that has never occurred — every pilot item's frozen commit carries `verify-self`,
`verify-integration` and `verify-browser` — so the census prints it at zero on both
intervals, every run.

**The interval ends on the arm's own records, not on a second read of the API.** Three
properties come with that: the author gate has already run, so no other bot can end the
clock; the window rule has already run, so a finding about later code cannot; and
`posted_at` already spans both halves of CodeRabbit's output, so an item where it wrote
only a review body still has an end.

**One refusal in the fetch.** A `gh` failure matching *"unable to expand placeholder"*
aborts rather than degrading, with a message naming `GH_REPO`. It is the one failure
here that is total rather than per-endpoint.

**`commitCheckRuns` is composed, not re-implemented.** That endpoint returns an object
per page, so it needs `--slurp`; `gh-checks.mjs` owns that incantation and its header
records both times this repository got it wrong. Issue comments are a bare array, where
plain `--paginate` is correct, as `harvest.mjs` says at its own reader.

## Corrected while building

**The two candidate end instants differ by 1–2 seconds, not materially.** The plan
expected the choice between the first inline comment's `created_at` and the review's
`submitted_at` to move every figure. Measured on 7 of 7 items, the review is submitted
1–2 s after the first comment it carries: the medians are identical and no item moves
by more than 0.02 min. The decision is therefore made on meaning — the earliest moment
any output was visible — and `ended_source` keeps the alternative recoverable.

**Our arm's median is 9.3 min over 21 replays, not 9.6.** 9.6 is replicate k1's median
alone (k2 8.7, k3 9.3). Both are true of different populations, which is why the unit
is now stated beside the figure.

**Our panel has production timing on 2 of 7 items, and the plan said it had none.**
`pr-549` and `pr-605` carry `agent-review-*` check runs on the frozen commit itself.
Their `started_at` equals their `completed_at` to the second — the panel creates each
check run when the lens finishes, so its process time is not in there — but the
completion instant is, and from the same anchor `push_proxy` uses it reads **18.7 and
19.0 min**, against CodeRabbit's 8.0 and 8.6 from its own trigger. The panel workflow
is `workflow_run: CI (requested)`, so both arms' clocks start from the same event, and
its own header records a production median of 17.8 min. **The plan worried this metric
would read 3–5× too high against us; in production it reads roughly 2.2× too LOW in
our favour.** No such comparison is emitted here — the two arms have separate keys and
no ratio — but the direction is now measured rather than argued.

**The census line printed the declared twelve and nothing else**, which quietly undid the one
thing `latencyCensus` goes out of its way to do: it opens a key for an absence nobody declared,
and the formatter iterated `LATENCY_ABSENT` alone, so that bucket would have been counted and
never seen. Found in review. The formatter is now exported as `latencyAbsentLine`, prints the
union with the unrecognised rows marked — the wording `cost-latency.mjs` uses for the same case
— and two mutations pin it. **Two off-by-one statements were wrong in the same pass:** six
absences end the interval, not five (`posted-at-absent` is one of them), and the production
figure is 18.7 min, not 18.6 — 18.6 is when the first lens check run appeared, 18.7 is when the
last one completed, and the latter is what "took" means here.

**CodeRabbit creates no check run**, verified on `51c01826a`: the only apps posting any
are `codecov` and `github-actions`, and the commit-status API is empty. So the
symmetric measurement — each reviewer's own process time off its own check run — is
unavailable on that arm, and the self-timed marker is the nearest thing to it.

## Fail directions

| When | What happens | Why that is the safe direction |
|---|---|---|
| An endpoint does not answer | `findings-unavailable`, and both intervals are `null` | Our failure stays our failure. It is never a fast review, and never pooled with a clean one |
| CodeRabbit wrote nothing and both endpoints answered | `no-finding` | A clean review is a true negative, not a zero-length review |
| The frozen commit has no check runs | `no-check-run` on the proxy; the self-timed figure **survives** | Whether our CI ran is a fact about our repository, not about CodeRabbit. Carrying two intervals is what keeps one absence from costing the item |
| A human pastes a marker string into a comment | ignored; the gate is `CODERABBIT_LOGINS`, exact | The markers are public strings on public pull requests. An ungated read would let anyone move the other arm's clock to any instant they chose |
| A marker sits in the same second as the finding | `no-start-marker` | A zero-length review is not a measurement |
| The proxy's start is after the finding | `start-after-finding`, no number | Reachable without anything being broken — CodeRabbit can post before a queued run starts — and a negative duration must never be emitted as one |
| The trigger cannot be read | `unknown`, and the proxy is not poolable | It cannot be shown that the push is what the review answered |
| A thirteenth absence appears upstream | counted under its own key in the census | An unexplained bucket, rather than silently folded into a known one |

## Explicit non-goals

- **No ratio between arms, for latency or anything else.** Separate keys, separate
  units, each naming its interval. Nothing here divides one arm's number by the other's.
- **No central figure in the adapter.** Counts and the poolable population only; a
  median belongs to a scorer, which owns one definition of it for the whole subsystem.
  A second median here is how two tables of the same run come to disagree.
- **Nothing added to a frozen `meta.json`, and no re-freeze.** The timing read happens
  at scoring time. `corpusItemDrift` compares a fixed field list, so a field added to
  the manifest after the freeze would report `unchanged` and never be written.
- **`harvest.mjs`, `finding-record.mjs`, `placeInWindow`, the severity translation and
  every scorer are untouched.** The census over `2026-08-10-pilot-reviewed` is
  identical on both trees.
- **`sdk_duration_ms_sum` is not read**, and is not named anywhere in the module. It is
  a flat sum over concurrent SDK calls and overcounts by 1.36×–3.27× per replay.
- **No production capture for our own arm.** The two items above are what the check
  runs happen to record; timing our panel in production is a different piece of work.

## Verification

Measured at `upstream/main` = `f4d0d65d6`, from the **committed tree** (`git archive`
into a clean directory), with the same `node_modules` symlinked into **both** the base
and the branch tree before either was measured, both lanes run serially.

- [x] **The seven push-anchored figures reproduce**, independently and then through the
      CLI: **6.7 · 7.0 · 14.8 · 3.2 · 2.8 · 183.7 · 9.8**, median 7.0, range
      2.8–183.7. Every figure below was printed, not derived.
- [x] **The self-timed interval, over the same seven:** 6.6 · 6.8 · 14.4 · 3.0 · 2.6 ·
      **7.8** · **7.6** — n=7, median 6.8, range 2.6–14.4. The two on-demand items sit
      inside the range of the five automatic ones, which is the finding: there is no
      outlier once the clock starts where the review did.
- [x] **The real census, from the branch tree, over `2026-08-10-pilot-reviewed`:**

      ```
      latency over 7 item(s), 7 with a review of the frozen snapshot to time
        trigger:      automatic=5 on-demand=2 unknown=0
        self-timed:   7 measured, 7 poolable · coderabbit-start-marker-to-first-finding
        push-proxy:   7 measured, 5 poolable · earliest-check-run-start-to-first-finding
          absent:     findings-unavailable=0 no-finding=0 no-review-commit=0
                      finding-unplaceable=0 no-in-window-finding=0 posted-at-absent=0
                      issue-comments-unavailable=0 no-start-marker=0
                      check-runs-unavailable=0 no-check-run=0
                      check-run-start-absent=0 start-after-finding=0
      ```

      The record census is **unchanged**: 30 records, `in-window=30`, `severity major=3
      minor=13 nit=14`, `source inline-comment=16 review-body=14`, `gating
      not-applicable=30`.
- [x] **The absent census prints its zeros**, on both intervals, including
      `no-check-run=0` — the row for a state that has never occurred on real data.
- [x] **The `GH_REPO` footgun is an assertion, proved live.** From
      `/private/tmp/no-git-here` with `GH_REPO` unset, the committed CLI exits **1** with
      *"gh could not expand {owner}/{repo} … Set GH_REPO=wafflebase/wafflebase"*, where
      before it would have printed a clean empty result. Also covered by a fixture
      carrying `gh`'s verbatim message, on the first call and on the timing read.
- [x] **Pagination and the commit-id fallback are pinned by fixtures.** Issue comments
      assert `--paginate` and **not** `--slurp`; check runs assert both, through
      `commitCheckRuns`; the review comments the interval ends on still assert
      `--paginate`. The end-to-end test's finding is in-window on `original_commit_id`
      alone — its `commit_id` is a later commit — so taking the current field first
      would discard the timing reads as `no-in-window-finding` while both endpoints
      answered perfectly.
- [x] **All 12 absent flavours are reachable and asserted**, table-driven, with
      `LATENCY_ABSENT` asserted equal to the set the table produces: a flavour nothing
      can produce is decoration, one the table cannot produce is untested.
- [x] **`agent:tests`, the two invocations the lane runs since #774**, reported as
      `rest + iso`:

      | | rest | iso (`eval/run.test.mjs`) | total |
      |---|---|---|---|
      | base `f4d0d65d6` | 1687 pass / 0 fail / 0 skip | 55 / 0 / 0 | **1742** |
      | this branch | 1703 pass / 0 fail / 0 skip | 55 / 0 / 0 | **1758** |

      **+16 tests, 0 fail, 0 skip on either tree.** 0 skips rather than the documented
      6 because both trees have the Agent SDK and a root `eslint` linked, which is what
      `lint-config.test.mjs` skips without.
- [x] **`eslint scripts` exits 0** on the lockfile's pinned **9.24.0**, no output, on
      both trees. (A bare `npx eslint` resolves a newer version that flags pre-existing
      code on `main`; 9.24.0 with `@eslint/js` and `globals` was installed into a
      scratch tree and linked for the run.)
      ⚠ **`eval/run.test.mjs` fails 2 of its 55 when `os.tmpdir()` is dirty**, and it is not
      this diff: *"a failed item KEEPS its raw panel output"* and *"a throw inside the item
      loop still deregisters the worktree"* assert that no `eval-item-*` directory appeared,
      and 604 of them had accumulated from earlier runs of the same file. **The base tree
      fails the same two under the same dirty `TMPDIR`, and both trees pass 55/55 under a
      fresh one.** Pre-existing, from #682, and documented. The dirs were left in place —
      another session may own some of them.
- [x] **All 18 mutations caught, 0 survived**, each by a test naming the right thing;
      restored after each. Latest-marker → earliest (**3 red**); author gate removed
      (**1**); same-second marker allowed (**1**); proxy `min` → `max` (**5**);
      `no-check-run` pooled into `check-runs-unavailable` (**1**); on-demand made
      poolable (**3**); the negative-duration guard removed (**1**);
      `no-finding`/`findings-unavailable` swapped (**2**); earliest finding → latest
      (**1**); the unplaceable branch removed (**2**); the `GH_REPO` refusal removed
      (**1**); the census zeros removed (**1**); issue comments unpaginated (**1**);
      check runs read without a frozen commit (**1**); a self-timed absence made
      poolable (**1**); the status-comment marker dropped (**5**); the unrecognised
      absence bucket hidden again (**1**); the declared zeros dropped from the census
      line (**1**).

**Not verified, and why:**

- **Nothing consumes the latency yet**, so no reported number moves. The cost-and-
  latency scorer is a separate change and is not touched here.
- **`no-check-run`, `check-runs-unavailable`, `posted-at-absent` and
  `start-after-finding` have never occurred on real data** — unit tests only. That is
  precisely why the census prints them.
- **`no-finding` and `no-in-window-finding` are unit-tested only on this corpus
  version**, which is frozen at the commit CodeRabbit reviewed, so all 30 findings are
  in-window. The 2026-08-07 `pr-open` freeze is the last real data behind them.
- **The self-timed marker on a second AUTOMATIC review of one pull request is
  untested against real data**, and it is the known soft spot: the status comment is
  per-PR, so its `created_at` would be the first review's start and the interval would
  read long. No pilot item is in that shape. It is the reason the proxy is kept and
  printed beside it rather than dropped — a disagreement between the two is the signal.
