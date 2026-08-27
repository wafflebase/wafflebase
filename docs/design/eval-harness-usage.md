---
title: eval-harness-usage
target-version: 0.6.6
---

# Running the review-panel benchmark

The review panel is a **non-deterministic judge**. This directory measures it: freeze a past
pull request, replay the real panel over exactly what a reviewer first saw, and score the
result against **CodeRabbit** on the same pull requests.

**This is the operator's guide** — prerequisites, commands, what a run costs, and how to read
what comes back. The machinery, the vocabularies and the design reasoning are in
[`scripts/agent/eval/README.md`](../../scripts/agent/eval/README.md); read that before
disagreeing with a result. The two hunters have their own guide in
[hunter-usage.md](hunter-usage.md).

**Two commands cost money: `run.mjs`, and `adjudicate.mjs` when a model is the annotator**
(§4 — the script itself only asks; the spend is the model answering). Everything else is
`gh`, `git` and the filesystem.

---

## The shape of it

```text
                 ┌─ extract-corpus.mjs ──→ a frozen corpus ITEM (diff, files, issue, meta)
   a past PR ────┤
                 └─ (CodeRabbit's own review of that PR is already on GitHub)

   corpus item ──→ run.mjs ──→ an immutable RUN ENVELOPE per item     🔴 SPENDS
                              (one per replicate: __k1, __k2, __k3)

   envelopes ────→ score-all.mjs ──→ 6 scorers + a rendered report    FREE
```

**Code lives in this repository; data lives in a separate store.** The store holds corpus
items, run envelopes, captures, labels and scores, and nothing executable. Point every command
at it with `--root`.

## Prerequisites

```bash
(cd scripts/agent && npm ci)          # the Agent SDK is deliberately not a workspace dependency
export GH_REPO=wafflebase/wafflebase  # required: gh expands {owner}/{repo} from git, and there
                                      # are two checkouts with different remotes in play
export CLAUDE_CODE_OAUTH_TOKEN=…      # only needed for run.mjs and adjudicate.mjs
```

**Every command below runs from the repository root**, as the paths say. The `npm ci` is in a
subshell for that reason — `scripts/agent` is where the dependency lives, not where you work.

⚠ `GH_REPO` is not optional. Without it every CodeRabbit read fails identically and the arm
reports a corpus-wide absence that reads exactly like a repository CodeRabbit never reviewed.

## 1. Freeze a pull request — free

```bash
EVAL=../wafflebase-agent-eval          # a sibling checkout of the eval-data repo
node scripts/agent/eval/extract-corpus.mjs --root "$EVAL" \
  --corpus-version 2026-08-10-pilot --prs 471
```

⚠ It is `--prs`, plural, and it takes a comma-separated list. A singular `--pr` is not an
error: the flag is ignored, the run falls through to `gh pr list` and freezes the **30 most
recent merged PRs** instead.

⚠ **Pin the review commit** if you intend to compare against CodeRabbit. A PR's opening head
is usually *not* what CodeRabbit reviewed, and freezing the wrong snapshot silently costs you
most of the other arm's findings. The pin is per item, `pr-<n>=<sha>`, and only full
40-character shas are accepted:

```bash
node scripts/agent/eval/extract-corpus.mjs --root "$EVAL" \
  --corpus-version 2026-08-10-pilot --prs 415,429,471 \
  --review-commit pr-415=51c01826aa9f05e4cef9ee498668e3f2321b3602
```

Pin as many as you know: `pr-415=…,pr-429=…`. A pinned item records
`review_point: "pinned"`; #429 and #471, unpinned above, still follow `--review-point`'s
guessing rules. A pin naming a PR that is not in `--prs` is refused rather than ignored —
otherwise every item would freeze at the default rule and the run would exit 0 looking right.

Re-running an extraction is a **check**, not a no-op — it re-derives and compares.

## 2. Replay — 🔴 this spends money

**Locally:**

```bash
node scripts/agent/eval/run.mjs --root "$EVAL" \
  --corpus-version 2026-08-10-pilot \
  --run-id mystem__k1 \
  --max-cost-usd 30 \
  --items pr-471,pr-524          # omit for the whole corpus
```

**In CI — preferred, and the only way to get a credential pool:** dispatch
`eval-replay.yml`. It is `workflow_dispatch`-only, sharded by replicate, and commits to the
store. Do a `panel: stub` dry run first — it costs $0 and prints the resolved `config_hash`
before anything spends.

| | measured |
|---|---|
| cost per review | **~$4.17** ($1.89 – $7.57) — one item in one replicate |
| spend per replicate | **~$30.49** ($29.53 – $32.91) on a 7-item corpus |
| a K=3 comparison | **~$95** |
| wall clock per review | ~9.3 min (4.1 – 18.8) |

🔵 **Cost is a fixed per-item floor plus a marginal rate** — roughly `$2 per item + $5 per
1000 diff lines`, with the floor being **40–50%** of a replicate. Small items are not cheap.

### Four things that will bite you

- 🔴 **`--max-cost-usd` bounds the RUN, never the item.** Cost arrives after an item finishes,
  so the per-item bound is the timeout, not the cap.
- 🔴 **A stored item is never re-run.** Resume is by `--run-id`, and `hasItem` skips anything
  already stored — *including an item stored as an error*. One infrastructure failure
  therefore **poisons that item for that run id permanently**. Abort on the first
  pool-exhaustion / rate-limit / `reason: "infra"` rather than waiting to see if it recovers.
- ⚠ **`capped` and `error/infra` look alike and want opposite responses.** `capped` → raise the
  cap and resume the same run id; stored items are not re-paid for. `error/infra` → abandon the
  run id, because a resume will skip the poisoned item forever.
- ⚠ **Run replicates with a gap between them.** Two arms back-to-back is how a credential pool
  gets drained; budget by dollars-per-hour, not by total.

## 3. Score and render — free

```bash
node scripts/agent/eval/score-all.mjs --root "$EVAL" \
  --corpus-version 2026-08-10-pilot \
  --config-hash sha256:… \
  --runs mystem__k1,mystem__k2,mystem__k3
```

**Pass every replicate of one reviewer in one invocation.** Agreement is defined over
replicates, and `--config-hash` is half of the pair a score is filed under — a score filed
against the wrong reviewer is unpoolable and there is no way to tell afterwards.

Six scorers run: `volume-mix` · `complementarity` · `reliability` · `cost-latency` ·
`segmentation` · `validity`. Output is a **7-section markdown report** in the store's
`reports/`.

**Or dispatch `eval-score.yml`** — same code, no model calls, no write scope in this
repository, safe on a schedule. `dry_run: yes` prints everything and stops before committing.

## 4. Labels — 🔴 spends money, and it is the only way to get a precision number

Nothing above says whether a finding is *true*. That needs adjudication:

```bash
node scripts/agent/eval/adjudicate.mjs --root "$EVAL" \
  --corpus-version 2026-08-10-pilot \
  --run mystem__k1,mystem__k2,mystem__k3 \
  --mode model --annotator MODEL_ID --label-source silver --write
```

**`--run` is comma-separated and every replicate belongs in one invocation.** One judgement
covers every wording of one defect, and a defect is only recognised across replicates when
they are queued together — on the pilot that is 245 judgements for 428 records, against 428
judgements one run at a time.

It presents each finding **blind**: no severity, no verifier outcome, no gate decision, no
cross-arm agreement reaches the screen. It writes nothing without `--write` and is resumable.

⚠ **Give the adjudicator the code.** A judgement made with no checkout hedges — measured, ~3
in 4 verdicts hedge on being unable to read something — and the same findings scored **0.845
without file context and 0.897 with it**. Budget **~$0.33 per verdict** with context.

## Reading the report

**Read these in order, and the first two decide whether the rest means anything.**

1. **Completeness.** `partial` means some corpus item was not scored on some arm. The verdict
   is computed from the *items*, not copied from a run's status.
2. **What is `not-computed` vs `not-measurable`.** The report distinguishes *"nobody has
   adjudicated this yet"* from *"this quantity does not exist"*. Cost-per-review across arms is
   permanently not measurable: a flat subscription has no per-review price.
3. **Every reproducibility figure is a LOWER bound.** Undecided cross-run pairs split one
   defect into two classes and deflate every ratio.

🔴 **And the rule that matters most: a reproducibility statistic must name its UNIT.** The
severity story *reverses* between file level and defect-class level, because a file churns if
any finding in it churns. Both readings are true and they point opposite ways.

## Known limits — read before quoting any number

- **A gate verdict and a finding set are different units.** In the pilot the gate reproduced on
  7 of 7 items while only ~40% of flagged files reproduced across three replicates. The panel
  is reliable about its *decision* and unreliable about its *reasons*. Quote both or neither.
- **CodeRabbit cannot be re-run**, so its reliability is not measurable — ever. Every
  comparison is 3 draws against 1.
- **Cross-arm overlap has a saturated ceiling** while pairs remain undecided: *"N unique to
  CodeRabbit"* may mean *"N unresolved pairs"*.
- **`conclusion: "success"` on a lens does not mean it found nothing** — it is a check-run
  conclusion. Several fields here answer the question they were defined for, not the one their
  name suggests. Find the definition before calling a field wrong.

## Testing

`pnpm verify:self` runs these as its `agent:tests` lane. To run them directly:

```bash
cd scripts/agent
node --test-timeout=60000 --test $(find . -type d -name node_modules -prune -o \
  -name '*.test.mjs' ! -path './eval/run.test.mjs' -print | cut -c3- | sort)
node --test-timeout=60000 --test 'eval/run.test.mjs'
```

Two invocations, deliberately: the runner's tests are isolated. `eval/test-lane.test.mjs`
reads the lane definition in `scripts/verify-self.mjs` back and asserts the two commands
partition the suite, so an added suite cannot go silently unrun. The `find` is not a plain
glob for the same reason it is not in the lane — `node_modules` is pruned, and every suite is
matched at every depth. Every runner test uses `adapters/stub-panel.mjs`, which is why the
whole subsystem is testable for free.
