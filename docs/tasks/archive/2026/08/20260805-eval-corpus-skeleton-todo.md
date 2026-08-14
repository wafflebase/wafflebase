# Freeze a pull request into a replayable corpus item

A **new** document rather than a section appended to
`20260805-capture-collector-todo.md`. That one is about getting the panel's own
records out of GitHub before they expire; this is the other half of the same
input problem — a *past* pull request, frozen so the panel can be pointed at it
again. It shares one module with the collector (`capture-store.mjs`, composed
here) and nothing else.

## The problem

The review panel is a **non-deterministic judge**. Ask it the same question twice
and it may answer differently. That makes two ordinary questions unanswerable:

1. *"Did that rubric change help?"* — you cannot tell, because the diff you tried
   it on has also moved on.
2. *"Why did the panel say that?"* — you cannot look, because the input it read is
   not written down anywhere. The diff a reviewer saw at review time is not the
   merged diff, and after a fix loop it is not recoverable from the PR page either.

Nothing in the repository can currently hold a review's input still. The panel
reads a PR live, decides, and the exact bytes it read are gone.

There is a second, sharper problem hiding in the first. The *obvious* way to
re-review a past PR is to take its merged diff — and the merged diff is the state
**after** review comments were addressed. The bugs a reviewer would have found are
already fixed in it. Any measurement taken that way is biased toward approve, in a
direction and by an amount nobody can see.

## The change

Two new modules under `scripts/agent/eval/`, both free — no model is invoked and
nothing is spent.

- [x] **`store.mjs` — `EvalStore`**, the one surface an eval-data root is reached
      through. Corpus items are its own; `store.captures` **delegates to the
      merged `capture-store.mjs`** rooted at the same `captures/` subdirectory the
      collector writes to. `--root` is required, with no default anywhere.
- [x] **`extract-corpus.mjs`** — one PR → four files (`meta.json`, `diff.patch`,
      `changed-files.txt`, `issue-spec.md`) plus a per-version manifest. Pure
      decisions, with `gh` and `git` injected as one `io` object, so every rule is
      a unit test rather than an integration run.
- [x] **`README.md`** — the directory's entry point, carrying forward the fork
      harness's *"Known limits"* table (the valuable part of its `capabilities.md`),
      including the one this whole project exists to close: *the branch panel is
      what gets measured.*
- [x] **A re-extraction is a determinism check.** Freezing a PR that is already
      frozen does not overwrite and does not silently skip: it compares, and
      reports any difference as `DRIFT` with a non-zero exit and the stored bytes
      untouched.
- [x] **`scripts/verify-self.mjs`** — one line, and the reason it is in this PR is
      below.

### The `agent:tests` lane did not run anything in a subdirectory

The lane was `cd scripts/agent && node --test *.test.mjs` — a **flat shell glob**.
`scripts/agent/eval/*.test.mjs` matches nothing in it. Every test in this PR would
have been written, passed locally, and then never run again in CI, with a green
tick as the only evidence. PR 5 would have added `eval/adapters/reviewer.test.mjs`
into the same hole.

It is now `node --test '**/*.test.mjs'`, single-quoted so **node** expands the
pattern rather than `sh`. Both halves matter: node's globber skips `node_modules`
and `sh`'s does not, and the `deps` job runs `npm ci` inside `scripts/agent` — an
sh-expanded `**` would start running third-party test files.

`eval/test-lane.test.mjs` reads that lane back out of `verify-self.mjs` and
asserts every suite under `eval/`, at every depth, is matched by its glob. It
deliberately does not check that the lane *contains the string* `eval/`: a lane
covering `eval/*.test.mjs` but not `eval/adapters/` would pass a string check and
still skip a suite.

### The store: composed, not merged, and not duplicated

The brief allowed either extending `capture-store.mjs` in place or composing it,
and asked for the argument if the answer changed. **Composed**, on three grounds:

1. **Write-once means two different things.** `putCapture` treats an existing key
   as *success* (`"present"`) and that is correct for a capture: the key carries
   the producing run and attempt, so it names one execution of the panel and its
   bytes cannot legitimately differ. A corpus item is not like that. A second
   extraction *can* produce different bytes, and that case is the one that must
   not pass quietly — so `putCorpusItem` **throws**, and the extractor turns a
   re-run into a comparison.
2. **`capture-store.mjs` has a merged, tested, live consumer**, and one of its own
   tests pins its surface at exactly three methods. Widening it to serve a second
   data type would break that pin for a caller that could just as well hold it
   from outside.
3. **Its refusals say `capture store:`.** Those messages would be read by someone
   freezing a PR.

The cost of composing is one copied idiom: `writeFileAtomic` re-states
`putCapture`'s temp-file-and-rename, for its reason (a crash part-way through a
direct write leaves a **truncated** `diff.patch`, and a truncated diff replays
cleanly against the wrong input). Exporting a shared helper would have meant
editing a merged module to serve a caller it does not have. Six lines is the
cheaper of the two.

Only the **corpus slice** is ported. The fork's `store.mjs` has 34 methods over
runs, stage fixtures, scores and labels; PR 3 has one consumer and needs five
methods. Landing the other thirty would land thirty untested-in-anger surfaces for
nobody, which the audit's own closing warning is about.

### Transcripts: absence is expressed by there being no question to ask

The fork's store gzipped each replay's full model transcript into itself; spec §8
keeps transcripts **out of git** (10–30 MB of debugging aid no metric reads). So a
transcript is routinely absent, and the audit flagged this as *a fail-direction
question, not a refactor*. Decided:

- **There is no `getTranscript` on this surface, and that is the answer.** A method
  that returned `null` on every call in production would eventually be read as
  *"the model said nothing"* — a confusion this codebase has already shipped once
  (audit §4-E: missing panel output became "the panel found nothing"). You cannot
  misread a question you cannot ask.
- **When PR 5 records envelopes**, a transcript is referenced by a **pointer** (a
  local path, later an S3 key) carried in the envelope, and any reader must return
  a **named state** — `{state: "absent" | "local" | "remote"}` — never `null` and
  never `""`. *"We did not keep it"* and *"there was nothing to keep"* are
  different facts, and only the first is normal.

The decision is written into `store.mjs`'s header, where a PR 5 author will be
looking, and pinned by a test asserting no transcript method exists.

## Corrected while building

**1. `--out` became `--root`, and the CLI names the old flag.** #675's pattern.
A bare *"required"* on a flag that used to be called something else sends the
reader to the source, so a `--out` with no `--root` says so explicitly.

**2. Dropped `label_status` from `meta.json`.** The fork stamped
`label_status: "unlabeled"` into every item. A corpus item is write-once and a
label is human truth that arrives later and gets corrected — so the field is a lie
from the first label onward. The store already computes the status from `labels/`
at read time (the fork's own `labelStatus`, arriving with PR 16).

**3. Dropped the fallback to the merged PR's file list.** When the diff parsed to
no paths, the fork filled `changed_files` from `view.files`. That is the **merged**
PR's file set, so it includes files the fix loop touched after the review point — a
lens scoped off it would be shown files that do not exist in the diff beside it,
which is the same class of error as the size proxy below. A diff that parses to
zero paths is a broken extraction; the PR is now skipped, counted and reported.

**4. `scope` now describes the frozen diff.** The fork derived
`additions`/`deletions`/`scope` from the merged PR and its own README admitted the
consequence — a size proxy, on the one field every planned segmentation slices by
(spec §4). Counting the stored diff costs two regexes. The PR's own totals survive
as `pr_additions`/`pr_deletions`, because the gap between the two pairs is itself
interesting: it is how much the fix loop added after review.

**5. Added `diff_method` to `meta.json`, and made one of its values a refusal.**
The extractor has four ways to produce a diff and the fork logged a
`console.error` when it reached the worst one — `<commit>^...<commit>`, which holds
only the last commit's own change rather than the PR's cumulative diff. A log line
nobody reads and an item that replays cleanly against the wrong input is this
project's signature bug. The method is now recorded in the item, and the degraded
one is **refused** unless `--allow-degraded-diff` is passed.

**6. The manifest merges, and carries no timestamp.** The fork wrote the manifest
from only the current run's items, so `--prs 664` against a 20-item version reduced
the index to one entry while nineteen items sat on disk unreferenced — data present
and invisible. And `created: new Date().toISOString()` made two extractions of one
corpus differ in bytes, which makes the determinism check unrunnable on the file
that indexes everything. The eval repo is a git repo; it already records when each
version was written, with an author.

**7. The summary reports this run's item count *and* the version's.** They differ
whenever a PR is skipped or drifts, and printing only one makes a partial run read
as a shrinking corpus. Found while looking at the real drift run: it said
`1 item(s) in the manifest` about a manifest holding two.

**8. `contentSha256` lives in `store.mjs`, not in `config-hash.mjs`.** The fork's
extractor imported `contentHash` from the config-identity module, which is PR 4's
and which the audit found broken in three ways. Freezing a PR should not wait on
config identity landing. PR 4 should import this one rather than define a second:
two hash helpers with the same output format is how `sha256_diff` and a label's
`diff_sha256` come to be computed differently and compare unequal forever.

## Fail directions

| What fails | What happens | Why that is the safe way |
|---|---|---|
| `--root` omitted | usage error, exit 2, before any request | git history is permanent; a default inside this repo would commit data into `wafflebase` for good |
| One PR is unreachable / `gh` errors | counted skip, the batch continues, **exit 1** | one flaky PR must not cost the other nineteen — but a corpus with a hole in it must not exit green either |
| The diff comes from the `single-commit` fallback | refused and counted unless `--allow-degraded-diff`; the method is recorded either way | an item this thin is not a smaller version of the right input, it is a different one |
| A diff parses to zero paths | skipped, with the byte count in the message | a non-empty diff that names no files is a broken patch, not a small one |
| A re-extraction differs from the stored item | `DRIFT`, exit 1, **stored bytes untouched** | deciding which copy is right is a person's job; overwriting destroys the evidence |
| `meta.json` fails validation | the single write path refuses, nothing is written | an item whose own `sha256_diff` does not match its diff is worse than no item — PR 16's staleness check compares against that field |
| A write is interrupted | `meta.json` goes last, so the item reads as **absent** | absence is recoverable and is visible; a half-item that looks complete is neither |
| The item is absent | reads `null` | "not extracted yet" is the ordinary first-run state |
| The item is **present but unreadable** | throws | silently skipping it shrinks the corpus, and every proportion downstream then carries an `n` that was never measured |
| The root does not exist yet | `hasCorpusItem` false, `getCorpus` null, `listCorpusItems` `[]` | read paths degrade; a store nobody has written to yet is not a fault |

## Explicit non-goals

- **The runner (PR 5)** and **`config_hash` (PR 4)**. Neither is here. The
  extractor deliberately does not import `config-hash.mjs`.
- **Choosing the 20 corpus PRs.** The machinery is proved on two real ones; the
  stratified selection is prep for the paid run and is decided separately.
- **Committing corpus data into `wafflebase`.** This PR adds code only. The two
  items frozen during verification went to a throwaway directory.
- **Porting the fork's run / stage-fixture / score / label store methods.** Corpus
  slice only — five methods, not thirty-four.
- **Modifying `capture-store.mjs`.** Its behaviour and its three-method surface are
  untouched; its tests pass unmodified.
- **Adding a `getCapture`.** The first consumer of a capture *read* is PR 5's panel
  adapter. A method written before its consumer is an untested surface.
- **Restructuring `labels/`** in the eval repo. It is irreplaceable human work.
- **Any default `--root`, anywhere.**

## Verification

Baselines measured on the branch's own parent, **`82c7519d7`** (`upstream/main` at
the time of the commit), not carried from a document. It moved once mid-session —
the first baseline taken was `9c4842b35`, ten tests earlier — which is why every
number below was re-taken against the actual parent. Both skip-sensitive states are
stated, per the conventions: the **Agent SDK is absent** in every run below (1
skip), and the **root workspace install** is the second axis (`lint-config.test.mjs`
skips 5 cases without `eslint` at the root).

- [x] **`node --test "scripts/agent/*.test.mjs"`** — the flat glob, from the
      committed tree: **849 tests, 0 fail** (6 skipped with no root install, 1 with
      one). **Identical to the baseline, and that is the point**: this command
      cannot see `eval/` at all, which is why the lane was the bug.

      | Tree | no root install | root install |
      |---|---|---|
      | parent `82c7519d7` | 849 tests, 843 pass, 6 skipped | 849 tests, 848 pass, 1 skipped |
      | this branch | 849 tests, 843 pass, 6 skipped | 849 tests, 848 pass, 1 skipped |

- [x] **`cd scripts/agent && node --test '**/*.test.mjs'`** — what CI's
      `agent:tests` lane now runs, from the committed tree: **908 tests, 0 fail**
      (902 pass / 6 skipped with no root install; 907 pass / 1 skipped with one),
      against **849** at the parent under the lane's own (flat) command. **+59**:
      21 store, 36 extractor, 2 lane.
- [x] **`npx eslint scripts` exits 0**, with `eslint@9.24.0` installed to match the
      lockfile pin — verified on **both** trees, so the comparison is clean and no
      version drift is being read as a pass.
- [x] **Nothing outside the eight files changed.** `git diff --stat` against the
      parent: 8 files, +2785/−1, the single deletion being the lane line.
- [x] **`capture-store.test.mjs` passes unmodified** — 12 tests, 0 fail, and both
      `capture-store.mjs` and its test file hash **identically** to the parent
      (`c935df01d…`, `012529f0d…`). That is the proof the store was composed rather
      than churned.
- [x] **A real end-to-end extraction, free.** `#664` and `#673`, into a throwaway
      root, run from the committed tree:

      ```
      + pr-664 (4 files, +418/-1 L, issue_spec=false, @pr-open 61101a1b, fork-point)
      + pr-673 (6 files, +1128/-23 L, issue_spec=false, @pr-open f89b4630, fork-point)
      extract-corpus: froze 2 item(s) · 0 unchanged · 0 skipped ·
                      2 item(s) indexed this run · version now holds 2 item(s)
      ```

      Four files per item (three where the PR closes no issue, so there is no
      `issue-spec.md`), 120 KB total. Both `review_base` and `review_commit` are
      valid 40-hex shas — `35206e58…`/`61101a1b…` and `e5de00ae…`/`f89b4630…` — and
      each item's `sha256_diff` re-hashes its own `diff.patch` on disk.

- [x] **Determinism proven two ways, not assumed.**
      1. Re-extracting into the **same** root: `0 froze · 2 unchanged · 0 skipped`,
         exit 0 — the tool's own comparison found no difference.
      2. Extracting into a **fresh** root and comparing: `diff -r` exits **0**, and
         the per-file sha256 lists of the two roots are identical, `meta.json` and
         the manifest included. `diff.patch`'s own sha256 equals the
         `sha256_diff` recorded in `meta.json`.
      3. And across trees: the items produced by the committed tree are
         byte-identical to those produced by the working copy earlier, and the two
         manifests match once the version name is normalised.
- [x] **The drift detector, on real data.** One line appended to a stored
      `diff.patch`, then re-extract:

      ```
      DRIFT pr-664: re-extraction differs from the stored item in diff.patch,
                    stored sha256_diff vs stored diff.patch — NOT overwritten
      … DRIFT on 1 item(s) … EXIT=1
      ```

      The tampered bytes were still there afterwards, and the version's manifest
      still indexed both items.
- [x] **Round-trip:** an item written by the store reads back identically through
      `getCorpusItemInput` — `meta` deep-equal, `diff` byte-equal, changed files
      and issue spec equal.
- [x] **Every new test mutation-tested — 20 mutations, 20 red.** Each was applied,
      the suite run, the failure message read, and the file restored.

      | # | Mutation | First failing test / message |
      |---|---|---|
      | 1 | `--root` falls back to a default | *there is NO default root* — "EvalStore accepted undefined as a root" |
      | 2 | `putCorpusItem` overwrites | *putCorpusItem is WRITE-ONCE* — missing expected exception |
      | 3 | the `review_base` check is deleted | *review_base is REQUIRED…* + 2 more, incl. the extractor's store-refusal test |
      | 4 | `SHA40` loosened to any hex length | *…40 lowercase hex, not merely present* — "review_commit accepted "abc"" |
      | 5 | `sha256_diff` shape-checked but not recomputed | *sha256_diff is RECOMPUTED from the diff* |
      | 6 | `meta.json` written **first** | *meta.json is written LAST* — file order not `[…, meta.json]` |
      | 7 | `changed-files.txt` may disagree with `meta.changed_files` | *…every other way an item can be self-contradictory* |
      | 8 | an incomplete item reads as absent | *present-but-broken THROWS while absent returns null* |
      | 9 | `CAPTURES_SUBDIR` drifts | *the captures subdirectory agrees with the collector workflow* — ".capture-store/captures vs capture-store/" |
      | 10 | the `view.files` fallback returns | *the changed files come from the DIFF…* + the skip test |
      | 11 | `single-commit` no longer degraded | *a degraded single-commit diff is REFUSED by default* |
      | 12 | drift no longer reported | *an extraction that DIFFERS… is reported and refused* |
      | 13 | the manifest replaces instead of merging | *buildManifest MERGES…* — "merged and sorted by id" |
      | 14 | `created:` timestamp returns to the manifest | *a manifest carries no timestamp…* — "a clock reading here makes the determinism check unrunnable" |
      | 15 | `scope` from the merged PR again | *scope describes the FROZEN diff* + `manifestItem` |
      | 16 | `summarize` always exits 0 | 4 tests red, incl. drift, degraded, empty-diff, one-flaky-PR |
      | 17 | the CLI stops requiring `--root` | *the CLI refuses a missing --root…* |
      | 18 | atomic write becomes a direct write | *a `.part-` leftover…* — "no debris survives" |
      | 19 | the lane returns to a flat glob | *the agent:tests lane runs every test file under eval/* — "eval/extract-corpus.test.mjs … would never run in CI" |
      | 20 | `label_status` stamped into an item again | *buildItemMeta carries what a replay needs, and no label_status* |

      Two of the twenty first reported as *surviving* and were not: the `perl`
      substitution had failed to apply. They were re-run with exact-string edits.
      **M6 genuinely survived on the first pass** — the write ORDER was
      unobservable after the fact, so `itemFileBytes` is now exported for the sole
      purpose of making that decision assertable, and the test replays the
      interrupted-write state from the writer's own list.

- [x] **Verified from the committed tree** (`git archive <branch> | tar -x`), not
      the working copy.

## Not verified

- **`--limit` / `--state` against a live `gh pr list`.** The list path is exercised
  only through the injected `io`; every real extraction here used `--prs`.
- **`review_point: head`, `first` and `auto` end to end.** Their resolution is unit
  tested and `head`'s `gh pr diff` path is tested through `io`, but the two real
  extractions were both `pr-open` (the default).
- **A PR whose base branch has been deleted**, which is the case the `base-tip` and
  `single-commit` fallbacks exist for. Both are unit tested through `io`; neither
  has been reached against a real PR, because both PRs used for verification
  resolved cleanly to a fork point.
- **The size budget at scale.** Two items are 120 KB. Spec §8 measured 608 KB for
  twenty, which is consistent, but this PR froze two.
- **Anything about what the panel does with an item.** No replay exists yet; that
  is PR 5.
