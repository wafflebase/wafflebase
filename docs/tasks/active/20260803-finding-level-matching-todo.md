# Finding-level matching: tell a restatement from a miss

Script-only, offline harvesting tooling. Changes nothing about what the panel
decides or what gets reviewed.

## The problem

`harvest.mjs`'s second signature filed every CodeRabbit blocking finding as "the
panel missed this". It could not do otherwise: the only thing it knew about the
panel's output was a **count**. `panelVerdictAt` computed `blockingFindings` via
`tagPriorFindings` and dropped the findings on the floor, so the harvester could say
the panel raised three blockers and never whether one of them was the comment in
hand.

So signature 2 over-fired by construction, and the noise landed on a human curator
via the `verifiedBy` gate. The module's own header names this as the central risk —
harvester noise is *systematic*, it follows whatever the matcher over-fires on, so it
moves the panel somewhere specific and wrong rather than nowhere.

Underneath that sat a second problem, found while measuring the first: **signature 2
had inherited signature 1's preconditions**, and they cost it every PR where the
comparison was actually possible. See "Corrected from the plan".

## The change

- [x] `scripts/agent/finding-match.mjs` — the anchor layer and the layered matcher,
      ported from the eval-harness archive branch. `extractAnchor`, `anchorIsEmpty`,
      `linesOverlap`, `compareAnchors`, `tokenOverlap`, `matchFindings`, `bestMatch`.
      The two eval-only shape adapters (`labelToFinding`, `artifactToFinding`) were
      left behind — they describe artifacts that do not exist upstream.
- [x] **The similarity metric is not re-derived.** `findingSimilarity`,
      `summaryTokens`, `DEFAULT_SIMILARITY` and `MIN_SHARED_TOKENS` are imported from
      `rounds.mjs`, which owns them. What this module adds is a *location* signal —
      a different axis from text — mined from the `summary`/`evidence` prose the
      finding schema has no field for.
- [x] `MIN_SHARED_TOKENS` gained an `export` in `rounds.mjs`. One keyword, no
      behaviour change: `tokenOverlap` needs the same floor for the same reason, and
      copying `3` into a second file is the drift `CITATION` and `REFUTATION_GROUNDS`
      both exist to avoid.
- [x] `panelVerdictAt` returns `blockers` — the blocking findings themselves —
      alongside the existing three fields, which callers depend on. The **blocking
      subset only**: a CodeRabbit blocker "already raised" by a nit the panel filed is
      not a gate hit.
- [x] `attributeToPanel` — `match` suppresses (counted and logged), `maybe` emits
      flagged, `no` emits, and the verdict lands in `panelSaw` with its score and the
      panel finding it matched. No new top-level field; `schema` stays
      `wafflebase/miss@1`.
- [x] Both sides compared **lens-neutral**, via the `{ ...f, lens: "" }` copy
      `clusterFindings` already uses. CodeRabbit's lens is a category→lens guess and
      is often `""`, and a defect the panel raised under a *different* lens is still a
      defect the panel raised.
- [x] `codeRabbitDetail` — title plus prose, cut at the first `<details>`, fence or
      HTML comment.
- [x] `parsePanelComment` / `panelFindingsFromComments` — read the on-demand panel's
      findings out of the comment it posts, as a **fallback** where no lens check runs
      exist. Author-gated to the App.
- [x] `harvestPr` restructured so each signature checks only what it needs, and
      signature 2 requires *evidence the panel reviewed this PR*.
- [x] `listCandidatePrs` also returns PRs carrying an on-demand panel review, found
      via the marker the panel itself writes.
- [x] 551 agent tests (503 on `main`), all green, no `node_modules` needed.

## Corrected from the plan

**The plan said to feed the matcher CodeRabbit's `summary`. That is six tokens.**
`summaryTokens("Guard public mutation APIs at the read-only boundary.")` reduces to
`guard, public, mutation, apis, read, boundary`, and containment is scored over the
*smaller* token set — so two incidentally shared words clear the 0.3 bar.

Feeding the **whole body** fails the other way, and in the dangerous direction. Every
CodeRabbit comment ends with a `🤖 Prompt for AI Agents` block opening with the same
boilerplate — *"Verify each finding against current code. Fix only still-valid
issues…"* — contributing `code`, `fix`, `issues`, `changes`, `validate` to **every**
comparison, plus committable-suggestion blocks that dump literal source. Against a
~15-token panel summary that inflates containment on the vocabulary every finding in
the file already shares, producing false matches where the panel had the *most*
findings — eating real misses where they are densest.

So the two channels get different text: **title + prose** for the token comparison,
the **whole body** for the anchor layer, where more text is strictly better and the
`around lines 395 - 397` range in that same boilerplate block is the most precise
location signal a review comment carries. Verified against all 10 inline findings on
#548, #594 and #639.

**The ported L2 promoted on location alone.** Its match condition scored
`max(tokenOverlap, symbolOverlap)`, and `symbolOverlap` is 1.0 whenever both sides
name exactly one symbol and it is the same one — so two distinct defects both
touching `parseARef`, sharing no summary vocabulary at all, matched at 1.00. That is
the one thing the anchor layer must never do. The gate now keys on token overlap;
anchors keep their veto and their score contribution, and get no vote on clearing the
bar.

**A backticked path was mined as a bag of symbols.** `IDENT_RE` ran over every
backtick span including `` `@packages/docs/src/view/text-editor.ts` ``, minting
`packages`, `docs`, `src`, `view` as *symbols* — so any two findings under one
directory shared symbols on tree vocabulary alone. `PATH_RE` already records that
string as a file. CodeRabbit backticks the path on every finding, so this was
reachable rather than theoretical.

**Signature 2 was gated on signature 1's preconditions, and that was where all the
data went.** Measuring the change found it suppressing nothing at all, on any PR in
the repo's history. Three separate causes, none of them the matcher:

1. **`isAgentPr` gated the whole function.** Signature 1 needs it (a hand-off only
   exists on a promoted agent PR). Signature 2 does not: *"CodeRabbit flagged
   something our panel reviewed and did not raise"* is exactly as true on a human PR
   someone ran `@claude review` on.
2. **A missing hand-off marker skipped the whole PR.** 18 of 33 agent PRs were opened
   ready rather than promoted from draft, so they have neither a marker nor a
   `ready_for_review` event. For signature 1 that is correct — without the moment the
   panel let go, "after" has no referent. For signature 2 `handoffAt` is not merely
   unknown but *meaningless*: nothing was handed off.
3. **`panelVerdictAt` reads check runs, and the on-demand panel writes none.**
   `agent-review-on-demand.yml` says so four times over — *"purely advisory: it
   records NO check runs"*, `checks: read` and never `checks: write`. Its findings
   exist only as markdown in a PR comment. That population — 14 PRs carrying 1-38
   blocking findings each — was structurally invisible.

Fixing all three is what turned the change from a measured no-op into three real
suppressions. It also opened a hazard that had to be closed in the same breath:
widening the population means PRs the panel *never reviewed* would have every
CodeRabbit blocker filed as a miss. Hence `panelReviewed`.

**`conclusion === ""` vs `blockers: []`.** A commit with zero lens runs returned an
empty `blockers` array, which read as "the panel raised nothing" and kept the comment
fallback unreachable. `panelVerdictAt` already distinguishes them — `conclusion` is
`""` exactly when no lens ran — so the check-run result is only trusted when a run
existed.

## Fail directions

| path | on doubt | why |
|---|---|---|
| `matchFindings` ambiguity | `maybe` | a false `match` suppresses a candidate, and a suppressed candidate is a miss nobody can recover later; a false `maybe` costs one line of reading |
| `attributeToPanel` throws | `maybe` | suppressing would silently drop a real miss, emitting unflagged would restore the noise the matcher exists to remove |
| panel verdict unreadable | `""`, not `no` | `blockers` is `null` for "could not establish" and `[]` for "the panel raised none". The candidate still emits, but the record does not claim the matcher looked |
| no evidence the panel reviewed the PR | **no candidates**, logged | "the panel did not raise this" is only a claim about the panel if the panel looked. Withheld ~29 would-be candidates across 19 PRs in the measured window. Withholding writes no row, so a later harvest re-proposes once the evidence exists; a wrong row, once curated, stays |
| agent authorship | **not** treated as evidence of a review | measured: of 11 agent PRs carrying CodeRabbit blockers, 9 have no `agent-review-*` check run on any commit. They match `isAgentPr` by branch prefix but never went through the panel |
| commits list unreadable | check-run path lost, comment path unaffected | `headAtHandoff` derives from the commits list, so an outage there withholds; a PR with an on-demand review still harvests. The two sources fail independently |
| panel comment author is not the App | ignored entirely | these findings can SUPPRESS a candidate, so a forged comment could silence real misses with no trace. #578 already carries a *CodeRabbit* comment containing "Review panel" |
| multiple on-demand reviews | the **union** of their findings | the record claims "the panel did not raise this"; a finding raised in an earlier review is one the panel raised, and filing it would put a false row in an eval corpus |
| check runs vs comment | check runs **win** | one is the structured record, the other a rendering of it |
| on-demand PR search fails | agent PRs only, logged | the agent PRs are already in hand, so the outage costs only the wider population |
| every other read | fewer candidates, never throws | unchanged |
| the one write (`--append`) | **refuses** | unchanged |

`verifiedBy` stays `""` on every harvested record. `dedupeById` still keeps the
**first** occurrence, so a re-harvest can never blank a human's curation.

## Explicit non-goals

**No second similarity metric.** The one in `rounds.mjs` is calibrated against real
data; a hand-tuned copy would rot.

**No change to `clusterFindings`,** and this was measured rather than assumed. Over
153 real captured findings (10 (item, lens) groups, 1,249 pairs), an anchor guard
blocks **0 of the 39 merges** clustering performs. It is not vacuous — it disagrees
on 42% of the population generally — but of the 45 pairs that clear the text
threshold, **none** disagree on anchors. Upstream's clustering is already
anchor-consistent, so a guard there is pure surface area on a production gate path.

**No change to what the panel decides or what gets reviewed.** Offline tooling only.
In particular this does **not** make the on-demand review write check runs — it reads
what that path already publishes. Making it persist findings properly is a separate
change on the producer side, and it would want check names distinct from
`agent-review-<lens>` so an advisory review cannot be mistaken for a gating one.

**No LLM adjudication.** The designed L3 stays unbuilt until the `maybe` queue is
shown to be worth paying to shrink. In the measured window that queue is empty.

## Verification

- [x] 551 agent tests green (`node --test "scripts/agent/*.test.mjs"`), 503 before.
- [x] Both trap regressions: a `0` from `findingSimilarity` is not read as "different
      file" (0 also means "same file, under the token floor"), and a `null`
      `symbolOverlap` means *no evidence*, never disagreement.
- [x] A third regression for the promotion bug: shared anchors alone reach `maybe`,
      never `match`.
- [x] Harvest-level: a restatement is suppressed and logged, an unrelated finding
      emits, an ambiguous one emits flagged, an unreadable verdict records `""`
      rather than `no`, a matcher throw resolves to `maybe`, a forged panel comment
      is ignored, check runs beat the comment, and a search outage degrades.
- [x] *EVERY harvested candidate is unverified* still passes.

### On real data

Full run over the harvestable population, `--since 2026-07-01` (100 PRs):

| | count |
|---|---:|
| CodeRabbit candidates emitted | 2 |
| **suppressed as restatements of a panel finding** | **3** |
| human-fix candidates | 21 |
| would-be candidates withheld — panel never reviewed the PR | ~29 |

**Every emitted CodeRabbit candidate is now backed by an actual panel review**, and
both carry `matchVerdict: "no"` — compared and unmatched, not "we could not check".
#548 was compared against readable lens check runs; #559 against a *"Review panel:
looks good"* comment, i.e. a panel that reviewed and raised nothing, which makes a
CodeRabbit blocker there a genuine miss candidate.

An earlier iteration of this change emitted 17 with 15 of them carrying
`matchVerdict: ""` — no comparison possible. Chasing that down is what found the
authorship assumption: those 15 were on agent PRs the panel had never reviewed at
all. `""` is now unreachable for a CodeRabbit record by construction, since signature
2 does not run without a comparison set.

The three suppressions, each inspected by hand and each a genuine restatement:

- **#582** — CR *"Security lens scopeClasses is missing `design-spec`"* ↔ panel *"The
  security lens's `scopeClasses` omits `design-spec`, so a `docs/design/**`-only PR
  is reviewed by design-fit alone"*. Score 1.00.
- **#582** — CR *"Docs lens `appliesWhen` is missing `docs/…`"* ↔ panel *"…does not
  cover `docs/**/*.txt`, which the `prose` class does"*. Score 1.00.
- **#578** — CR *"Retryability is inferred from message text, not status"*, whose body
  states *"`resets?\b` matches substrings like 'connection reset by peer'"* ↔ panel
  *"the quota-detection regex's `resets?\b` alternative matches ordinary transient
  network errors"*. Same regex, same reasoning. Score 0.75.

Both PRs are human-authored and carry no lens check runs, so **all three were
unreachable before this change** — and all three would have been filed as panel
misses.

Caveat worth stating: with 3/3 matching there is no negative control in the real
sample. The `no` and `maybe` paths are evidenced only by tests.

## Not built

**Reading lens check runs without a hand-off.** `headAtHandoff` anchors the check-run
read, so on a PR with no hand-off marker only the comment path reaches signature 2.
Measured cost today: none — every PR in that population has zero lens runs on *any*
commit, so an all-commits read (`prCommitsWithCheckRuns` + `allCheckRuns`, the way
`collectPrior` does it) finds nothing either. Asserted in the tests so it cannot
change silently.

Persisting on-demand review findings as structured data on the producer side (the
harvester reads the comment instead). L3 LLM adjudication. A `harvest --report`
roll-up of suppression counts over time, which is what would show whether the matcher
keeps earning its place. The 5 existing `misses.jsonl` records keep their original
three-field `panelSaw`; they are readable and rewriting them would touch rows a human
may yet curate.
