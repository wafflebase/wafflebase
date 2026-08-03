# Finding-level matching: tell a restatement from a miss

Script-only, offline harvesting tooling. Changes nothing about what the panel
decides or what gets reviewed.

## The problem

`harvest.mjs`'s second signature files every CodeRabbit blocking finding as "the
panel missed this". It cannot do otherwise: the only thing it knows about the panel's
output is a **count**. `panelVerdictAt` computed `blockingFindings` via
`tagPriorFindings` and dropped the findings on the floor, so the harvester could say
the panel raised three blockers and never whether one of them was the comment in
hand.

So signature 2 over-fires by construction, and the noise lands on a human curator via
the `verifiedBy` gate. The module's own header names this as the central risk —
harvester noise is *systematic*, it follows whatever the matcher over-fires on, so it
moves the panel somewhere specific and wrong rather than nowhere.

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
      behaviour change, no new caller of the old kind: `tokenOverlap` needs the same
      floor for the same reason and copying `3` into a second file is the drift
      `CITATION` and `REFUTATION_GROUNDS` both exist to avoid.
- [x] `panelVerdictAt` returns `blockers` — the blocking findings themselves —
      alongside the existing three fields, which callers depend on. The **blocking
      subset only**: a CodeRabbit blocker "already raised" by a nit the panel filed is
      not a gate hit, and matching against non-blocking findings would suppress a real
      gate miss on the strength of a passing remark.
- [x] `attributeToPanel` in `harvest.mjs` — `match` suppresses (counted and logged),
      `maybe` emits flagged, `no` emits, and the verdict lands in `panelSaw`
      alongside its score and the panel finding it matched. No new top-level field;
      `schema` stays `wafflebase/miss@1`.
- [x] Both sides compared **lens-neutral**, via the `{ ...f, lens: "" }` copy
      `clusterFindings` already uses. Not a second approach to the same problem.
      CodeRabbit's lens is a category→lens guess and is often `""`, and a defect the
      panel raised under a *different* lens is still a defect the panel raised.
- [x] `codeRabbitDetail` — title plus prose, cut at the first `<details>`, fence or
      HTML comment. See "Corrected from the plan".
- [x] 540 agent tests (503 on `main`), all green, no `node_modules` needed.

## Corrected from the plan

**The plan said to feed the matcher CodeRabbit's `summary`. That is six tokens.**
`summaryTokens("Guard public mutation APIs at the read-only boundary.")` reduces to
`guard, public, mutation, apis, read, boundary`, and `findingSimilarity` scores
containment over the *smaller* token set — so two incidentally shared words clear the
0.3 bar. The title alone is not a summary, it is a headline.

Feeding the **whole body** fails the other way, and in the dangerous direction. Every
CodeRabbit comment ends with a `🤖 Prompt for AI Agents` block opening with the same
boilerplate sentence — *"Verify each finding against current code. Fix only
still-valid issues…"* — contributing `code`, `fix`, `issues`, `changes`, `validate`
to **every** comparison, plus committable-suggestion blocks that dump literal source.
Against a ~15-token panel summary that inflates containment on exactly the vocabulary
every finding in the file already shares, producing false matches where the panel had
the *most* findings — eating real misses where they are densest.

So the two channels get different text: **title + prose** for the token comparison,
the **whole body** for the anchor layer, where more text is strictly better and the
`around lines 395 - 397` range in that same boilerplate block is the most precise
location signal a review comment carries. Verified against all 10 inline findings on
#548, #594 and #639: the body is always header → title → prose → blocks, and prose
never resumes after the first block.

**The ported L2 promoted on location alone.** Its match condition scored
`max(tokenOverlap, symbolOverlap)` against the threshold, and `symbolOverlap` is 1.0
whenever both sides name exactly one symbol and it is the same one — so two distinct
defects that both touch `parseARef`, sharing no summary vocabulary at all, matched at
1.00. That is the one thing the anchor layer must never do. The gate now keys on
token overlap; anchors keep their veto and their contribution to the reported score,
and get no vote on clearing the bar.

**A backticked path was being mined as a bag of symbols.** `IDENT_RE` ran over every
backtick span including ` `@packages/docs/src/view/text-editor.ts` `, minting
`packages`, `docs`, `src`, `view` as *symbols* — so any two findings under one
directory shared symbols on tree vocabulary alone. `PATH_RE` already records the same
string as a file. CodeRabbit backticks the path on every finding, which makes this
reachable rather than theoretical.

## Fail directions

| path | on doubt | why |
|---|---|---|
| `matchFindings` ambiguity | `maybe` | a false `match` suppresses a candidate, and a suppressed candidate is a miss nobody can recover later; a false `maybe` costs one line of reading |
| `attributeToPanel` throws | `maybe` | suppressing would silently drop a real miss, emitting unflagged would restore the noise the matcher exists to remove — `maybe` honours "never throw" without choosing either |
| panel verdict unreadable | `""`, not `no` | `blockers` is `null` for "could not establish" and `[]` for "the panel raised none". The candidate still emits, but the record does not claim the matcher looked and found nothing |
| anchors name disjoint symbols | demote to `maybe`, never drop | a rephrasing can legitimately name different helpers |
| every read path | fewer candidates, never throws | unchanged: a GitHub hiccup costs this run's proposals, not the corpus |
| the one write (`--append`) | **refuses** | unchanged |

`verifiedBy` stays `""` on every harvested record — `toMissRecord` defaults it and no
harvest path passes it. `dedupeById` still keeps the **first** occurrence, so a
re-harvest can never blank a human's curation.

## Explicit non-goals

**No second similarity metric.** The one in `rounds.mjs` is calibrated against real
data; a hand-tuned copy would rot.

**No change to `clusterFindings`,** and this was measured rather than assumed. Over
153 real captured findings (10 (item, lens) groups, 1,249 pairs), an anchor guard
blocks **0 of the 39 merges** clustering performs. It is not vacuous — it disagrees
on 42% of the population generally — but of the 45 pairs that clear the text
threshold, **none** disagree on anchors. Upstream's clustering is already
anchor-consistent, so a guard there is pure surface area on a production gate path.
The opposite direction (merge when anchors agree but text does not) surfaces 53
candidates of which roughly one is a genuine missed merge; the rest are distinct
defects sharing domain vocabulary.

**No change to what the panel decides or what gets reviewed.** This is offline
harvesting tooling. Nothing here runs in the gate path.

**No LLM adjudication.** The designed L3 stays unbuilt until the `maybe` queue is
shown to be worth paying to shrink. Today that queue is empty (below).

## Verification

- [x] 540 agent tests green (`node --test "scripts/agent/*.test.mjs"`), 503 before.
- [x] 28 matcher tests, including both trap regressions: a `0` from
      `findingSimilarity` is not read as "different file" (the gate is checked
      directly, because 0 also means "same file, under the token floor"), and a
      `null` `symbolOverlap` means *no evidence*, never disagreement.
- [x] A third regression for the promotion bug above: shared anchors alone reach
      `maybe`, never `match`.
- [x] Harvest-level tests: a restatement is suppressed and logged, an unrelated
      finding still emits, an ambiguous one emits flagged, an unreadable panel
      verdict records `""` rather than `no`, and a matcher throw resolves to `maybe`.
- [x] *EVERY harvested candidate is unverified* still passes.

### On real data: the change is a no-op, and that is the finding

Run against the live API over **every merged agent PR** (33 of the last 200 merged;
the harvester skips non-agent PRs, which is why #594/#608/#639 contribute nothing):

| | count |
|---|---:|
| CodeRabbit blocking candidates, before | 5 |
| CodeRabbit blocking candidates, after | 5 |
| suppressed (`match`) | **0** |
| flagged (`maybe`) | 0 |

Not one record changed. **On all 33 PRs the panel had zero blocking findings at
`headAtHandoff`** — that is the commit that let the PR through, and `mark-ready.mjs`
only promotes when the panel approves, so an approving panel has no blockers by
definition. The comparison set is empty, and every CodeRabbit blocker is unmatched by
construction. The count-based version gave the same answer; this one reaches it
honestly and says so in the record.

The union-of-all-rounds comparison set was measured as the alternative and rejected:
only **2 of 33** PRs have any retrievable panel finding in any round (#605, #521), and
neither carries a CodeRabbit candidate, so it would also produce 0 suppressions at
the cost of one API call per commit.

So the value here is **latent**: before this change the harvester could not tell a
restatement from a miss, and now it can. On the current corpus there is nothing to
tell apart.

## Not built

Union-of-all-rounds attribution (measured above, no signal yet). L3 LLM adjudication
of the `maybe` queue. A `harvest --report` roll-up of suppression counts over time,
which is what would show whether the matcher is earning its place.
