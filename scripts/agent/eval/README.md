# Offline replay of the review panel (`scripts/agent/eval`)

The review panel is a **non-deterministic judge**. Ask it the same question twice
and it may answer differently, which makes "did that change help?" unanswerable
while the *input* is also moving. This directory holds the machinery for holding
the input still: freeze a past pull request into a **corpus item** — the diff, the
changed files, the issue text, the metadata — and the panel can be re-run over
exactly what a reviewer first saw.

**Nothing here invokes a model, and nothing here costs anything.** Freezing a PR
is `gh` and `git`.

## What exists today

| File | Role | Model calls? |
|---|---|---|
| `store.mjs` | `EvalStore` — corpus items over an eval-data root; `store.captures` delegates to the merged `capture-store.mjs` | no |
| `extract-corpus.mjs` | freeze a past PR into an item, and re-check a frozen one against a fresh extraction | no (uses `gh` + `git`) |
| `config-hash.mjs` | `config_hash` — the fingerprint of a lens **configuration**, so two results can be told apart. Configuration only: the reviewer is the pair `(config_hash, panelSha)` | no |
| `config-build.mjs` | lenses dir → config manifest + reproduction snapshot, and a snapshot back into a lenses dir the panel can load. Takes an output path; persisting a snapshot is the runner's wiring | no |

The **runner** (replay an item through the panel), the arm adapters and every
scorer are not built yet. When they arrive they read items through `EvalStore` and
nothing else.

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
| `localization_scope` | how spread out the change is: `single_hunk` / `single_file` / `multi_file` / `cross_module` / `unknown`, where a *module* is the first two path segments. From the frozen diff, via `classify.mjs`'s own rule. A 400-line change in one file and a 400-line change across nine modules are different review problems at the same `scope`. `unknown` means no path was parsed — either a diff that names none, or (a known gap in that helper) one whose paths are all C-quoted |
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
When the runner records envelopes it will carry a **pointer** to a transcript (a
local path, later an S3 key), and any reader of one must return a **named state**
(`absent` / `local` / `remote`), never `null` and never `""`. "We did not keep it"
and "there was nothing to keep" are different facts.

## Known limits — read these before quoting any number

Carried forward from the fork harness's `capabilities.md`, keeping what is still
true.

| Limit | What it means in practice |
|---|---|
| **The branch panel is what gets measured** | A replay runs `review-panel.mjs` *from the branch it is checked out on*. If that branch drifts behind `upstream/main`, every run measures a reviewer that is **not what ships**. Check first: `git diff --name-only HEAD upstream/main -- scripts/agent/ \| grep -v eval/` |
| **A frozen diff is not the whole review context** | The verifier greps the repo **tree**, so a diff-only replay over-flags and explodes verifier fan-out — that is what billed **$44** on the #521 pilot. An item records `review_commit` precisely so a replay can materialise the tree; freezing the diff is necessary and not sufficient |
| **The corpus is unlabeled** unless `labels/` says otherwise | Anything computed against "the union of what the runs found" measures *coverage versus what the panel can find across repeated tries*, not *versus every real bug* |
| **`review_point: head` skews approve** | The merged state of a PR is the state after review comments were addressed, so the bugs a reviewer would have found are already fixed. It is offered for comparison, not as a default |
| **Single review pass** | An item replays one pass: no multi-round fix loop and no prior-findings recheck, so round-to-round behaviour is out of scope |
| **`gh pr view` returns a bounded commit list** | `review_point: pr-open` and `first` pick from the commits `gh` reports. A PR with an unusually long commit history may resolve its review point from a truncated list |
| **Exact-string finding keys read low** | Where anything downstream keys findings on `file::lowercased-summary`, one defect reworded counts as two. Upstream `finding-match.mjs` (#646) exists to fix that; the limit travels with whichever scorer still uses the string key |

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
