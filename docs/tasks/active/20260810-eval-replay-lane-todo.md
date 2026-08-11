# The replay lane: running the offline replay in CI, on purpose, once

A `workflow_dispatch`-only workflow that replays the frozen eval corpus through the
review panel in a clean runner — shardable, resumable, and bounded in spend inside
the job.

## The problem

`scripts/agent/eval/run.mjs` can replay a frozen pull request through the review
panel. Every replay so far has run on a laptop, and **no replay against the real
panel has ever been run at all**. Two things are wrong with that as a permanent
arrangement, and only the second is about money.

**A measurement taken on a developer's machine is not falsifiable.** The panel is a
non-deterministic judge, so any result somebody dislikes can be explained by "the
environment differed", and there is no way to check. A runner is the same box every
time, and the envelope already records which panel commit and which lens
configuration produced each item — so the missing half is a place to run it that
someone else can reproduce.

**And the guard built for CI has never met CI.** `run.mjs` refuses an item whose
`review_base` will not resolve in the materialised tree (`base-unresolved`), and that
refusal was written specifically for a shallow CI checkout. Until this lane exists,
the first time that guard runs is a run with money already committed.

There is a third problem, which is the one that would actually have cost something:

**A corpus item's `review_commit` is in no clone of this repository.** `wafflebase`
squash-merges, so a pull request's head is never reachable from `main`. Measured
2026-08-07 against a fresh clone carrying **19 branches and 27 tags** — all seven
pilot items' `review_commit`s **absent**; and after `git fetch origin
refs/pull/<n>/head` for each, all seven **present**, in 1.35s. Their `review_base`es
were present from the clone alone, so `fetch-depth: 0` buys one half and nothing buys
the other. A lane without that fetch replays **nothing**, for free, and reports it
tidily.

## The change

**`.github/workflows/eval-replay.yml`** — three jobs.

| Job | Holds | Does |
|---|---|---|
| `plan` | nothing | validates the dispatch, computes its exposure and the refspecs, emits the leg matrix |
| `replay` | the model token | one job per replicate: fetch the pull refs, replay, upload the run |
| `collect` | the store-write PAT | downloads every leg, stages, commits, pushes |

**`scripts/agent/eval/replay-plan.mjs`** — the preflight, pure and testable:
`planReplay` turns a dispatch plus the frozen manifest into either a plan or a list
of reasons it will not run. It is the only place that can see the whole dispatch, and
therefore the only place that can multiply the per-replicate cap by K.

**`scripts/agent/eval/replay-plan.test.mjs`** — 23 tests, including the two the
handoff asked for by name (no write scope anywhere; `workflow_dispatch` is the only
trigger) and the ones mutation testing showed were needed.

**`scripts/agent/eval/README.md`** — how to run it, what each input does, what it
costs, and how to tell a dry run apart from a real one.

### Five decisions

**1. Which inputs are required, and does the cap have a default?**

Four of six are required, and the cap has **no default at either layer**.

`corpus_version`, `run_id`, `max_cost_usd` and `panel` are required; `replicates`
defaults to the project's fixed K=3; `items` defaults to the whole corpus.

`run_id` is required for a reason that is not obvious and is not tidiness:
`run.mjs` will invent one from the clock, and **an invented id cannot be named by a
later dispatch**, so the resumability the whole shard design rests on quietly stops
existing. A defaulted run id makes "a crash costs one item" into "a crash costs the
run".

On the cap, the handoff anticipated a split — require it at the workflow layer even
though the CLI defaults it off — and that split turned out to be unnecessary,
because **#716 already requires it**. Its own reasoning got there first: an
irreversible default is not a convenience, a truncated run is recoverable and money
is not. So the two layers agree, and the workflow is deliberately **narrower**: it
offers no way to express `--no-cost-cap`. Unbounded is a choice for an operator
watching a terminal, and nobody is watching this. A test asserts that flag can never
appear here.

**2. How is the run sharded, and what happens to the store?**

**By replicate**, one job per K, one `run_id` per leg (`<stem>__k1`, `__k2`, …).

That is not merely convenient: `run_id` already *means* "which replicate this is" —
it exists so K replicates stay distinguishable, and reliability is defined over the K
of them. Sharding by item instead would produce 21 run ids for 21 replays,
dissolving the grouping every reliability number is computed over, and it would
remove the cost cap's subject — a cap per run would then bound one item.

**The store race is avoided rather than resolved.** Each leg writes only under its
own `runs/<leg-id>/`, uploads that as an artifact, and pushes nothing. One final job
downloads all legs and makes **one commit**. Two legs therefore never author the same
path and there is nothing to race on.

*What happens when a second writer loses:* the only push left is that single job's,
and it still races the **capture collector**, which pushes to the same repository on
its own schedule and whose `concurrency: capture-collect` group does not serialise
against this workflow. So the push is `git push || (git pull --rebase && git push)`,
the collector's own idiom. Rebasing is always safe here because run ids are
write-once: two writers never author different content for one path. If the retry
also loses, the job goes red and every leg's artifact still holds the data for 30
days.

*Rejected:* a job-level `concurrency` group to serialise the legs — it serialises the
whole leg, not just its push, which is the entire wall-clock saving.

**3. Does the lane commit, or hand back an artifact?**

**Both, and the commit is not optional for a real run.**

The two precedents point opposite ways and the spec's is the older one. It argued
that outputs should come back as an artifact and be committed by a human-opened PR,
*"which is what keeps CI from needing repo write access"* — and that stated reason
**no longer holds**: since the collector, the write access is not CI's. It is a
fine-grained PAT scoped to one other repository, and this repository's `GITHUB_TOKEN`
stays as powerless as it was. The premise the spec's version rests on was overtaken.

What remains of it is "a human between an expensive run and permanent history", and
that is the wrong place for the gate. The thing a human should be between is the
button and the **spend**, which is what `workflow_dispatch` and a required cap
already do. Putting a human after the fact protects permanent history from *correct
data that was expensive to produce* — and reintroduces exactly the deadline problem
the collector was built to kill, for the most expensive data in the project. An
artifact expires in 30 days; a run that finishes at 3am and is never downloaded is
gone.

There is a second, mechanical reason: **resume across dispatches reads the store.**
A leg's resume works because the previous run's items are in the store checkout it
clones. Artifact-only would make every re-dispatch start from nothing.

So: every leg uploads an artifact unconditionally (the backup), and a real dispatch
commits. *Recorded alternative:* if the maintainer would rather review each run
before it lands, the change is one `if:` on the push step plus a human `git am` from
the artifact — no restructuring.

**4. How is it tested without spending anything?**

`panel: stub` swaps `--panel-script` for `adapters/stub-panel.mjs`. The whole lane
runs — dispatch, preflight, checkout, pull-ref fetch, worktree, replay, cost cap,
store write, artifact, download, staging, commit — and **stops one step before the
push**, because committing canned output into permanent history is the one part of a
dry run that cannot be undone.

The counter-argument is real: a stub path that ships can be taken by accident, and a
run that was supposed to cost money and did not is its own silent failure. Four
things make the distinction loud, and the first is a correctness guard rather than a
label:

- **Dry-run ids are prefixed `dryrun-`.** Without that, a dry run would write to the
  run id a paid dispatch later resumes into — and resume *skips stored items*, so the
  paid dispatch would find seven stub items present, skip all of them, spend nothing,
  and report `complete`. A store full of canned output filed under the pilot's own
  name, producing confident numbers from nothing. The prefix makes it
  unrepresentable.
- `panel_sha` is forty zeroes with `panel_sha_source: "flag"` — not a commit in any
  repository. #716 refuses a non-sibling `--panel-script` without an explicit sha, so
  the stub cannot inherit the real panel's identity even deliberately.
- The preflight banner leads with `DRY RUN … NOTHING IS PUSHED`.
- Nothing is pushed.

The fail direction of the choice input is the same: `stub` is listed first, so a
forgotten dropdown yields a free run that produced nothing, not a bill.

**5. Should the environment require an approval before spending?**

**Recommended, but it cannot use the `agent` environment — and the handoff's note
that it could is wrong.**

`CLAUDE_CODE_OAUTH_TOKEN` is an **environment secret of `agent`**
(`agent-sdk-smoke-test.yml` says so in a comment: *"environment: agent # where
CLAUDE_CODE_OAUTH_TOKEN lives"*), and **eight** workflows declare that environment,
including the gating review panel, the fixer and the summarizer. Adding a required
reviewer to `agent` would put a human approval in front of **every AI review in the
repository**. The lever exists; pulling it breaks the repo.

The lane therefore ships with `environment: agent`, which works today and needs no
settings change. An approval gate needs a **new** environment — say `eval-paid` —
with its own required reviewers **and a copy of `CLAUDE_CODE_OAUTH_TOKEN` in it**,
which only the maintainer can create. That is a repository-settings decision, not a
code one, and it is asked rather than assumed.

Worth weighing either way: the gate's value is bounded, because the dispatch form
already requires four inputs including a cost ceiling, and the preflight prints the
exposure and refuses a malformed dispatch for free. What an approver adds is a second
pair of eyes on the *number*.

## Corrected while building

- **The handoff said the runner "ships the cap defaulting to OFF".** It does not — it
  **requires** `--max-cost-usd` or an explicit `--no-cost-cap`. Read from its `--help` and its option parser rather than assumed.
  The consequence is that decision 1's anticipated "require it at the workflow layer
  even if the CLI does not" split was not needed; the workflow is narrower than the
  CLI instead.
- **The handoff said `environment: agent` is the approval lever.** It is shared with
  eight workflows; see decision 5.
- **The plan says "shardable by item"**; this shards by replicate, for the reasons in
  decision 2. By-item remains the escape hatch for a corpus that outgrows one job,
  and it needs a different merge story because two legs sharing a run id would race
  on `run.json`.
- **Two cost estimates in the kit disagree** — the handoff says $60–180 for 21
  replays, the spec says $20–60. Neither is measured. This is why the recommended
  first dispatch is a one-item calibration rather than the pilot.
- **The fork's `agent-eval.yml` is a weaker starting point than "port plus
  extension" suggests.** It interpolates `${{ inputs.* }}` directly into `run:`
  bodies (the class of bug `collect-captures.test.mjs` exists to prevent), uses
  `git add -A` (forbidden here), declares no `permissions:` block at all, has no cost
  cap, re-extracts the corpus in CI rather than reading the frozen one, and sets
  `timeout-minutes: 360`, which is the default ceiling rather than a bound. Its
  shape — dispatch-only, artifact plus push, bank the spend early — was worth
  keeping; its body was not.
- **The lane originally fetched the corpus refs from `origin`, which is wrong in a
  way that only shows up off the upstream checkout.** A corpus item is a pull request
  of the repository the manifest names in `source_repo`; `origin` is whatever checkout
  happens to be running. **A fork carries none of its parent's `refs/pull/*`** —
  measured 2026-08-10: `wafflebase/wafflebase` has all seven pilot refs,
  `dlgpdmsly2/wafflebase` has one, its own. So the original form worked upstream and
  failed everywhere else with `couldn't find remote ref`, after which every item would
  have refused for free and the run would have looked like a panel that found nothing.
  Now derived from the manifest, and a missing `source_repo` is a refusal.
- **I wrote that GitHub refuses a bare-sha fetch. It does not.** The comment claimed
  `uploadpack.allowReachableSHA1InWant` is off, so `git fetch <url> <sha>` would be
  refused. Verified false on this server: a virgin `git init` repo fetches
  `51c01826` — a commit unreachable from *every* upstream ref — and exits 0. The
  correction matters because it changes the design: a bare-sha fetch is available as a
  fallback, and the lane now needs one. **A pull ref is a moving pointer**, so a frozen
  `review_commit` that was later force-pushed away is not in it; pr-415's corpus commit
  and pull-ref tip have diverged outright. Without the fallback, re-freezing the corpus
  at the commit CodeRabbit reviewed would make the fetch step refuse pr-415 and fail
  every dispatch. The pull ref stays primary — documented, and one batched fetch for
  all items — with the bare sha as a strictly-second attempt ahead of an unchanged
  assertion.
- **The fallback must not be shallow.** `--depth=1` leaves the repository shallow, and
  a shallow tree cannot be blamed — which would silently disable the novelty gate the
  worktree exists to enable. Verified that the undepthed form leaves the clone
  unshallow and that `git blame` works in a worktree built at the fetched commit.
- **And the bases are not carried by the pull refs.** I assumed a `review_base` would
  be an ancestor of its own pull head; it is for pr-524 and pr-605 and **is not for
  pr-415**. So the lane fetches the source repository's `main` too, which also stops
  base resolution depending on how fresh the running checkout's history is.
- **Two of my own tests were scoped to the whole file** and were satisfied by
  matching lines in other steps: the fetch step's `exit 1` was answered by the
  staging step's, and the commit step's dry-run gate by the replay step's identical
  one. Both mutations passed a green suite. Found by mutation testing, fixed with a
  per-step slice.

## Fail directions

| What fails | What happens | Why that is the safe direction |
|---|---|---|
| An input is malformed or a corpus item is missing | `plan` refuses, exit 2, naming every fault at once | One runner-minute, before any leg starts. Errors accumulate so a bad dispatch is corrected in one edit, not three |
| The pull-ref fetch brings back the wrong thing | The fetch step fails, naming the item and commit | Without the assertion, every item refuses `no-repo-context` — free, and easily mistaken for a panel that found nothing |
| A leg hits its cost cap | `status: "capped"`, exit 1, **the job goes red**; the artifact still uploads and `collect` still commits | Red because it did not do what it was asked. The data it bought survives, and re-dispatching the same run id continues from there |
| A leg fails or times out | `fail-fast: false` keeps the siblings running; `always()` on the upload banks whatever was stored | A timed-out job's steps are *cancelled*, so `!cancelled()` on the upload would discard exactly the run whose data is least reproducible |
| The store push loses a race | One rebase-and-retry, then red, with every leg's artifact intact for 30 days | Run ids are write-once, so rebasing can never produce conflicting content |
| Someone dispatches twice | The workflow `concurrency` group queues the second | A cancelled paid run is money spent and thrown away, so `cancel-in-progress: false` |
| The panel mode is anything but `real` | Treated as a dry run everywhere | A mistyped mode must not be able to spend |
| The corpus grows past what the timeouts allow | `plan` refuses and says which two numbers disagree | A job killed mid-item is the one failure that costs money and produces nothing |

## Explicit non-goals

- **The free scoring lane on a schedule.** That half of plan PR 22 stays in Wave 7:
  it scores stored runs, and neither the runs nor the scorers exist.
- **Any change to `run.mjs`,** its flags or its behaviour. Where the lane needed
  something the CLI does not offer, it is written down rather than patched in.
- **Any write scope on `wafflebase/wafflebase`.** No `contents: write`, no
  `checks: write`, no `pull-requests: write`, no `id-token: write`.
- **Adding this workflow to `capture-collect.yml`'s `workflows:` list**, or to any
  `workflow_run` chain. The replay stores its own envelopes, and that chain is at
  GitHub's three-level limit with no headroom.
- **Computing a metric, or scoring anything.**
- **Triggering the workflow, or using a real credential.** Every verification below
  drives the stub panel.

## Verification

Built on `upstream/main` `e3fb7478e`, which carries the runner's cost-and-fidelity
guards (merged as `efb0d3e8b`). The invocation was written against that branch while
it was in review and re-checked against the merged `--help`: every flag identical,
`--max-cost-usd` still required with `--no-cost-cap` as the explicit opt-out, so the
invocation needed no change.

- [x] **`actionlint` 1.7.7 clean** on the new workflow. Baseline: clean on all 15 of
      `main`'s workflows. Verified non-vacuous — a planted bad `runs-on` is reported.
- [x] **`shellcheck` 0.10.0 wired into actionlint** and clean on the new workflow.
      This matters: without shellcheck on `PATH`, actionlint does not lint `run:`
      bodies at all, and this workflow is mostly shell. `main` carries **9**
      pre-existing shellcheck findings; the new file adds **0**. Verified
      non-vacuous — a planted unquoted variable is reported.
- [x] **A test asserting the `permissions:` block has no write scope of any kind**,
      mirroring the collector's, plus no `: write` anywhere in the file.
- [x] **A test asserting `workflow_dispatch` is the only trigger.**
- [x] **27 of 27 mutations caught.** Every new assertion was broken deliberately and
      watched go red, including the two that first went unnoticed.
- [x] **A full free end-to-end**, every step of the lane run in order against a
      pristine CI-style clone: preflight → public store clone → pull-ref fetch and
      per-item assertion → **real worktrees, 2470–3042 files per item** →
      replay → cap → store write → resume → artifact round trip → staging → commit
      → **stopped before the push**.
- [x] **The force-push fallback demonstrated.** With pr-415 re-pinned to the stranded
      commit, the step without the fallback reports `MISSING pr-415` and fails the
      dispatch; with it, the retry fetches the commit, all seven resolve, and the
      clone stays unshallow.
- [x] **Verified on a fork-origin checkout**, which is the case that motivated the
      explicit remote: fetching from `origin` fails with `couldn't find remote ref
      refs/pull/415/head`; fetching from the corpus's `source_repo` brings all seven
      plus `main`, all seven bases resolve, and a stub replay completes with the gate
      ON.
- [x] **The refs question answered with evidence.** All seven `review_commit`s absent
      from a fresh clone with 19 branches and 27 tags; all seven present after the
      lane's fetch step. All seven `review_base`es present from the clone alone.
- [x] **Resumability shown.** A second invocation with the same run id: five items
      `already stored, not re-run`, two replayed, run `complete`.
- [x] **The cost cap demonstrated.** `--max-cost-usd 2` against the stub's canned
      $0.42/item stopped before item 6 with `status: "capped"`, `notes` naming the
      two items not replayed, and exit 1 — not a generic failure.
- [x] **The novelty gate ran** on every item: `gate.state: "on"` with the item's own
      frozen `review_base`. This is the fidelity property #716 exists for, shown
      working in a CI-shaped checkout.
- [x] **`resolvePanelSha`'s git path** — the one function a dry run bypasses —
      checked separately against a clean CI-style checkout: `panel_sha_source: "git"`,
      sha equal to `HEAD`.
- [x] Verified from the **committed tree**, not the working copy.
- [x] **The runner's flags are pinned by a test.** Written while that change was
      unmerged, when it was the ordering constraint and failed on `main` by design;
      it now passes on `main` and stays as the guard against the lane and the CLI
      drifting apart.
- [ ] **A real dispatch has never been run**, so the GitHub-side behaviour of the
      matrix, the artifact round trip and the push is reasoned rather than observed.
      Named precisely in the hand-back.

      Still true as of 10 Aug 2026: `actions/workflows/eval-replay.yml/runs`
      reports `total_count: 0`. Nothing about the workflow's GitHub-side
      behaviour has been observed yet.
- [ ] **The real panel has never been driven by this lane.** Everything above uses
      `adapters/stub-panel.mjs`.

      Half of this moved on 10 Aug 2026: the real panel **has** now been driven
      and its results pushed to the store (`runs/pilot-01__k1`, adapter
      `reviewer`, 7/7 items, $32.91). It was driven locally, not by this lane —
      so what remains unobserved is narrower than when this was written: the
      lane's own path to the same outcome, not the panel's ability to produce
      one.
