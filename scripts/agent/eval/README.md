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

The CodeRabbit adapter, the cross-arm matcher and every scorer are not built
yet. When they arrive they read items through `EvalStore` and nothing else.

## One record, two arms

A comparison needs one shape. The panel writes `verdict.json` findings carrying
`lane`, `novelty`, `unsettled` and a per-finding verifier outcome; CodeRabbit
posts markdown comments. `finding-record.mjs` is the shape both map into, and
`adapters/panel.mjs` fills our side:

```bash
EVAL=../wafflebase-agent-eval
node scripts/agent/eval/adapters/panel.mjs --root "$EVAL" --run <run-id>
node scripts/agent/eval/adapters/panel.mjs --root "$EVAL" --run <run-id> --population sampled --json
```

Records are **derived, never stored**: recomputable from an immutable envelope,
deterministically and for free. Persisting them would spend the store's
write-once rule on a shape that is cheap to recompute and expensive to correct.

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

**Today the lane-aware path is inert, and that is expected.** Every replay so far
runs with the novelty gate OFF, so `lane: "backlog"` cannot occur and every
blocking finding routes to `blocking` by default. `panel.gate_state` rides on
every record so a gate-off run is never pooled with a gate-on one.

## Replaying an item

```bash
EVAL=../wafflebase-agent-eval
node scripts/agent/eval/run.mjs --root "$EVAL" --corpus-version 2026-08-05a
node scripts/agent/eval/run.mjs --help          # every flag
```

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
| `no-panel-json` | it exited 0 and wrote no usable `panel.json` | no |
| `gate-degraded` | the novelty gate's state disagrees with what was asked for | **yes** |
| `gate-unreported` | the panel printed no gate line at all | **yes** |
| `no-lens-diff` | the capture omits the routed diff each lens read | **yes** |
| `infra` | a lens hit auth/quota, so the reviewer never ran | no |
| `no-output` | the panel made no SDK calls | no |
| `no-repo-context` | `--require-repo-context` and the tree would not materialise | no |
| `exception` | the runner itself threw on this item | no |

The three that stop the run are **misconfigurations**, identical for every
remaining item, and each of those items costs money. The failing item is stored
first — the evidence is what makes it fixable — and then the run aborts.

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
| `review_point` | which commit the diff was taken at: `pr-open` (default), `first`, `head`, `auto` |
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
| **The replay tree is an archive, not a checkout** | `run.mjs` materialises `review_commit` with `git archive`, so lenses do get real surrounding code — but the tree has **no `.git`**, so the novelty gate cannot `blame` and nothing passes `--base-sha`. Every replay today therefore measures the gate **OFF**, which the envelope records as `gate.state: "off-no-base-sha"` rather than leaving implicit. A real worktree, and `--base-sha` with it, is PR 6 |
| **A diff-only replay over-flags** | The verifier greps the repo **tree**, so replaying with `--no-repo-context` explodes verifier fan-out — that is what billed **$44** on the #521 pilot. `--require-repo-context` refuses to spend on a 0-file checkout, and it is **opt-in today** |
| **The corpus is unlabeled** unless `labels/` says otherwise | Anything computed against "the union of what the runs found" measures *coverage versus what the panel can find across repeated tries*, not *versus every real bug* |
| **`review_point: head` skews approve** | The merged state of a PR is the state after review comments were addressed, so the bugs a reviewer would have found are already fixed. It is offered for comparison, not as a default |
| **Single review pass** | An item replays one pass: no multi-round fix loop and no prior-findings recheck, so round-to-round behaviour is out of scope |
| **`gh pr view` returns a bounded commit list** | `review_point: pr-open` and `first` pick from the commits `gh` reports. A PR with an unusually long commit history may resolve its review point from a truncated list |
| **Exact-string finding keys read low** | `finding_key` on every record is `file::lowercased-summary` — `finding-key.mjs`, the panel's own key — so **one defect reworded counts as two**. That is deliberate rather than unfixed: anything that must agree with `dedupeFindings`, `compareSampleAgreement` or `review-lens-stats.json` has to key findings the way they do, and a looser key here would make our numbers quietly stop matching the panel's. The cross-arm matcher applies `finding-match.mjs` (#646) as a **second, different mechanism** for "the same defect, said differently" — identity and similarity are two jobs. The limit travels with whichever scorer uses the string key |

Two rows of the fork's table are **not** reproduced here because the modules they
describe are not in this directory yet: the stage-pilot's one-item-per-dispatch
limit and the sample-count study's self-consistency oracle. They travel with those
modules.

## Testing

```bash
node --test "scripts/agent/eval/*.test.mjs"      # this directory
cd scripts/agent && node --test '**/*.test.mjs'  # exactly what CI's agent:tests lane runs
```

`eval/test-lane.test.mjs` reads that lane out of `scripts/verify-self.mjs` and
asserts every suite under `eval/` is matched by its glob, at every depth. The lane
used to be a flat `*.test.mjs`, which matched nothing in here at all — tests that
pass locally and never run again are this project's signature failure, so it is
pinned rather than remembered.
