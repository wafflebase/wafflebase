# Present a review finding for judgement without showing the reviewer's verdict

A **new** document rather than a section on an existing one. Every task doc under
`docs/tasks/active/` for `scripts/agent/eval/` so far describes something that measures
what a reviewer *produced*; this one describes the first thing that records whether any
of it is *true*, and the rule it establishes — **the presenter must not have the
reviewer's verdict, not merely decline to show it** — is not a refinement of any of
them.

## The problem

`scripts/agent/eval/` can now replay a frozen pull request through the review panel,
map both reviewers' findings into one record shape, and score volume, mix,
complementarity, reliability and cost. **Not one of those numbers is about whether a
finding is correct.** They cannot be: correctness needs an independent reading of the
diff, and nothing in the tree records one.

`labels/ANNOTATION-GUIDE.md` in the eval data repository defines what such a record
holds. Two problems with acting on it as written:

| | |
|---|---|
| **It names an API that does not exist.** The guide says labels are stamped by `putFindingLabel` and checked by `store.labelStatus()`. `grep` finds neither in `eval/store.mjs` — the only trace is a comment reading *"`labelStatus`'s drift check (PR 16)"*, naming a deliverable that was never built | So there is nowhere to put a label, and **no drift checker exists at all** |
| **Its finding record is one-armed.** §1.2 defines a finding label as truth about *"one specific finding **the panel** raised"* | Detection precision and the false-positive profile are computed per arm, so the other reviewer's findings need labels too and have no shape to go in |

And the failure mode is worse than "no data". The cheapest way to produce labels is to
show the reader what the panel concluded and ask them to agree, which produces a
precision figure that is **higher, publishable, and wrong**, with nothing downstream
able to detect it. A wrong finding record makes a scorer disagree with the panel's own
artifact and something goes red. A wrong *label* makes every validity metric agree with
itself.

## The change

Two new files, no existing file touched.

`scripts/agent/eval/labels.mjs` — the record: `SCHEMA_VERSION`, the frozen
`LABEL_SCHEMAS` / `LABEL_SOURCES` / `CONFIDENCE` / `STRATA` / `VERDICT_LABELS` /
`ADJUDICATION_MODES` / `SUGGESTION_OUTCOMES` / `KEY_BASES` /
`BLINDED_FROM_ADJUDICATION` vocabularies, `buildFindingLabel`, `buildItemLabel`,
`validateLabel`, `labelPathFor`, `armKeyOf` and `labelCensus`. Same shape as
`finding-record.mjs`: builder and validator as two expressions of one schema, so an
edit to either has to survive the other. Severity is `severity.mjs`'s `KNOWN`, imported
rather than restated, and the item-level verdict rule is `BLOCKING` — the gate's own
definition of what stops a merge is the one a `verdict_label` has to agree with.

`scripts/agent/eval/adjudicate.mjs` — the CLI: an allowlist projection, a triage queue,
a blinded presentation, resumability, and one write path that refuses on any doubt.
`--root` is required with no default, and it writes nothing without `--write`.

### The blinding is structural, not a convention

`admitRecord` projects a finding record onto **nine named fields** and drops everything
else. The panel's `severity`, `severity_raw`, `gating`, `gating_basis`, `panel.lane`,
`panel.verification` and `panel.unsettled` are not withheld later in the pipeline —
**they never enter it.** Nothing downstream can print what nothing downstream has.

An allowlist rather than a denylist, for one reason: a denylist has to be updated by
whoever adds the next field to a record, and they will not know to. The test constructs
a record carrying all four forbidden signals **plus an invented `cross_arm_agreement`
field no PR has added yet**, and asserts none of them survives into the card, the
payload or the rendered text.

`labels.mjs` then shuts a second door: `adjudication.presented_fields` is a required
field, and a label whose own record admits the panel's severity was on screen is
**refused at write time**. Two doors on one failure, because lesson 7 of this project is
that a validator only guards the door it stands in.

### ⚠ This file deliberately NARROWS, against the house convention

The adapters widen and never narrow — copy the whole finding, add fields — and that
convention exists because four sites lost annotations by rebuilding a finding from a
field list. This projection breaks it **on purpose**: the adapter convention protects
the road to a *scorer*, where a lost field is a lost fact; this projection is the road
to a *human*, where a carried field is the circularity above. Nothing is lost — the
whole record stays in the store, and the label joins back onto it by `finding_key`.

### 🔴 The plan's sizing was wrong, and it changes the design rather than the schedule

The handoff's premise: ~245 panel defect classes + 30 CodeRabbit findings ≈ **275
judgements taken once**, because `findingKey` is `(file, summary)` so "the same defect
found in k1 and k3 carries one key and one label". It said to verify that before
designing the queue. **Measured over the pilot's three replicates, 428 stored panel
records:**

```
distinct finding_key across all three replicates   426
  in all three                                       0
  in exactly two                                     2
  in exactly one                                   424
records per key                                  1.005
```

**Exact identity essentially never repeats.** The panel rewords the same defect on every
try, and `findingKey` lowercases and trims but does not match — it is identity, not
similarity, and its docblock says so. So labelling per key is **426 + 30 = 456**
judgements, not 275.

The reuse is real but it lives one unit up. `groupFindings` collapses the same 428
records into **245 defect classes** — 118 in one replicate, 71 in two, 56 in all three,
the same partition #782 published — and **127 of those 245 contain more than one
distinct key.** So the 275 figure is reachable, but only under a design that makes
bundling the queue's unit rather than an optimisation:

| the unit a judgement is made in | judgements for the pilot's panel arm |
|---|---|
| one per stored record | 428 |
| one per `finding_key` | 426 |
| **one per defect class** | **245** |

The label stays keyed on `finding_key` — that is what a scorer joins on, with no fuzzy
matching — and one judgement writes one label per member key, each carrying `class_id`
and `class_members`. **`labelCensus` reports `readings` beside `n`** for the reason the
census exists at all: 428 labels from 245 readings is not 428 independent judgements,
and a later inter-annotator pass that assumed otherwise would overstate its own
ceiling.

This is decision 28 — *name the unit* — arriving again. "245" is a **class** count and
"426" is a **key** count, and the handoff quoted the first as though it were the second.

### Bundles never span arms, and that is a blinding property

A bundle holding one panel claim and one CodeRabbit claim would tell the reader **the
other arm agreed** — the shared-hallucination prior, and the one that looks most like
evidence. So cards are partitioned by arm *before* grouping and the result is
**asserted**, because "we passed them in separately" is a fact about this code while the
assertion is a fact about the output. The test feeds identical file, line and summary
from both arms — a pair the matcher would merge instantly — and requires two bundles.

### Triage, and what it is forbidden to sort by

| order | policy | measured on the pilot |
|---|---|---|
| `coverage` (default) | most records settled per judgement first | the first 20 judgements cover **60** records |
| `locality` | item → file → line: the dominant cost is reading the diff, not typing | 41 |
| `none` | no prior; the honest baseline | 33 |

`REFUSED_ORDERS` names five that are refused with the leak each would produce —
`severity`, `gating`, `lane`, `verifier`, `agreement`. They are unreachable anyway,
because a card has no severity to sort by; the map exists at the place someone would
come to add one, since the next person to want *"blocking findings first"* will have a
good argument and no way to see the cost.

### There is no pre-fill, and that is a decision

The plan allowed "pre-fill where both arms agree" as a triage prior. **The only prior
available today is cross-arm agreement, and showing it is exactly what the blinding
forbids** — so this CLI offers none, and every label it writes records
`suggestion_outcome: "not-shown"`. The schema still carries the field and its refusals
(`gold` requires `mode: "human"` and rejects `accepted-unreviewed`), so that a future
prior arrives as a suggestion a human confirms rather than as a label.

### The drift guard is this validator, because there is no other

Guide §8 wants the item's current `sha256_diff` stamped into `diff_sha256` and expects
`store.labelStatus()` to report `stale` on a mismatch. With no such function,
`validateLabel` **refuses** a mismatch — at write time, which is earlier and louder than
reporting it at read time — and refuses a label with no stamp at all, since a label that
was never stamped can never be checked. `writeLabels` re-checks against the item's
`meta.json` as read at write time, so a diff re-extracted between the reading and the
write is caught rather than stored.

### Two arms, two key spaces

`findingKey` says nothing about who raised the claim, so both arms can produce one key
for one wording. A single file for both would carry an `arm` field that is wrong for one
of them, and per-arm precision would read one arm's judgement as the other's. So the
path gains an `<arm>` segment — `labels/<cv>/findings/<item>/<arm>/<sha256(key)>.json` —
and the resume check is arm-qualified through `armKeyOf`. **This is an addition to the
guide's layout**, of the same kind as `arm` on the record.

## Corrected while building

**1. The plan's 275 was a class count quoted as a key count.** Above. It changed the
design: bundling is the mechanism, not a nicety, and the CLI takes every replicate in
one invocation because a class only spans replicates when they are grouped together
(k1 alone gives 142 classes for 142 records; k1+k2+k3 give 245 for 428).

**2. 🔴 I reproduced this project's signature failure inside the queue, and it printed a
plausible number.** The first draft renamed the card's fields to `claim` and `detail`,
which read better on screen. `findingSimilarity` reads `summary` and `evidence` **by
name**; with neither present every pair scored no tokens, `groupFindings`' never-merge-
on-no-evidence rule rejected all of them, and the queue came out at **428 classes for
428 records**. Nothing threw. 428 is exactly what an honest queue over 428 unique
defects would print. It was caught by comparing against the 245 measured independently
minutes earlier — not by any test. The fix is `MATCHER_OPERAND_FIELDS`, a named list of
the four fields the matcher reads, plus a test that requires two wordings of one defect
to **merge**, which is what goes red if they drift again.

**3. The severity prompt silently resolved `m` to `major`.** `vocabulary.find((v) => v[0] === raw)` stops at the first hit and `major` precedes `minor` in `KNOWN`. A mistyped
severity is a wrong label that the gate's own rule then reads. An abbreviation is now
accepted only when it is unambiguous, and an ambiguous one re-asks naming the
candidates.

**4. `arrival` was neither input order nor correctly named.** `groupFindings` sorts its
own groups by `(item, id)` (`finding-match.mjs:967`), so the bundle list arrives
content-ordered before any comparator here runs. The test asserting that a reversed
input reversed the queue failed, which is how this surfaced. Renamed to `none` — *no
prior* — and the real property is better than the claimed one: **every order this module
offers is independent of input order.**

**5. The `byId` tiebreak is unreachable, and it stays.** Deleting it changes no output,
for the reason in 4. It is kept so totality is a property of this module rather than one
inherited from another module's internal sort — inheriting it is how the queue starts
renumbering itself the day that sort is refactored. Reported as an ineffective mutation
rather than hidden or removed.

**7. Four defects found in review, all fixed here.** Each was verified against the code
before being acted on, and one of them turned out to be a different defect from the one
first diagnosed:

- **`fileDiffSection` matched a path by substring**, so asking for `a.ts` returned the
  section for `data.ts`. For this tool that is not cosmetic — it shows the reader code
  the claim is not about, and the whole point of the `d` command is reading the right
  code. Both header paths are now compared whole, which also makes a rename resolve from
  either side; a C-quoted header no longer matches and falls back to "open `diff.patch`",
  the safe direction.
- **A mistyped line range was silently dropped.** `12`, `40..52` and `52-40` all failed
  the pattern and were filed as `line_range: null` — the same record a *blank* answer
  produces, and guide §4.2 treats "not line-localizable" as a real statement. So a typed
  location became an affirmative claim that there wasn't one. Now re-asked until it
  parses, with the reversed range refused too.
- **A label file that parsed but carried no `finding_key`/`arm`** was counted in `labels`
  and left out of `keys`: it settled nothing, so the bundle returned, the reader answered
  it again, and the write path then refused because a file already existed there — a dead
  end with no line saying why. It now joins the truncated-JSON case in `unreadable`.
- **`--annotator` was required only with `--write`.** But `--write` is off by default, so
  the ordinary first invocation is a preview, and a preview with no annotator built
  `annotators: []` — which `validateLabel` refuses per judgement, caught and printed. The
  session asked every question in the queue and discarded every answer. Now required for
  any session that will ask something; `--json` is exempt because it prints and returns.

**8. The test helper's cleanup ran too early, and the first diagnosis of the cost was
wrong.** `withRoot` was synchronous, so `rmSync` fired the moment an async callback hit
its first `await`. The obvious conclusion — that "assert nothing was written" was passing
because the root was gone — is **false, and measuring it is what showed that**:
`writeFileAtomic` calls `mkdirSync(recursive)`, so a stray write recreates the tree and
`existsSync` still catches it (forced a write in preview mode; the test goes red under
both versions). The real cost is **3 leaked temp directories per run, with label files in
them**, against 0 once it awaits.

**6. The pair content hash does not escape the CodeRabbit key churn.** The handoff
offered it as an alternative to `finding_key` for CodeRabbit labels. `inspect-maybes.mjs`'s
`pairKey` hashes `file|line|summary` of **both** sides, so it has the same summary
dependence — which is why the pair labels already carry `pair_key_at_801` and
`pair_key_moved`. And a provenance key is not available either: `comment_id` is `null`
for every review-body finding (`adapters/coderabbit.mjs:631`), which is 14 of the
pilot's 30. So one key space is kept and the churn is made **detectable**:
`parser_vintage` is required on a CodeRabbit label and refused as absent, exactly as
`diff_sha256` is.

## Fail directions

| Part | On failure | Why that is the safe direction |
|---|---|---|
| `admitRecord` | throws on a non-record | The caller is wrong, and it is cheap to say so at the boundary. Batch degradation is `buildQueue`'s job |
| `buildQueue` | degrades to fewer bundles, `dropped` names each with its index and reason | A read path. A skip that shrinks the queue silently reads downstream as "we judged everything" |
| a bundle spanning arms | **refuses** | It would carry the one prior the queue must not carry. Unreachable by construction and asserted anyway |
| a stale `diff_sha256` | **refuses**, nothing written | A label written against a diff that no longer exists scores the wrong code, silently |
| an unstampable item (never frozen) | **refuses** | A label with no drift stamp can never be checked later, and write time is the only moment the stamp is obtainable |
| an empty-summary `finding_key` | **refuses** | `file::` is the same key for every empty-summary finding in that file; one label would overwrite another |
| an existing label | **refuses** without `--relabel` | Re-adjudication is required by guide §8, but never as a side effect of a resumed session |
| a judgement the schema refuses | printed, not written, session continues | The reader keeps their place; nothing partial reaches disk |
| a partially written bundle | asked again | Re-asking costs one question; skipping leaves a member key with no label that nothing revisits |
| an unreadable label on disk | counted in `unreadable`, never treated as absent | Treating it as absent re-asks a judgement and then overwrites the only evidence of the first answer |
| `harvest.mjs` unreadable | `harvestVintage` → `null`, and the CodeRabbit write path then refuses | A label whose parser vintage is unknown cannot be told from a current one, which is the whole point of the field |
| no `--write` | builds every label, writes none | A tool whose first invocation writes to a data repository gets invoked once by accident |

## Explicit non-goals

- **No metric.** No precision, no recall, no agreement, no confusion matrix. A scorer
  over labels is a later change and must not be written before labels exist.
- **No label.** This is code. Not one judgement is produced here, and there is no code
  path that invents an annotator.
- **`store.mjs` is not touched** — no `putFindingLabel`, no `labelStatus`. The guide
  names them; PR 16 was to build them; they are not this change's to add, and the
  schema lives in its own module on `finding-record.mjs`'s precedent.
- **No item label derived from finding labels.** `true_defects[]` must include defects
  no reviewer found — that is what recall is measured against — and a set built from
  findings cannot contain a miss. It is typed in.
- **No pair verdicts.** `labels/<cv>/pairs/` is a third label type owned elsewhere;
  nothing here reads or writes it.
- **`label_source: "distant"`** is a schema value the CLI cannot produce: it means a
  label inferred from a natural experiment with no per-item reading, and this tool's
  only mode is reading.
- **`eval/README.md` gets no row.** It is the one file every scorer PR would want to
  edit, and this batch's clean property is that no two open pull requests touch one
  file.
- **The retired `labels/2026-07-28-pilot/`** is neither read, rewritten nor migrated.
  Its eleven hand-written labels carry no `schema_version` and this validator refuses
  them, which is correct: their `diff_sha256` refers to a diff nobody can produce.

## Verification

Measured on `5326723969d8d0011ee01308525179d27e81d8f8`, base and branch trees extracted
separately with the same `node_modules` symlinked into both, each measured once.

- [x] **`agent:tests`, two invocations, the way the lane runs them**

```
                       rest    iso   total
upstream/main          1700  +  56  = 1756      0 fail · 1 skip
this branch            1768  +  56  = 1824      0 fail · 1 skip
                       ————————————————————
                                       +68
```

  `+68` is exactly this change's test count (32 in `labels.test.mjs`, 36 in
  `adjudicate.test.mjs`). The single skip is the Agent SDK case and is present in both
  trees, so it is not an environment artefact.

- [x] **`npx eslint scripts` exits 0** on both trees (`eslint@9.24.0`, the version the
      lockfile pins).

- [x] **68 mutations · 67 caught by the test that NAMES the guard · 1 ineffective.**
      Matched by test name rather than by the suite reddening, so a mutation caught by
      an unrelated test does not count as coverage. Four mutations were **ineffective
      rather than uncaught**, each proved before being replaced or documented — the
      fourth was `sections.filter(() => true)`, an identity transform and therefore no
      mutation at all, replaced by one that returns every section regardless of the file
      asked for:

  | | Mutation | Why it changed no behaviour |
  |---|---|---|
  | 1 | blank the builder's `is_real` boolean check | The validator states the same guard, with the same message — deliberately. Replaced by a mutation that shuts both doors, which is caught |
  | 2 | return `write([])` from the item session's refusal path | Writing an empty list writes nothing. Replaced by one that returns a label from the refusal path, which is caught |
  | 3 | delete the `byId` tiebreak from the `coverage` comparator | The bundle list already arrives `(item, id)`-ordered from `finding-match.mjs:967`. Kept and documented rather than removed — see *Corrected while building* 5 |

- [x] **Exercised end to end against the real pilot store, read-only, writing nothing:**

```
$ node eval/adjudicate.mjs --root <store> --corpus-version 2026-08-10-pilot-reviewed \
      --run pilot-01__k1,pilot-01__k2,pilot-01__k3 --limit 2 --json
428 record(s) in · 428 admitted · 0 dropped
245 defect class(es) · 0 already labelled · 245 pending
queued 2, covering 6 record(s) · 243 held back by --limit
order coverage · preview — nothing will be written
```

  245 reproduces #782's published partition (118 · 71 · 56 by replicate span) from a
  completely separate path, which is the check that the blinded projection did not
  change what the matcher sees.

- [x] **The test suite writes nothing to the real store, and leaves nothing behind.**
      Every filesystem test runs inside a fresh `mkdtempSync` root and removes it; the
      only path outside it that any test reads is `harvest.mjs`, for its content hash.
      Counted directly after a run: **0 `eval-adjudicate-test-*` directories left in
      `os.tmpdir()`**, against 3 before the helper awaited.

- [ ] **Not verified: the atomic-write property.** `writeFileAtomic` writes to a
      `.part-<pid>` file and renames, so a destination is only ever absent or complete.
      Reproducing a crash between the two is not something a `node --test` case can do
      honestly, so it is asserted by construction and by being the third copy of a
      pattern `capture-store.mjs` and `store.mjs` already carry.

- [ ] **Not verified: that the blinding holds for prose.** The word scan proves the four
      signals of a constructed record do not survive the projection. It cannot prove
      that a reviewer's own evidence text never contains the word "major" — and that
      would be the reviewer's word rather than a leak. The structural guarantee is the
      allowlist; the scan is a check on top of it.

- [ ] **Not verified: any label.** No judgement is produced by this change, so the
      schema is exercised only against constructed records and the real store's
      `meta.json`. The first real labels will be written by a human session using this
      tool.
