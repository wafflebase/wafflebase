# Record how spread out a frozen diff is, in `meta.json`

A **new** document rather than a section appended to
`20260805-eval-corpus-skeleton-todo.md`, which owns the extractor. The change to
the extractor is four lines; what needs to be findable later is the rule those
four lines establish — **a derived field joins the drift comparison in the commit
that adds it** — and that rule is about `corpusItemDrift`, not about the corpus
skeleton. Folding it into the skeleton doc would file a general rule under one
subsystem's history.

## The problem

`meta.json` records **how big** a change is (`additions` / `deletions` / `scope`)
and **which paths** it touched (`changed_files`). Between them they cannot express
**how spread out** it is. A 400-line change in one file and a 400-line change
across nine modules are different review problems at identical `scope`, and the
distinction is not recoverable from what is stored: `changed_files` can count
files, but hunk counts are not in a path list, so `single_hunk` cannot be
reconstructed by any reader after the fact.

The pipeline already has the rule — `localizationFromDiff` in `classify.mjs`,
pure, exported, no model and no I/O, used by the labelling pass. The corpus
simply was not recording its answer.

### Why it lands before the pilot corpus is frozen, not after

A corpus item is **write-once**. The pilot corpus is six PRs and is about to be
frozen; a field missing from `buildItemMeta` at that moment is missing from those
six items permanently.

**And nothing would say so.** `corpusItemDrift` compares a fixed field list —
`review_commit`, `review_base`, `review_point`, `diff_method`, `changed_files`,
`sha256_diff`, the diff bytes, the issue spec. **A field outside that list cannot
drift.** So adding one later and re-extracting prints `= unchanged`, re-indexes
`manifestItem(stored.meta)` — which spreads the same absence into the manifest as
a dropped key, because `JSON.stringify` omits `undefined` — and never rewrites.
Six items would lack the field forever with every tool green. That is the whole
reason this is its own PR rather than a footnote in a later one.

## The change

- [x] **`buildItemMeta` records `localization_scope`**, from the **frozen** diff,
      by importing `localizationFromDiff` — following the precedent set one line
      above it by `scopeSize`. Not reimplemented: a second spread rule in the
      corpus that drifts from the labelling pipeline's is worse than no field.
      All five values are recorded, `unknown` included.
- [x] **It joins `corpusItemDrift`'s comparison list.** Reasoning below.
- [x] **It joins `manifestItem`**, beside `scope`.
- [x] **The `+` line prints it**, which is what `--dry-run` shows.
- [x] **`eval/README.md`** documents the field and the derived-field rule.
- [x] **`localizationFromDiff` reads the `diff --git` header**, so deletions and
      pure renames count as files. Added after review; the reasoning and the wrong
      values it replaces are under *Corrected while building*. `buildItemMeta` is
      unchanged by it — the corrected value arrives through the same call.

### The decision: a derived field belongs in the drift list

The argument against is real. `localization_scope` is a pure function of the
diff; the diff is already compared byte-for-byte **and** by `sha256_diff`. If the
bytes are identical the value is identical, so the check looks redundant.

It is not, and the reason generalises: **the bytes prove the input is stable and
say nothing about the derivation.** Two states are invisible to every other entry
in the list.

1. **The derivation changes.** `localizationFromDiff` lives in `classify.mjs`,
   maintained for the labelling pipeline by someone who need never have heard of
   the corpus. Change what counts as a module, or how hunks are counted, and a
   re-extraction produces a different value from identical bytes. The diff
   matches, the hash matches, only the meaning moved.
2. **The field is younger than the item.** `undefined` against a real value is
   drift, so an item frozen before the field existed is *reported and refused*
   rather than silently re-indexed without it. This is the same trap as the
   section above, seen from the other side — and it is the one that reopens for
   every derived field anyone adds after a freeze.

So the rule, written to cover the next field and not just this one: **a derived
field goes into `corpusItemDrift` in the same commit that adds it to
`buildItemMeta`.** Not because its value is expected to move, but because the
drift list is the only place a *change in meaning* is observable at all — and
because a field added later, outside the list, makes the one run that could have
noticed print `= unchanged`.

`additions` / `deletions` / `scope` are the same class of field and are **not** in
the list yet. That is a gap, not a distinction, and it is named in the code and
the README so their absence is not read as an argument. It is left for its own
change: those three are compared by existing tests that assert exact drift
arrays, and the fix is a wider edit than this field.

### The two smaller decisions

- **`manifestItem`: yes.** "Compare the panel on small single-hunk items against
  small cross-module ones" is one query and it is answerable off the manifest
  alone. `scope` is already there for exactly this reason; without the pair, the
  same segmentation means opening every item's `meta.json` to re-read a value
  already computed.
- **`--dry-run` printing: yes, on the `+` line only.** That line is the one place
  a human sees a derived field **while the item can still be refused**. The
  `= unchanged` line reports an item that is already immutable, and the drift list
  is what guards that path — printing it there would widen the output without
  adding a decision.

## Corrected while building

- **The plan assumed the field could not be tested against the merged PR's file
  list.** It can, and the mutation confirmed it: the `VIEW` fixture's `files` spans
  two modules (`scripts/agent/x.mjs` and a root-level `docs/…` path) while its
  frozen `DIFF` touches one file, so deriving from `view.files` yields
  `cross_module` where the frozen diff yields `single_hunk`. The test asserts that gap explicitly rather than relying
  on the value happening to differ.
- **`unknown` had more causes than the plan knew, and one of them was not `unknown`
  at all.** Both found by reading `+++ b/` against what a real diff contains, after
  review raised it on PR 687.
  - **SUPERSEDED — deletions and renames.** The first version of this document
    listed the C-quote gap and left the helper alone, because editing
    `classify.mjs` was an explicit non-goal. That was wrong on the facts: a
    deletion's path appears only on the `diff --git` header (`+++` says
    `/dev/null`) and a pure rename has no `+++` line at all, so **a deletion-only
    diff froze as `unknown` however many modules it spanned** — and worse, a diff
    of one modified file plus one deletion in another module counted the deleted
    file's `@@` but not the file, answering **`single_file`**: two modules recorded
    as one file, plausible and wrong, on a write-once item. The non-goal is
    reversed and `localizationFromDiff` now reads the header too, which is a strict
    improvement for the labelling pipeline as well. See the `localization_scope`
    row in `scripts/agent/eval/README.md` for the contract this leaves.
  - **NOT a defect — renamed files being double-counted**, also raised in review.
    Checked both parsers: a rename names its `b/` path on the header *and* on the
    `+++` line, `files` is a `Set` and `changedFilesFromDiff` collects into one
    too, so it is one path either way. Asserted rather than argued, in both test
    files.
  - **Still open — C-quoted paths.** `changedFilesFromDiff` decodes git's
    `+++ "b/na\303\257ve.ts"` form and `localizationFromDiff` matches literal
    prefixes, so a diff whose paths are **all** quoted freezes with a populated
    `changed_files` and `localization_scope: "unknown"` — an item the extractor
    does **not** skip, since its no-changed-files guard reads the other parser.
    Left as is on purpose: the C-unquoter is private to `extract-corpus.mjs`, and
    copying it into `classify.mjs` would fork the path parser whose divergence
    caused the deletion bug above. It is the one remaining cause of `unknown`, it
    is pinned by a test, and the README says so.
- **The axis is nearly constant on this repository's PRs.** Measured over the 20
  most recent merged PRs at `--review-point pr-open`: **18 `cross_module`, 2
  `multi_file`, 0 `single_hunk`, 0 `single_file`, 0 `unknown`** (n=20). The cause
  is structural — house convention puts a task doc under `docs/` in every PR, so
  almost every change crosses a module boundary by construction, whatever the code
  change looks like. The field is still worth freezing (it is free, and the item is
  write-once) but **it will not separate this population**, and any segmentation
  plan that leans on it needs that number first. A useful version of the axis would
  have to discount documentation-only paths, which is a rule change in
  `classify.mjs` and not this change.

## Fail directions

| When | What happens | Why that is the safe direction |
|---|---|---|
| The diff names no parseable path | `"unknown"`, a named value, never `undefined` or `""` | Absence must not be spellable as falsy. `extractCorpus` skips such a PR as `no-changed-files` anyway, but `buildItemMeta` runs before that check |
| `localizationFromDiff` changes upstream | re-extraction reports `DRIFT meta.localization_scope`, stored bytes untouched, exit 1 | The stored item is never overwritten on doubt; which copy is right is a person's decision |
| An item was frozen before this field existed | same DRIFT report, and it refuses | Loud and refusing beats `= unchanged` with a permanent hole |
| `classify.mjs` becomes unimportable | `extract-corpus.mjs` fails at import, before any PR is touched | It already imports `metrics.mjs`, which `classify.mjs` also imports; a broken module graph must not be discovered halfway through a freeze |

## Explicit non-goals

- **`type:` / `bugclass:` in `meta.json`.** Those are model judgements: they cost
  money, they are not reproducible byte-for-byte, and they get corrected. They
  belong in the label record, which arrives later and may be revised. Putting a
  bill inside a freezer whose headline property is that it costs nothing also
  breaks byte-identical re-extraction.
- **Any change to `classify.mjs` beyond the deletion/rename path fix** — in
  particular the C-quoted-path gap, and the labelling stages that call the helper.
  (Editing the file at all was a non-goal in the first version of this document;
  see *Corrected while building* for why that was reversed.)
- **Changing any other `meta.json` field, or `scopeSize`'s buckets.**
- **Adding `additions`/`deletions`/`scope` to the drift list** (named as a gap
  above).
- **Freezing any corpus item, or writing to the eval repo.** Nothing here writes
  outside `wafflebase`; the only runs against real PRs were `--dry-run`.

## Verification

- [x] **The lane's own command**, `cd scripts/agent && node --test '**/*.test.mjs'`,
      with **no `node_modules` anywhere**: **1297 tests, 1291 pass, 0 fail, 6
      skipped** — against a baseline measured the same way on the branch as it
      stood before the review fix (`57f738cb9`, which is this branch with `main`
      merged in): **1294 / 1288 / 0 fail / 6 skipped**. Delta **+3 tests**. The 6
      skips are the two documented causes together (1 Agent SDK, 5
      `lint-config.test.mjs` cases needing a root `eslint`).
      *(The first version of this change measured 1122 / 1116 / 0 / 6 against
      `upstream/main` at `f2aabace6`, delta +4. The absolute numbers moved because
      `main` gained the replay runner in the meantime, not because anything here
      regressed.)*
- [x] `npx eslint scripts` → exit 0, with the lockfile-pinned `eslint@9.24.0`.
- [x] **A test per return value, all five**, driven through `buildItemMeta` rather
      than by calling the helper (`classify.test.mjs` already tests the helper;
      what was untested is that the value reaches `meta.json`). Plus the two-path-
      segment module rule, the store round-trip off disk, and the manifest entry.
- [x] **Mutation-tested**, three ways, each against
      `node --test eval/extract-corpus.test.mjs` (41 tests):
      - *drop the field from `buildItemMeta`* → **8 fail**, first message
        `Expected values to be strictly equal: actual: undefined, expected:
        'single_hunk'`.
      - *return the constant `"single_hunk"`* → **3 fail**, `actual:
        'single_hunk', expected: 'single_file'` (and `expected: 'unknown'`). Note
        that only the five-value test and the drift test catch this one — the
        frozen-diff test asserts `single_hunk`, which the constant also satisfies.
      - *derive from the merged PR's file list* (`view.files`) instead of the
        frozen diff → **7 fail**, `actual: 'cross_module', expected:
        'single_hunk'`. The tests **can** tell those two apart.
- [x] **Deletions, renames and the mixed case**, added after review: three cases at
      the helper (`classify.test.mjs`) and two through `buildItemMeta`
      (`extract-corpus.test.mjs`). Before the fix, measured on the branch as
      pushed: a deletion-only diff spanning two modules → `unknown`; one modified
      file plus one deletion in another module → **`single_file`**. Both →
      `cross_module` now. The rename claim from the same review was checked and is
      not a defect: `changed_files` = 1 path and `single_hunk` with or without a
      content change, asserted in both files.
- [x] **The distribution did not move**, which is worth stating because the fix
      changes values in principle. Re-run over the **same** 20 PRs as the original
      measurement (`--prs 683,…,657`, `--review-point pr-open`): **18
      `cross_module`, 2 `multi_file`** — identical. So this fix corrects no real
      item in that sample; the defect was demonstrated on constructed diffs, and it
      matters for populations that delete files. (A run of "the 20 most recent
      merged" now reports 19/1, because that set has moved on — not a fix effect,
      and the reason the comparison uses an explicit PR list.)
- [x] **`--dry-run` against real PRs**, nothing written:
      `+ pr-664 (4 files, +418/-1 L, cross_module, …)` and
      `+ pr-683 (3 files, +133/-2 M, cross_module, …)`. Both plausible on
      inspection — 664 spans `.github/workflows`, `docs/tasks`, `scripts/agent`;
      683 spans `docs/design`, `scripts/agent`.
- [x] Verified from the **committed tree** (`git archive <branch> | tar -x`), not
      the working copy.
- [ ] **Not verified: a real re-extraction reporting `DRIFT
      meta.localization_scope`.** Nothing is frozen yet — the eval repo holds only
      `captures/` and `labels/` — so the pre-existing-item case exists only as a
      unit test that deletes the field from a stored `meta`. It becomes checkable
      the first time a frozen item is re-extracted.
