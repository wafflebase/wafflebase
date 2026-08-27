# Offline replay of the review panel (`scripts/agent/eval`)

The review panel is a **non-deterministic judge**. Ask it the same question twice
and it may answer differently, which makes "did that change help?" unanswerable
while the *input* is also moving. This directory holds the machinery for holding
the input still: freeze a past pull request into a **corpus item** — the diff, the
changed files, the issue text, the metadata — and the panel can be re-run over
exactly what a reviewer first saw.

**One file here invokes a model: `run.mjs`, which spawns the panel.** Everything
else is `gh`, `git` and the filesystem, and costs nothing.

## What exists today

| File | Role | Model calls? |
|---|---|---|
| `store.mjs` | `EvalStore` — corpus items and run envelopes over an eval-data root; `store.captures` delegates to the merged `capture-store.mjs` | no |
| `extract-corpus.mjs` | freeze a past PR into an item, and re-check a frozen one against a fresh extraction | no (uses `gh` + `git`) |
| `config-hash.mjs` | `config_hash` — the fingerprint of a lens **configuration**, so two results can be told apart. Configuration only: the reviewer is the pair `(config_hash, panelSha)` | no |
| `config-build.mjs` | lenses dir → config manifest + reproduction snapshot, and a snapshot back into a lenses dir the panel can load. Takes an output path; persisting a snapshot is the runner's wiring | no |
| **`run.mjs`** | **the runner** — replay frozen items through the panel and store an immutable envelope per item. Idempotent and resumable by `--run-id` | **YES — this one spends money** |
| `adapters/reviewer.mjs` | the panel behind the target-adapter seam: `prepareInput` / `runAgent` / `captureArtifacts`, and the one place the subprocess contract lives | no (it spawns; the panel calls) |
| `adapters/stub-panel.mjs` | a stand-in panel that writes canned output and exits with a chosen code. Every test of the runner uses it, which is why the whole subsystem is testable for free | no |
| `finding-record.mjs` | **the normalised finding record** — one shape both arms map into, its builder and a strict validator. Owns the `gating` vocabulary: whether a finding gated is a four-valued answer, never a boolean | no |
| `adapters/panel.mjs` | **our arm's mapping** — a stored run envelope → finding records, lane preserved. A library plus a CLI that prints; it stores nothing | no |
| `adapters/coderabbit.mjs` | **the other arm's mapping** — CodeRabbit's inline comments and review bodies → the same records. Owns the `window` vocabulary: which snapshot of a pull request a finding is about | no (reads `gh`) |
| `replay-plan.mjs` | the CI lane's **preflight** — validates one dispatch, computes what it can spend, and resolves the pull refs a runner has to fetch before any item will materialise | no |
| `volume-mix.mjs` | **the first scorer** (of six) — volume, severity mix, nit ratio, localisation, scope discipline and restatement, per item and per arm, from finding records. Owns the `localization`, `scope` and `restatement` vocabularies, and the rule that a rate with no denominator prints `n/a` rather than 0 | no |
| `complementarity.mjs` | cross-arm overlap over **defect classes**, with a band rather than a point: an overlap is a lower bound while any cross-arm pair is undecided | no (reads `gh`) |
| `reliability.mjs` | does the same reviewer, re-run, say the same thing. Stratified, because one number averages a gate verdict against a nit | no |
| `cost-latency.mjs` | spend and wall clock per arm, in two blocks with **no shared axis** — cost per review across arms is permanently not measurable | no |
| `segmentation.mjs` | where each arm wins, cut by severity, file class, diff size, provenance and novelty, with a min-n floor | no (reads `gh`) |
| `validity.mjs` | precision from adjudicated labels. Exits non-zero when its own verdict is `partial`, which on an unadjudicated store is its correct answer | no (reads `gh`) |
| `labels.mjs`, `pair-labels.mjs`, `adjudicate.mjs` | the label store and the blind adjudication CLI — severity, verifier outcome and gate decision are withheld from the screen | `adjudicate.mjs` only |
| `panel-identity.mjs` | `panel_digest` — the fingerprint of the panel's own code, so a reviewer is identified by what it *is* rather than by a commit sha | no |
| `report.mjs` | renders the scores into one comparison document per `(config_hash, panel_digest, corpus)` | no |
| `score-all.mjs` | **the driver** — runs every scorer, files each score, renders the report. This is what CI's free lane executes, and it is runnable locally with the same arguments | no |

**Two inputs, and only two.** Every scorer reads corpus items and run envelopes through
`EvalStore` and nothing else — no scorer reaches for a working tree or a commit sha. The rows
marked `reads gh` add exactly one more source, and only for the *other* arm: CodeRabbit's
review is a set of pull-request comments, so GitHub is where it lives and there is nowhere
else to read it from. That is why `score-all.mjs` refuses without `GH_REPO` — and why it
still spawns no model and costs nothing.

**Two CI lanes, opposite in every cost dimension.** `eval-replay.yml` spends model budget to
produce envelopes: `workflow_dispatch`-only, a required cost cap, a panel timeout, sharded by
replicate. `eval-score.yml` derives numbers from envelopes that already exist: no model, no
worktree, no write scope in this repository, and safe on a schedule.

🔴 **Neither lane can gate a pull request**, and both assert it — one to stop a paid job firing
itself, the other to stop a free job becoming a gate.

**An operator's guide — prerequisites, the end-to-end path, what a run costs, and how to read
the report — is [`docs/design/eval-harness-usage.md`](../../../docs/design/eval-harness-usage.md).**
This file is the machinery and the reasoning; that one is what to type.

## One record, two arms

A comparison needs one shape. The panel writes `verdict.json` findings carrying
`lane`, `novelty`, `unsettled` and a per-finding verifier outcome; CodeRabbit
posts markdown comments. `finding-record.mjs` is the shape both map into, and
`adapters/panel.mjs` fills our side:

```bash
EVAL=../wafflebase-agent-eval
node scripts/agent/eval/adapters/panel.mjs --root "$EVAL" --run <run-id>
node scripts/agent/eval/adapters/panel.mjs --root "$EVAL" --run <run-id> --population sampled --json

node scripts/agent/eval/adapters/coderabbit.mjs --root "$EVAL" --corpus-version 2026-08-07-pilot
node scripts/agent/eval/adapters/coderabbit.mjs --pr 471 --json      # any PR, no window
```

Records are **derived, never stored**: recomputable from an immutable envelope,
deterministically and for free. Persisting them would spend the store's
write-once rule on a shape that is cheap to recompute and expensive to correct.

### Which snapshot is a CodeRabbit finding about?

The two arms do not read the same bytes, and this is the part of the comparison
most likely to be quoted back. Our arm replays a pull request **as it was
opened** — every pilot item is frozen at `review_point: pr-open`. CodeRabbit
reviewed whichever commit it got to, which is usually not that one. So every
CodeRabbit record carries `coderabbit.window`:

| `window` | `window_basis` | What it means |
|---|---|---|
| `in-window` | `commit-is-review-commit` · `commit-at-or-before-review` | the finding's commit IS the frozen `review_commit`, or is before it — our panel saw that snapshot. Identity is answered from the two shas, before the commit list is consulted: a force-push can remove the frozen commit from the pull request, and it does on #415 |
| `after-window` | `commit-after-review` | it is after it. Our panel never saw that code |
| `unplaceable` | `commit-not-on-pr` · `commit-absent` · `review-commit-not-on-pr` · `commits-unavailable` | the commit is not on the pull request (a force-push), names nothing, or the frozen commit itself cannot be located |
| `no-window` | `no-review-commit` | no frozen commit was supplied — an off-corpus pull request, so the question does not apply |

**The rule tags; it never filters.** Measured 2026-08-07 across all seven pilot
items, **n=30 findings: 3 in-window (10.0%) · 24 after-window (80.0%) · 3
unplaceable (10.0%)**. A strict in-window rule would leave the CodeRabbit arm
with three findings in the whole pilot and zero on five of the seven items — and
it would do that for a reason that is not CodeRabbit's advantage: it reviewed a
later snapshot, not a second time. **Any headline comparison must state which
`window` values it pooled**, and `at_commit` / `current_commit` / `review_commit`
are all on the record so a scorer can re-place a finding without re-querying
GitHub. The two keys disagree on real data: over the pilot's 16 inline findings,
`original_commit_id` first gives 3/11/2 and `commit_id` first gives 1/14/1.

CodeRabbit reviewed each pilot item **once**. Its later comments on #465 and #471
are threaded acknowledgements, not new findings — so "it got extra rounds after
fixing its own comments" is not what the split above measures.

### CodeRabbit's severity is sometimes a floor, and the record says which

`stated_severity` keeps CodeRabbit's own word and `severity_basis` says where the
record's `severity` came from:

| `severity_basis` | n (repo-wide, 2026-08-07) | Where the value came from |
|---|---|---|
| `header-field` | 1977 of 3001 | CodeRabbit wrote a severity in the finding's header. `trivial` → `nit` is `harvest.mjs`'s translation |
| `tier-heading` | 635 | it wrote none there, but filed the finding under a section whose title names one — "🧹 Nitpick comments", "🟡 Minor comments" |
| `unstated` | 389 | it stated none anywhere. The record carries `nit`, the **floor** |

`tier-heading` is reading CodeRabbit's label rather than inventing one, and the
data says so: wherever a nitpick-tier finding *also* carries a header severity it
is `trivial` — on all 274 of them — and `minor`-tier findings state `minor` on all
95. The heading and the field never disagree.

`unstated` is unavoidable rather than chosen: both retired inline vintages state
no severity by construction (75 findings) and neither does the Additional-comments
tier (296), while `validateFindingRecord` requires one of `KNOWN`. `nit` is the
floor because it claims the least and cannot inflate the other arm's blocking
count — but it flatters us, so ⚠ **no severity-segmented number may pool an
`unstated` record with a stated one.** Same shape as `panel.gate_state`: a default
indistinguishable from a measurement.

The record's top-level `severity_raw` is **not** the place to read CodeRabbit's
word from. `buildFindingRecord` derives `severity` and `severity_raw` from one
input and the validator refuses a severity outside `KNOWN`, so the arm boundary
must translate before calling it — which makes the two fields equal on every
CodeRabbit record. `coderabbit.stated_severity` is the field that carries the
original.

### "Did this finding gate?" is not a boolean

Since #668 the answer rests on the `lane` the novelty gate routed on, not on
severity: a `critical` routed to `backlog` is reported and does **not** gate. So
the record answers with `gates` · `does-not-gate` · `unknown` ·
`not-applicable`, and names the cause in `gating_basis`.

`unknown` exists because a lane can be legitimately absent and **absence has
more than one cause**. A boolean cannot spell "we could not tell", so the moment
one is written every unknown becomes one of the two answers — silently, and in
the direction that inflates the blocking population. The causes are kept apart:

| `gating_basis` | `gating` | What it means |
|---|---|---|
| `lane-blocking` | `gates` | the gate looked at it and kept it on the gate |
| `lane-backlog` | `does-not-gate` | real, but the code predates this change |
| `lane-discarded` | `does-not-gate` | the verifier concretely refuted it |
| `non-blocking-severity` | `does-not-gate` | minor/nit never reach the gate, so the missing lane is the design and not missing data |
| `lane-absent` | `unknown` | blocking severity, no lane recorded — a capture predating #668, or the `sampled` population |
| `lane-unrecognized` | `unknown` | a lane outside `LANES` |
| `no-gate-in-arm` | `not-applicable` | the arm has no merge gate. CodeRabbit never gates, which is not uncertainty |

The panel's own `findingGates` reads a **missing** lane as gating. That is right
for a gate — it fails toward blocking because it is deciding whether to stop a
merge — and wrong for a scorer, which must not turn "not recorded" into a
verdict. Two jobs, two rules.

### Two populations, never pooled

One envelope holds two different sets of findings, and they answer different
questions:

| `population` | What it is | Has a lane? |
|---|---|---|
| `reported` | `verdict.json`'s findings — what the panel **said**, after dedupe, clustering, verification and routing. The like-for-like comparator against CodeRabbit's posted comments | yes |
| `sampled` | every finding every detection sample raised, before any of that. Answers "what could this panel find across repeated tries?", which CodeRabbit has no counterpart to | no — `annotateFindings` runs later, so every blocker reads `unknown` |

Every record carries which one it came from, and one call never mixes them.

**The lane-aware path is live, and older envelopes still are not.** #713
described it as inert because every replay to that point ran with the novelty
gate OFF; a replay now materialises a real worktree and passes `--base-sha`, so
`lane: "backlog"` occurs. Envelopes stored before that still read
`gate.state: "off-no-base-sha"` and still route every blocking finding to
`blocking` by default — which is why `panel.gate_state` rides on every record
and why a gate-off run is never pooled with a gate-on one.

## Replaying an item

```bash
EVAL=../wafflebase-agent-eval
node scripts/agent/eval/run.mjs --root "$EVAL" --corpus-version 2026-08-05a \
  --max-cost-usd 25
node scripts/agent/eval/run.mjs --help          # every flag
```

### What a replay is a replay *of*

Two things make it the reviewer that ships rather than an approximation of one,
and neither is sufficient alone:

- **The review tree is a real linked git worktree** at the item's `review_commit`,
  not a `git archive` tree. An archived tree has no `.git`, so nothing in it can
  be blamed.
- **The item's frozen `review_base` is passed as `--base-sha`**, so the panel's
  novelty gate runs and blocking findings route through the novelty lane #668
  added.

Be precise about what was wrong before, because the loose version of it is not
true: findings **did** carry a lane. `routeFinding` returns `blocking` when
novelty is `unknown`, so every replayed finding was labelled `blocking` — which
looks like a correct answer. What could not occur was the **demotion**:
`lane: "backlog"` requires an origin of `relocated`, which requires a `git blame`
of a tree that has a `.git`. So a replay did not merely lack information, it
answered the gate's question **wrong**, in the direction that reads as normal, on
every relocated finding in the corpus.

The envelope records both halves, as `gate.state` and `base_sha_passed`, and a
`--base-sha` that was passed while the panel reports the gate off is
`gate-degraded`: fatal to the run, not a footnote.

One worktree per commit per run, under a `mkdtemp` root, **deregistered and
deleted when the run ends** — a worktree is registered in the source
repository's `.git`, so leaving one behind is state in someone else's clone.
Nothing outside that root is ever passed to `git worktree remove`, and
`git worktree prune` is never called: it deregisters by reachability rather than
by ownership, and a developer's clone routinely has several worktrees of its own.

### Bounding what a run can spend

Two guards, different shapes, because the facts arrive at different times:

| Guard | Bounds | Can it be forgotten? |
|---|---|---|
| `--panel-timeout <s>` | **one item**, in *time* — kills the panel's whole process group | no — defaults to 2700 s and cannot be switched off |
| `--max-cost-usd <n>` | **the run**, in *dollars* — stops before the next item | no — **required**, with `--no-cost-cap` as the explicit way to run unbounded |

The cap follows `--root`'s rule rather than being a default-off flag. A cap
chosen for you would silently truncate a legitimate run, so it is not chosen for
you — it is *asked for*, and so is its absence. A truncated run is recoverable:
raise the cap, resume the same `--run-id`, pay for nothing twice. Money already
spent is not.

`--max-cost-usd` **cannot stop the item it is spending on**, because the panel
writes its cost as it exits. That is the honest limit of the claim. The budget is
seeded from what is already stored, so resuming a run id resumes its budget too.

The timeout signals the process **group**, not the child — the same technique
`reapLaneGroup` in `scripts/verify-self.mjs` uses, and for the same incident.
Measured with a stub that spawns a grandchild: a plain `child.kill()` ends the
child and the grandchild survives both that signal and a later `SIGKILL` aimed at
the reaped pid. The real panel has grandchildren for the same reason the stub
does — the Agent SDK's `query()` starts its own subprocess. Unlike
`reapLaneGroup`, which reaps a lane that has already exited, this kills a **live**
panel, so it is SIGTERM first and SIGKILL after a grace: there may be buffered
output worth flushing, including the `novelty gate:` line the whole assertion
reads.

`--run-id` is what makes a replay resumable and a replicate distinguishable.
Re-invoking with the same id **re-runs nothing**: items already stored are skipped,
so a crash halfway through a twenty-item run costs the items it already paid for
and nothing more. K replicates of one corpus and config are K *different* run ids —
that is what makes reliability computable at all.

### An `ok` item means one thing

`status: "ok"` means **this item is a real verdict and may be pooled as one.**
Anything short of that is `error` with a named `reason`, because the failures are
not interchangeable:

| `reason` | What happened | Stops the run? |
|---|---|---|
| `panel-exit` | the panel exited non-zero | no — a single item can crash on its own |
| `panel-timeout` | it never exited, and its process group was killed | no |
| `no-panel-json` | it exited 0 and wrote no usable `panel.json` | no |
| `gate-degraded` | the novelty gate's state disagrees with what was asked for | **yes** |
| `gate-unreported` | the panel printed no gate line at all | **yes** |
| `no-lens-diff` | the capture omits the routed diff each lens read | **yes** |
| `infra` | a lens hit auth/quota, so the reviewer never ran | no |
| `no-output` | the panel made no SDK calls | no |
| `no-repo-context` | `--require-repo-context` and the tree would not materialise | no — refused before the spawn |
| `no-base-sha` | the item carries no usable `review_base` | no — refused before the spawn |
| `base-unresolved` | it carries one, and the materialised tree does not have it | no — refused before the spawn |
| `exception` | the runner itself threw on this item | no |

The three that stop the run are **misconfigurations**, identical for every
remaining item, and each of those items costs money. The failing item is stored
first — the evidence is what makes it fixable — and then the run aborts.

The test for "stops the run" is *not* "would the next item fail the same way" —
it is **"would the next item cost money before failing the same way."** The three
pre-spawn refusals are run-wide in practice (a shallow clone breaks every item's
base) and are still per-item, because a run of seven free refusals costs nothing
and names seven remedies instead of one.

A run itself ends in one of four states, and they are as closed a vocabulary as
the reasons — `run.json`'s `status` is not validated by the store, so `run.mjs`
owns it:

| `status` | What it means | What to do |
|---|---|---|
| `complete` | every planned item is stored | nothing |
| `partial` | some are not, and nothing stopped the run on purpose | look at the items |
| `aborted` | a run-stopping reason was hit | **fix something**, then start a new run |
| `capped` | the run stopped itself at `--max-cost-usd` | raise the cap and **resume the same run id** |

`capped` is deliberately not `aborted`: nothing is wrong with a capped run, its
stored items are real verdicts, and the two need opposite responses.

Why the taxonomy is this fussy: the version this replaces reached `status: "ok"`
with zero findings for four separate broken reasons. In a precision metric a false
clean review is not noise, it is a **perfect score** — it inflates precision,
deflates recall, and nothing about it looks wrong in any log.

### Which reviewer ran

Every envelope carries `panel_sha`, and it is not optional. `config_hash` cannot
see the panel's *code*, so a new verifier stage or a changed gate leaves it
identical; the pair `(config_hash, panel_sha)` is what "same reviewer" means. The
trap is specific: the runner resolves the panel as **its own sibling**, so running
from a feature branch measures that branch's panel. A dirty working tree outside
`eval/` is refused for the same reason — HEAD's sha does not describe modified
bytes. `--panel-sha` records one deliberately, and `panel_sha_source` says it was
told rather than measured.

### Latency comes from `review-timing.json`

`duration_ms` is the panel's own wall-clock, or **`null`** with
`duration_source: "absent"`. It is never `sumExecutions`'s flat `duration_ms` sum:
the panel runs its lenses, and each lens's samples and verifier calls,
concurrently, so that sum overcounts by the concurrency factor — #669 measured a
~12-minute panel reported as 36–63. The sum is still recorded, under the name
`sdk_duration_ms_sum`, which is not a duration. A run's totals sum `duration_ms`
only over items that have one and carry that `n` as `duration_items`.

## Running it in CI — the replay lane

`.github/workflows/eval-replay.yml` is the same replay, in a clean box, from the
Actions tab. It is **`workflow_dispatch` only** — never a schedule, never a pull
request, never `workflow_run` — because it is the one workflow in this repository
that spends model budget, and a paid job that can start without a human press is the
failure the whole design is arranged against.

Run it from **Actions → Eval Replay → Run workflow**. Six inputs, and four of them
are required because a forgotten one is either a wrong measurement or a bill:

| Input | Required | What it does |
|---|---|---|
| `corpus_version` | **yes** | which frozen corpus, e.g. `2026-08-07-pilot` |
| `run_id` | **yes** | the id STEM. Each replicate becomes `<stem>__k1`, `__k2`, … |
| `max_cost_usd` | **yes** | the ceiling **per replicate**. No default, ever — see below |
| `panel` | **yes** | `stub` = free dry run · `real` = spends money. Defaults to `stub` |
| `replicates` | yes (K=3) | how many independent replays of the whole corpus |
| `items` | no | a subset, e.g. `pr-524`. Empty means the whole corpus |

### What it costs, and what bounds it

**`max_cost_usd` is per replicate, not per dispatch.** `--max-cost-usd` bounds one
`--run-id`, and K replicates are K run ids, so a dispatch's exposure is `K × cap`.
Nothing inside `run.mjs` can say that — it does not know it has siblings — so the
preflight prints the multiplication before any leg starts:

```text
  EXPOSURE     : $8.00 cap PER REPLICATE x 3 = $24.00 maximum for this dispatch
```

Three ceilings, and none is redundant with the others: the cap bounds spend, the
per-item `--panel-timeout` bounds one runaway panel, and the job's `timeout-minutes`
bounds everything else. The preflight **recomputes** that the last is larger than
what the first two permit, and refuses the dispatch when it stops being true — so an
eighth corpus item cannot silently start getting jobs killed mid-replay.

A run that stops at its cap is `status: "capped"` and exits non-zero, so **the job
goes red even though nothing is wrong**. That is deliberate: it did not do what it
was asked. The data it did buy is still committed. Raise the cap and re-dispatch the
same `run_id` to continue.

### Resuming, and why the run id is required

Re-dispatch with the **same `run_id`** and stored items are not re-run and not paid
for twice. That is the whole reason `run_id` has no default: `run.mjs` will invent one
from the clock, and an invented id cannot be named by a later dispatch, so "a crash
costs one item" quietly becomes "a crash costs the run".

One caveat worth knowing before a retry: an item stored as an **error** counts as
stored, so a leg that met a rate limit and recorded `infra` items will *skip* them on
resume. Those need a new run id, or the error items removed from the store by hand.

### The dry run, and how to tell it apart

`panel: stub` swaps in `adapters/stub-panel.mjs` and calls no model. It exercises the
entire lane — preflight, checkout, pull-ref fetch, worktree, replay, cost cap, store
write, artifact, staging, commit — and stops one step short of the push, because
committing canned output into the store's permanent history is the one part of a dry
run that could not be undone.

It is deliberately impossible to mistake for a real run:

- its run ids are prefixed **`dryrun-`**, which is a correctness guard rather than a
  label — a dry run that shared the paid run id would make the paid dispatch skip
  every item as already-done and report a complete run built from canned output;
- every envelope records `panel_sha` as forty zeroes with
  `panel_sha_source: "flag"`, and #716 refuses a non-sibling `--panel-script` without
  an explicit sha, so the stub cannot inherit the real panel's identity;
- nothing is pushed.

### Why the lane fetches pull refs

`wafflebase` squash-merges, so a corpus item's `review_commit` is **never reachable
from `main`** — measured on all seven pilot items against a fresh clone carrying 19
branches and 27 tags: every one absent. No checkout depth fixes that. The lane
fetches `refs/pull/<n>/head` for each planned item and then asserts each commit
arrived, because without them every item refuses with `no-repo-context` — free, and
indistinguishable in a hurry from a run that simply found nothing.

The bases are the other half, and they are **not** carried by the pull refs — a
`review_base` is not reliably an ancestor of its own pull head (pr-524's and pr-605's
are; **pr-415's is not**). They come from `main`'s history, so the lane fetches the
source repository's `main` as well.

**The refs come from the repository the corpus names, not from `origin`.** Every
manifest carries `source_repo`, because a corpus item *is* a pull request of a named
repository. Fetching from `origin` instead would tie a measurement to whichever
checkout is running it — and a **fork does not carry its parent's `refs/pull/*`**, so
the lane would work upstream and refuse every item anywhere else. A manifest without a
usable `source_repo` is refused rather than guessed at.

**A pull ref is a moving pointer, so there is a second attempt.** `refs/pull/<n>/head`
tracks the pull request's *current* head, and a frozen `review_commit` that was later
force-pushed away is no longer contained in it — true of pr-415, whose corpus commit
and pull-ref tip have diverged. Anything the pull refs did not carry is then requested
by full sha from the same repository. The pull ref stays the primary path because it
is a documented GitHub feature and one batched fetch serves every item; the bare-sha
fetch works but rests on server configuration, which is why it is the fallback. It is
deliberately **not** shallow: a shallow tree cannot be blamed, and that would silently
disable the novelty gate.

### Where the write access is

The workflow's own `permissions:` are **read only**. The ability to write lives in
`secrets.EVAL_STORE_TOKEN`, scoped to the eval store and nothing else — the
collector's design, unchanged. The lane adds one property to it: that token is held
by the **final job only**, which runs no model and executes no checked-out code. The
replay jobs build a worktree of an arbitrary past pull request and point a model at
it, so they read the store over unauthenticated HTTPS (it is public) and hold no
credential that can write anywhere.

## Code lives here; data does not

| | |
|---|---|
| **Code** | `wafflebase/wafflebase` → this directory |
| **Data** | `dlgpdmsly2/wafflebase-agent-eval` — corpus items, collected captures, labels |

`--root` is **required and has no default anywhere**. That is not fussiness:
**git history is permanent**, so one forgotten flag that fell back to a path
inside this repository would commit benchmark data into `wafflebase` for good, and
no later `git rm` shrinks anyone's clone. `capture-store.mjs` (#675) established
the rule and the reasoning is written out there.

The layout under a root, matching the collector's:

```text
<eval repo>/
├── corpus/items/pr-664/{meta.json, diff.patch, changed-files.txt, issue-spec.md}
├── corpus/manifests/<corpus-version>.json     the item index for one named version
├── runs/<run-id>/run.json                     the run's summary, recomputed from its items
├── runs/<run-id>/config.snapshot.json         which reviewer produced them — write-once
├── runs/<run-id>/items/pr-664/{envelope.json, payload.json}
├── captures/stage-detail/…                    written by collect-captures.mjs
└── labels/                                    human adjudication (13 files, hand-made)
```

## What a corpus item is

Four files, and between them everything the panel reads about one pull request.

| File | Why a reviewer needs it |
|---|---|
| `diff.patch` | the reviewable change, as a unified diff |
| `changed-files.txt` | the paths, so a lens's `appliesWhen` file-class scoping resolves the way it did live |
| `issue-spec.md` | what the change was *meant* to do — only present when the PR closes an issue, because a `needsIssueSpec` lens must be able to tell "no issue" from "an empty one" |
| `meta.json` | which PR, at which commit, off which base, and the sha256 of the diff |

The fields of `meta.json` that are load-bearing rather than descriptive:

| Field | Why it matters |
|---|---|
| `review_commit` | the commit a replay checks the tree out at |
| `review_base` | what a replay passes as `--base-sha`. **This is what switches the shipped novelty gate on.** Without it a replay measures the gate with novelty OFF and `lane: "backlog"` can never occur — a replayed gate that is not the shipped gate, with nothing in the output saying so |
| `review_point` | which commit the diff was taken at, and **which rule chose it**: `pr-open` (default), `first`, `head`, `auto` — or `pinned`, meaning `--review-commit` named the sha for this item and no rule ran. `pinned` is a value this field holds, never a `--review-point` the flag accepts: there is no commit it could resolve to on its own |
| `diff_method` | *how* the diff was produced. `fork-point` / `base-tip` / `gh-pr-diff` are faithful three-dot diffs; `single-commit` is a degradation and is refused unless you ask for it |
| `sha256_diff` | the diff's own hash. Re-verified against the bytes on every write, and what PR 16's label-staleness check compares against |
| `additions` / `deletions` / `scope` | measured from **the frozen diff** — this is the field to segment by |
| `localization_scope` | how spread out the change is: `single_hunk` / `single_file` / `multi_file` / `cross_module` / `unknown`, where a *module* is the first two path segments. From the frozen diff, via `classify.mjs`'s own rule. A 400-line change in one file and a 400-line change across nine modules are different review problems at the same `scope`. Additions, modifications, **deletions and renames** all count — a deletion's path is read off the `diff --git` header, since its `+++` line says `/dev/null`. `unknown` means the rule could parse **no path at all**: a diff that names none, or one where git C-quoted every path (`+++ "b/na\303\257ve.ts"`, for a path with a special or non-ASCII byte) — the one case where `changed_files` can be populated while this field is `unknown`, because the C-unquoter is private to `extract-corpus.mjs` |
| `pr_additions` / `pr_deletions` | the merged PR's totals, kept as provenance. The gap between these and the pair above is how much the fix loop added *after* review |

## Freezing a PR

```bash
EVAL=../wafflebase-agent-eval        # a sibling checkout of the eval repo
node scripts/agent/eval/extract-corpus.mjs \
  --root "$EVAL" --corpus-version 2026-08-05a --prs 664,673

# or the most recent merged PRs
node scripts/agent/eval/extract-corpus.mjs \
  --root "$EVAL" --corpus-version 2026-08-05a --limit 20

node scripts/agent/eval/extract-corpus.mjs --help    # every flag
```

### Pinning the review commit for one item

`--review-point` is four rules for **guessing** which commit a reviewer read. When
that is already known for a given pull request, name it:

```bash
node scripts/agent/eval/extract-corpus.mjs \
  --root "$EVAL" --corpus-version 2026-08-05a --prs 415,429,471 \
  --review-commit pr-415=51c01826aa9f05e4cef9ee498668e3f2321b3602,pr-429=c35d715b177647e0443266d21c326f43a5d34705
```

Those items freeze at the named commit and record `review_point: pinned`; #471,
unpinned, still follows `--review-point`. Full 40-character shas only — `git`
would resolve an abbreviation today and could resolve it elsewhere after the next
fetch, and a corpus item is forever.

**A pin that cannot be honoured refuses the whole run before anything is written**,
rather than skipping the item or falling back to `pr-open`. Three ways to get that:
a malformed entry or an abbreviated sha (usage error, exit 2), a pin naming a PR
that is not being frozen (exit 2), and a sha that does not resolve in
`--repo-source` (exit 1). The reason is the failure mode: a `pr-open` freeze and a
pinned freeze produce output of **identical shape**, so a pin that quietly did not
apply is invisible in the item, in the manifest and in the exit code. Each pinned
commit is fetched by sha and pinned at `refs/eval/pin/<n>`, which is how a commit a
force-push removed from `refs/pull/<n>/head` stays reachable.

Committing what lands in `$EVAL` is a human's separate, deliberate act — this tool
writes files and never touches git in the eval repo.

`--repo-source` (default: this repository) is the local clone the PR's commits are
fetched into, under `refs/eval/`. Clean those up with:

```bash
git for-each-ref --format='%(refname)' refs/eval | xargs -n1 git update-ref -d
```

## Determinism, and why re-running is a check rather than a no-op

Two extractions of one PR must produce **byte-identical** files. A comparison
between two reviewers is only a comparison if they read the same bytes, and a
corpus item that quietly differs between extractions breaks every number
downstream *while looking fine*.

So a re-extraction over an existing root does not overwrite and does not silently
skip. It **compares**, and reports any difference as `DRIFT` with a non-zero exit:

```text
DRIFT pr-664: re-extraction differs from the stored item in diff.patch,
              stored sha256_diff vs stored diff.patch — NOT overwritten
```

A **derived** field — one computed from the diff rather than read off the PR — is
compared too, even though the diff bytes are already compared. The bytes prove the
*input* is stable and say nothing about the derivation: edit the rule behind
`localization_scope` and a re-extraction yields a different value from identical
bytes, which nothing else in the comparison can see. The same entry catches an item
frozen *before* the field existed, which is otherwise invisible — a field outside
the list cannot drift, so the run prints `= unchanged` and re-indexes the stored
item without it. So a new derived field joins the list in the commit that adds it.
(`additions` / `deletions` / `scope` are not in it yet — a gap, not a distinction.)

The stored bytes are left exactly as they were; deciding which copy is right is a
person's job. This is also why `meta.json` carries `sha256_diff` at all, and why
the manifest carries **no timestamp** — a clock reading inside the index would
make the whole extraction differ on every run and the check unrunnable.

## Transcripts are deliberately absent

Spec §8 keeps full model transcripts **out of git**: they are 10–30 MB per run of
debugging aid that no metric reads. The fork's store gzipped them into itself;
this one has no transcript method at all, and that absence is the design rather
than an omission.

A method that answered `null` on every call in production would eventually be read
as *"the model said nothing"* — a confusion this codebase has already shipped once.
So a run envelope carries a **named state** instead: `transcript: {state: "absent" |
"local" | "remote"}`, never `null` and never `""`, with a pointer (a local path,
later an S3 key) beside it when there is one. `validateRunEnvelope` refuses anything
else at the write path, so the rule is enforced rather than remembered. "We did not
keep it" and "there was nothing to keep" are different facts.

## Known limits — read these before quoting any number

Carried forward from the fork harness's `capabilities.md`, keeping what is still
true.

| Limit | What it means in practice |
|---|---|
| **The branch panel is what gets measured** | A replay runs `review-panel.mjs` *from the branch it is checked out on*, so a branch behind `upstream/main` measures a reviewer that is **not what ships**. `panel_sha` in every envelope makes that visible after the fact, and a dirty tree outside `eval/` is refused before the fact — but neither tells you the branch is *stale*. Check that yourself: `git diff --name-only HEAD upstream/main -- scripts/agent/ \| grep -v eval/` |
| **The replay tree needs the review commit to still exist locally** | `run.mjs` materialises `review_commit` as a real **linked git worktree** and passes `review_base` as `--base-sha`, so the novelty gate runs and `lane: "backlog"` is reachable. The cost is a precondition: `--repo-source` must actually hold that commit. It often does not — `wafflebase` squash-merges, so a PR head is never reachable from `main`; `extract-corpus.mjs` fetches it to `refs/eval/pr/<n>`; and deleting those refs leaves an unreachable object that `git gc` eventually prunes. **The runner does not fetch it back** — it refuses the item, for free, naming the `git fetch` that fixes it. Keep the `refs/eval/*` refs, or re-fetch before a run — which is what the CI lane does for itself, per item, before it will spend anything |
| **A shallow clone cannot run the gate** | The worktree shares the source repository's object store, so on a shallow checkout `review_commit` can be present while `review_base` is not. That is CI's default. The runner asks `baseResolves` **before** spawning and refuses the item as `base-unresolved` rather than paying for a panel that would report the gate OFF — but a shallow lane still replays nothing until it is deepened |
| **A diff-only replay over-flags** | The verifier greps the repo **tree**, so replaying with `--no-repo-context` explodes verifier fan-out — that is what billed **$44** on the #521 pilot. `--require-repo-context` refuses to spend on a 0-file checkout and is **on by default**; `--no-require-repo-context` degrades per item instead, and a run that used it records `repo_context: "tree-optional"` because its items may then differ in fidelity from each other |
| **A cost cap cannot stop the item it is spending on** | The panel writes `review-execution.json` as it exits, so what an item cost is unknown until it has finished. `--max-cost-usd` therefore stops the run **before the next item** and never mid-item; the only per-item bound is `--panel-timeout`, and it bounds **time, not dollars**. A run started with `--no-cost-cap` is bounded only by that timeout and by its item count, which the run says out loud at start |
| **The corpus is unlabeled** unless `labels/` says otherwise | Anything computed against "the union of what the runs found" measures *coverage versus what the panel can find across repeated tries*, not *versus every real bug* |
| **`review_point: head` skews approve** | The merged state of a PR is the state after review comments were addressed, so the bugs a reviewer would have found are already fixed. It is offered for comparison, not as a default |
| **Single review pass** | An item replays one pass: no multi-round fix loop and no prior-findings recheck, so round-to-round behaviour is out of scope |
| **`gh pr view` returns a bounded commit list** | `review_point: pr-open` and `first` pick from the commits `gh` reports. A PR with an unusually long commit history may resolve its review point from a truncated list |
| **`window` is decided by commit ORDER, not by content** | A later commit whose contributed diff is identical still reads `after-window`. Real case: pr-549's `158c6faaf` is a merge of `main` into the branch, so the branch's own diff is unchanged from the frozen `d7fea222a` — yet its 5 findings are about code the panel did read. Ordering is the conservative rule and it errs toward `after-window`, which understates the overlap rather than overstating it |
| **`finding_key` is not unique inside the CodeRabbit arm** | 64 of its 3001 findings (2.1%) share a key with another CodeRabbit finding, mostly era-1 comments whose whole title is `LGTM!` — `src/spreadsheet/worksheet.ts::lgtm!` is held by six. A consumer keying a map by `finding_key` loses five of them; use it as a join key, never as an identity |
| **The two arms' `evidence` are not the same amount of text** | An inline CodeRabbit record carries the whole comment body, so the anchor layer sees its backticked identifiers and its `around lines N - M` range. A review-body record carries only the finding's prose — `parseCodeRabbitReview` does not return the per-finding span it sliced — so 1509 of 3001 findings give a matcher less to work with. Not a bug in either module; a field the parser does not return |
| **Exact-string finding keys read low** | `finding_key` on every record is `file::lowercased-summary` — `finding-key.mjs`, the panel's own key — so **one defect reworded counts as two**. That is deliberate rather than unfixed: anything that must agree with `dedupeFindings`, `compareSampleAgreement` or `review-lens-stats.json` has to key findings the way they do, and a looser key here would make our numbers quietly stop matching the panel's. The cross-arm matcher applies `finding-match.mjs` (#646) as a **second, different mechanism** for "the same defect, said differently" — identity and similarity are two jobs. The limit travels with whichever scorer uses the string key |

Two rows of the fork's table are **not** reproduced here because the modules they
describe are not in this directory yet: the stage-pilot's one-item-per-dispatch
limit and the sample-count study's self-consistency oracle. They travel with those
modules.

## Testing

```bash
node --test "scripts/agent/eval/*.test.mjs"      # this directory
# exactly what CI's agent:tests lane runs (#692 added both flags)
cd scripts/agent && node --test-timeout=60000 --test-force-exit --test '**/*.test.mjs'
```

**Do not run `run.test.mjs` twice concurrently on one machine.** Its
raw-output-retention test snapshots `os.tmpdir()` for `eval-item-*` directories
and asserts none appeared, so two parallel runs both fail there. Pre-existing
since #682, harmless in CI (one runner), and not a symptom of anything you did.

`eval/test-lane.test.mjs` reads that lane out of `scripts/verify-self.mjs` and
asserts every suite under `eval/` is matched by its glob, at every depth. The lane
used to be a flat `*.test.mjs`, which matched nothing in here at all — tests that
pass locally and never run again are this project's signature failure, so it is
pinned rather than remembered.
