# CodeRabbit's comments as finding records, and which snapshot each one is about

A **new** document rather than a section appended to
`20260807-eval-finding-record-todo.md`, which owns the record, or to
`20260807-coderabbit-parser-widening-todo.md`, which owns the parser. What needs
to be findable later is neither of those: it is the **item-scoping rule** — which
of CodeRabbit's findings count as being about the pull request our panel replayed,
and the measurement that decided it. That question outlives both modules and every
comparison built on top of them reads its answer.

## The problem

**A parser's output is not a comparable finding.** `harvest.mjs` reads
CodeRabbit's two endpoints and returns what CodeRabbit wrote, in CodeRabbit's own
vocabulary. `eval/finding-record.mjs` defines the one shape both reviewers map
into, and `adapters/panel.mjs` fills our side. The other side was an empty
`ARM_ONLY_FIELDS.coderabbit` and nothing else, so the two reviewers still could
not be read side by side.

Three things stood between the parser and the record, and only the first is
plumbing.

**1. The severity vocabularies do not line up, and the record's validator throws.**
`validateFindingRecord` refuses a `severity` outside `KNOWN`
(`critical | major | minor | nit`), with a message saying a foreign vocabulary is
translated at the arm boundary. CodeRabbit's scale has `trivial`, and — measured
below — **a third of its findings state no severity at all.**

**2. The two arms did not read the same bytes, and nothing said so.** Our arm
replays a pull request **as it was opened**: all seven pilot items are frozen at
`review_point: pr-open` and the panel sees exactly that diff. CodeRabbit reviewed
whichever commit it got to. So "every CodeRabbit comment on PR #471" and "what our
panel was shown" are different questions, and a record that cannot tell them apart
hands the comparison an input mismatch with no symptom.

**3. `finding_key` is `file::lowercased-summary`, so what goes in `file` and
`summary` decides whether a cross-arm matcher can ever match anything.**

## The measurement that decided everything

Taken **before** any rule was argued, using the real parser at `1f9ee8864` over the
seven frozen pilot items. Denominators first, because a count without one is the
defect this whole series keeps finding:

| | n |
|---|---|
| inline review comments on the 7 items | 28 |
| …by CodeRabbit | 22 |
| …that parse as findings (6 are threaded replies) | **16** |
| reviews on the 7 items | 22 |
| …by CodeRabbit, carrying a body | 7 |
| review-body findings parsed / declared by CodeRabbit's own section titles | **14 / 14 (100.0%)** |
| **total** | **30** |

That 30 matches the corpus-selection record's independent count for the pilot.

### Where those 30 sit relative to the frozen snapshot

| Item | commits | `review_commit` at | in | after | unplaceable |
|---|---|---|---|---|---|
| pr-415 | 1 | idx 0 | 0 | 0 | **3** |
| pr-429 | 5 | idx 1 | 0 | 7 | 0 |
| pr-465 | 4 | idx 0 | 0 | 6 | 0 |
| pr-471 | 3 | idx 0 | **2** | 0 | 0 |
| pr-524 | 2 | idx 0 | **1** | 0 | 0 |
| pr-549 | 2 | idx 0 | 0 | 5 | 0 |
| pr-605 | 5 | idx 0 | 0 | 6 | 0 |
| **total, n=30** | | | **3 (10.0%)** | **24 (80.0%)** | **3 (10.0%)** |

**10 / 80 / 10.** The handoff framed this as "95/5 is a footnote, 60/40 is the
headline caveat". It is neither: a strict in-window rule would leave the CodeRabbit
arm with **three findings across the whole pilot** and **zero on five of the seven
items.**

### And the reason is not the one anyone expected

The premise was that CodeRabbit gets extra bites — "at open, and again after every
push, including the pushes that addressed its own earlier comments." **That does
not happen on any of the seven items.** Every one has exactly **one**
finding-bearing CodeRabbit review. The extra `reviews` rows on #465 (4) and #471
(2) carry `bodyFindings=0`, and the later inline comments in those batches are
acknowledgement replies — *"`@hackerwins` Thanks for confirming — that resolves the
MD040 warning."*

The real mechanism runs the other way: **CodeRabbit reviewed a later snapshot than
the one we froze.** #605 was reviewed at commit index 4 of 5, #465 at index 2 of 4,
#429 at index 2 (our window ends at 1), #549 at index 1 of 2. Only #471 and #524
were reviewed at the frozen commit. #415's review sits on `51c01826a`, a commit a
force-push removed from the pull request entirely.

That is not CodeRabbit having an advantage. It is the two arms being shown
different code, for reasons that have nothing to do with either reviewer.

### One more thing the after-window findings are not

Of the 27 findings that are not in-window, **22 are about a file the frozen diff
changed** and 5 are not. So the overlap at file granularity is high even where the
snapshot differs — which is why discarding them would throw away comparable
material, not just incomparable material.

## The change

Five files. Two are new.

| File | What |
|---|---|
| **`eval/adapters/coderabbit.mjs`** (new) | the mirror of `adapters/panel.mjs`: CodeRabbit's two endpoints → finding records. `placeInWindow` · `severityOf` · `codeRabbitRecords` · `fetchCodeRabbitPr` · `corpusRecords`, plus a CLI that prints a census and writes nothing |
| **`eval/adapters/coderabbit.test.mjs`** (new) | 30 tests. Every CodeRabbit body is verbatim from the API, pinned with its comment or review id |
| `eval/finding-record.mjs` | `ARM_ONLY_FIELDS.coderabbit` filled — 18 fields — and the `severity_raw` docblock corrected (see below) |
| `eval/finding-record.test.mjs` | the existing arm-namespace test extended over **both** arms |
| `harvest.mjs` | `CODERABBIT_LOGINS` exported. One token; see "Corrected while building" |
| `eval/README.md` | the adapter's row, the `window` and `severity_basis` tables, and two new known limits |

## The five decisions

### 1. Which CodeRabbit comments count as findings on a corpus item?

**Every one of them, tagged with which snapshot it is about. The rule tags; it
never filters.**

The measurement made this the only defensible answer rather than a hedge.
Excluding 80% of the comparator's findings, in a comparison we are running about
ourselves, for a reason that is not the comparator's advantage, is not a default —
it is a thumb on the scale that would read in the diff as ordinary data cleaning.

`placeInWindow` is a pure exported function with its own tests, deliberately not
inside the mapping loop, because it decides what the comparison measures and has
to be arguable on its own. Four values, mirroring `GATING`'s construction with a
frozen cause → answer map so the two can never be stated independently and
disagree:

| `window_basis` | `window` |
|---|---|
| `commit-at-or-before-review` | `in-window` |
| `commit-after-review` | `after-window` |
| `commit-not-on-pr` · `commit-absent` · `review-commit-not-on-pr` · `commits-unavailable` | `unplaceable` |
| `no-review-commit` | `no-window` |

`unplaceable` is not a side of the line — a force-push really does leave
`original_commit_id` dangling, and #415 is that case on real data. `no-window` is
separated from it for the reason `GATING` separates `not-applicable` from
`unknown`: "this pull request was never frozen" is a fact about the call, and
pooling the two would make "how much could we not place?" scale with how many
off-corpus pull requests somebody asked about.

**The placement is recoverable without re-querying GitHub.** `at_commit`,
`current_commit` and `review_commit` are all on the record, because the choice of
key *moves the numbers*: over the pilot's 16 inline findings,
`original_commit_id` first gives 3/11/2 and `commit_id` first gives 1/14/1. We use
`original_commit_id` first — the order `harvestPr` already uses, for its
documented reason — and carry the other so a scorer can re-place under either.

**The alternative, written down before any number exists:** score on the
in-window subset only, and report the after-window findings as a separate
population. That is defensible and we did not choose it, because at n=3 it is not
a measurement. If the full corpus changes the split, the records already support
it — nothing needs re-fetching.

### 2. What is `item_id`, and what happens off-corpus?

**`pr-<n>`, always, derived from the pull request number. The adapter works on any
pull request and the caller restricts.**

`buildFindingRecord` refuses an empty `itemId`, and `pr-471` genuinely names the
pull request a finding is on — which is true whether or not that pull request was
ever frozen. Corpus-scoping the adapter would have made the ~369 CodeRabbit pull
requests unreachable, including every pull request the fixtures came from.

**Corpus membership is not implied by the id.** It is reported by `window`, which
reads `no-window` for a pull request nobody froze — so an off-corpus record can
never be mistaken for a scoped one. Verified live: `--pr 11` produces 443 records,
all `no-window`.

`codeRabbitItemId` re-types the one string `buildItemMeta` builds inline and
exports from nowhere. It is pinned by a test asserting agreement with
`buildItemMeta`'s **own output**, not with itself — a round trip through the
duplicate would be invisible to the round trip.

### 3. Is `run_id` null, or the review id?

**`null`, with the provenance in the arm namespace.**

`run_id` exists so K replicates stay distinguishable. CodeRabbit has no
replicates, so a review id there would put a different kind of thing in a field
with one meaning — and any scorer grouping by `run_id` would silently treat each
CodeRabbit review as its own replicate. `review_id`, `comment_id`, `posted_at` and
`url` are in `record.coderabbit`, where arm-specific facts belong.

### 4. How does the severity translation stay auditable?

**Three sources, named on every record in `severity_basis`, and an assertion that
nothing foreign reaches the builder.**

The measurement forced this open. Repo-wide, n=3001 findings:

| `severity_basis` | n | Where the value came from |
|---|---|---|
| `header-field` | 1977 | CodeRabbit wrote one in the header. `trivial` → `nit` is `harvest.mjs`'s table, not duplicated here |
| `tier-heading` | 635 | it wrote none there, but filed the finding under a section whose title names one |
| `unstated` | 389 | it stated none anywhere |

**`tier-heading` is reading CodeRabbit's label, not inventing one, and the data
says so.** Wherever a nitpick-tier finding *also* carries a header severity, that
severity is `trivial` — **on all 274 of them, never anything else** — and
`trivial` is what the parser already maps to `nit`. `minor`-tier findings state
`minor` on **all 95**. The heading and the field never disagree where both exist.
`TIER_SEVERITY` therefore has exactly two entries.

The tiers deliberately left out, each for a measured reason: `duplicate` (69
findings carrying critical, major *and* minor, so the heading does not determine
it), `outside-diff-range` (same), `additional` (296 findings, none stating one, and
the title names no severity), `combined` (names three tiers at once),
`failed-to-post` (4 of 5 state `minor`, which is unanimous and meaningless — the
title describes a delivery failure, and a rule inferred from four incidental
samples is a guess wearing a measurement's clothes).

**`unstated` is unavoidable rather than chosen.** Both retired inline vintages
state no severity by construction (75 findings) and neither does the
Additional-comments tier (296), while the validator requires one of `KNOWN`. The
options were all bad:

- **`major`**, via `normalizeSeverity`'s fail-safe: files 389 findings as
  gate-blocking, 296 of them from a tier titled "Additional comments". This is
  #714's 268-trivial-nits bug with a bigger denominator. **Rejected.**
- **Withhold them**: deletes 34% of the comparator's data, including both retired
  eras entirely. **Rejected** — same direction as decision 1, and worse.
- **`nit`, the floor, with `severity_basis: "unstated"` mandatory.** Chosen. It
  claims the least and cannot inflate the other arm's blocking count.

**`nit` is not neutral and the module says so.** It moves those findings out of
CodeRabbit's blocking population, which flatters us. That is exactly why the basis
is mandatory, why the CLI counts it, and why the README carries: **no
severity-segmented number may pool an `unstated` record with a stated one.** Same
shape as `panel.gate_state` — a default indistinguishable from a measurement.

`severityOf` **throws** on any severity outside `KNOWN` rather than passing it on.
A fifth vintage will happen, and when the parser learns a word this module has not
seen it stops at the boundary instead of entering the corpus as a `major`.

### 5. What makes `file` and `summary` matchable?

**Both verbatim. Neither is normalised toward our vocabulary.**

`file` is the comment's `path` (inline) or the file sub-section title
(review-body); `summary` is CodeRabbit's bolded title exactly as written.
Reshaping the title toward a lens's phrasing would silently improve one arm's
match rate against the other and be invisible in every number downstream. The
similarity layer is `finding-match.mjs`'s job, in the cross-arm matcher, and this
record deliberately does not do it.

`line` is populated on **30 of 30** pilot records, so the anchor layer has a
location for every one. Two details that are easy to get wrong:

- **The line and the commit are read from the same snapshot.** `original_*`
  describes the commit the comment was written on; `line`/`commit_id` describe
  where GitHub places it now. Taking one from each names a position in neither
  tree. GitHub also leaves `line` null once a comment goes outdated — three of the
  four pinned fixtures have `line: null` and a populated `original_line` — so the
  original pair is the more complete one as well as the consistent one.
- **The START of the range on both halves.** `original_line` is the *last* line of
  a multi-line comment; the review-body locator `97-114` starts at 97. Taking the
  start on both keeps one meaning for `line` across CodeRabbit's two endpoints.

## Corrected while building

**The handoff's premise about CodeRabbit's review cadence is wrong for the pilot.**
It reviewed each item **once**; the later activity on #465 and #471 is
acknowledgement replies. The in-window shortfall is a *different snapshot*, not
*extra rounds* — which changes what the report's caveat has to say.

**The handoff said `ARM_ONLY_FIELDS.coderabbit` was a placeholder to fill, and it
was — but `severity_raw` cannot go in it.** That field already exists at the
record's top level. Putting it in the namespace makes two places for one fact and
only one of them is validated. Renamed to `stated_severity`.

**And that collision exposed a real limitation in #713's schema, which the handoff
listed as a settled fact.** The prompt says *"`severity_raw` keeps the original
visible"*, and `finding-record.mjs`'s own docblock said CodeRabbit's `trivial`
*"would be indistinguishable from a real `major` once the adapter has translated
it"* without it. **It cannot do that job on this arm.** `buildFindingRecord`
derives `severity` **and** `severity_raw` from the one input `finding.severity`,
and the validator refuses anything outside `KNOWN` — so the boundary must translate
`trivial` → `nit` *before* the builder, at which point `severity_raw` reads `nit`
too. On every CodeRabbit record the two fields are equal. The docblock is corrected
to say so, `coderabbit.stated_severity` carries the original, and a test pins it so
nobody mistakes it for a bug in the adapter. **Fixing it properly needs a second
input on the builder, which is a schema change and not an adapter's business.**

**Two bugs were caught by guards written in this PR, on their first run.** Both are
in the class this project keeps re-learning.

1. **`severity` leaked into the arm namespace.** `severityOf` returns three fields
   and I spread all of them, putting a copy of the top-level `severity` inside
   `record.coderabbit`. The `ARM_ONLY_FIELDS` key assertion caught it on the first
   real invocation. It would never have failed a test I wrote by hand, because I
   would have asserted the fields I meant to emit.
2. **An unreadable commit list was reported as `unplaceable`, indistinguishable
   from a force-push.** The CLI's first live run hit a network timeout on #415's
   commits call and printed `window unplaceable=3` — the *right answer for the
   wrong reason*, since that item's findings genuinely are unplaceable. Nothing in
   the output distinguished our failure from CodeRabbit's data. Fixed twice over:
   the commit list's state is now reported beside the two endpoints, and the CLI
   prints the **basis** rather than the value, so `commits-unavailable=3` and
   `commit-not-on-pr=3` read differently. Lesson 1, found by running the thing.

**`harvest.mjs` is touched, against the handoff's non-goal, and the reason is a
stronger rule.** `CODERABBIT_LOGINS` is now exported — one token, no behaviour
change, no parser change. The alternative was re-typing a security-relevant login
set in a second module, and `adapters/panel.mjs`'s own header explains why not: the
module it replaced *"re-declared `BLOCKING` locally … Nothing enforced that it would
keep matching, and the same re-typing pattern has already cost this project a paid
harvest."* Two rules collided and this is the one that prevents the worse failure.

**`finding_key` is not unique inside the CodeRabbit arm** — 64 of its 3001 findings
(2.1%) share a key with another, mostly era-1 comments whose whole title is
`LGTM!`; `src/spreadsheet/worksheet.ts::lgtm!` is held by six. Not a defect
introduced here, but a consumer keying a map by `finding_key` loses five of those
six. Recorded as a known limit.

## Fail directions

| Part | When it fails | Why that is the safe way |
|---|---|---|
| `severityOf` on a foreign severity | **throws** | The one place it must. `normalizeSeverity` would read it as a blocking `major` and it would enter the corpus looking like a real finding. A refusal costs one run; a silently promoted nit costs every number computed after it |
| An endpoint that does not answer | `null`, never `[]`, and `population_state: "absent"` | "CodeRabbit wrote nothing" is a **true negative** and a real data point. Reading a failed fetch as a clean review deletes the other arm's clean reviews exactly as it would delete ours |
| One endpoint answers, the other does not | `population_state: "absent"` | Half of CodeRabbit's output reported as all of it is a count smaller than the truth with nothing saying so. `sources` names which half |
| Commit list unreadable | every finding `unplaceable` / `commits-unavailable`, **and the CLI says the split is not quotable** | Our failure must not read as a fact about CodeRabbit's data |
| A comment that is not a finding | counted in `dropped` with a reason | A matcher that quietly eats candidates is indistinguishable from a reviewer that found nothing |
| A review section matching no known tier | reported in `declared.unrecognised` with its declared count | An unknown tier is otherwise indistinguishable from a review that found nothing — the failure that produced a false zero on 93 review bodies once already |
| The arm namespace drifting from `ARM_ONLY_FIELDS` | **throws**, naming the extra and missing keys | A list that only documents what an adapter happens to emit goes stale on the first edit |
| `window` and `window_basis` disagreeing | **throws** | One fact stated twice is a fact that eventually contradicts itself |

Everything else is a read path: it degrades to fewer records, never throws, and
whatever it could not use comes back in `dropped`.

## Explicit non-goals

- **No matching across arms.** No `matchFindings`, no similarity, no clustering.
- **No metric.** No precision, overlap or agreement.
- **No normalisation of CodeRabbit's text toward ours**, for any reason.
- **No filtering by `window`.** The rule tags. A scorer chooses.
- **No change to `finding-record.mjs` beyond `ARM_ONLY_FIELDS.coderabbit` and a
  corrected docblock.** The `severity_raw` gap is reported, not quietly patched.
- **No change to the parser's behaviour.** `harvest.mjs` gains one `export`.
- **Nothing is stored.** Records are derived, recomputable and free.
- **The panel, the gate, every lens, the runner and the store are untouched.**

## Verification

Measured at `upstream/main` = `1f9ee8864`, from the **committed tree**, with no
`node_modules` present.

- [x] **`agent:tests` lane** — `cd scripts/agent && node --test-timeout=60000
      --test-force-exit --test '**/*.test.mjs'`: **1412 tests · 0 fail · 6 skip**,
      against a baseline I measured myself at the same sha: **1382 · 0 fail · 6
      skip**. +30 tests, no new skips. (The 6 skips are the documented pair: 1 for
      the absent Agent SDK, 5 for `lint-config.test.mjs` without a root install.)
- [x] `eval/test-lane.test.mjs` passes with the new suite present.
- [x] `npx eslint scripts` exits 0 on the lockfile's pinned `eslint@9.24.0`.
- [x] **`validateFindingRecord` accepts every record produced**, over real pull
      requests rather than one hand-built example: 30 records across the 7 pilot
      items, 443 across PR #11, 17 across PR #6. Validation runs inside
      `codeRabbitRecords` on every record, so those runs are the assertion.
- [x] **No `trivial` or any foreign severity reaches `buildFindingRecord`** —
      `severityOf` throws, and a test asserts it for `trivial` and `blocker`.
      `stated_severity` preserves the original word.
- [x] **The in-window measurement across all seven pilot items, with `n`** — see
      above, n=30, 3/24/3.
- [x] **A record from every header vintage and every review-body tier**, from
      pinned real bodies. Confirmed live too: `--pr 11` covers `single-italic`,
      `bold-title`, `nitpick`, `additional`, `duplicate` and `failed-to-post`;
      `--pr 6` covers `combined`.
- [x] **`gatingCensus` over real records**: `not-applicable=30`,
      `no-gate-in-arm=30` across the pilot — every one, including the three
      `major`s. The correct and boring answer.
- [x] Every new test mutation-tested; results in the pull request body.

**Not verified, and why:**

- **The `after-window` findings have not been checked line-by-line against the
  frozen diff.** File-level overlap is measured (22 of 27); whether the specific
  lines existed at `review_commit` is not. That is a scorer's question and it needs
  the diff, not the API.
- **The severity and window counts are the CHILL-and-earlier population as it
  stands today.** CodeRabbit posted three-field findings during this session; the
  totals move.
