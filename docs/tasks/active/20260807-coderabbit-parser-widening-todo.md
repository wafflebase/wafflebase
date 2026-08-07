# Read all four of CodeRabbit's comment formats, and the review body

`scripts/agent/harvest.mjs` mines this repository's review history to propose corpus
candidates. It reads **436 of the 3111 findings CodeRabbit has written here — 14%** —
and one of its code comments explains why, using a claim that is false.

Measured 2026-08-07 against the live API, over **all 638 PRs** in the repository.

## The problem

Three independent narrowings stack, and every one of them is silent. None errors;
each returns a smaller number than the truth and no way to tell from the output.

### 1. The header regex knows one of four vintages

`CR_HEADER` required **three** italic fields. CodeRabbit has used four shapes here:

| Vintage | Shape | Inline findings | Read before |
|---|---|---|---|
| bold-title | `**Title.**` — no header at all | 11 | ✗ |
| single-italic | `_⚠️ Potential issue_` | 64 | ✗ |
| two-field | `_<category>_ \| _<severity>_` | 475 | ✗ |
| three-field | `_<category>_ \| _<severity>_ \| _<effort>_` | 935 | ✓ |

550 of 1485 inline findings — **37%** — were unreadable.

**The two-field header is not a retired vintage.** Its most recent use is **#692 on
2026-08-07**, in the current CHILL vocabulary: CodeRabbit simply omits the effort
field sometimes. #688 the day before is the same. So this is a live blind spot on
today's format, not archaeology — and it is why the new parser matches fields by
**vocabulary rather than by position**.

The code comment at `harvest.mjs:262-265` said:

> *"Nothing in this repository has ever emitted those strings — every inline finding
> back to #525 uses the header below."*

True back to #525, wrong before it. **470 inline findings carry `_⚠️ Potential issue_`
— the exact upstream vocabulary the comment says was never emitted** — and another 64
carry it in a single italic field.

### 2. The nitpick tier lives in the review body, and the module never fetched it

`harvest.mjs` called `issues/{n}/comments`, `pulls/{n}/comments` and
`pulls/{n}/commits`. Most of what CodeRabbit writes is in **`pulls/{n}/reviews`**,
nested under collapsed `<details>` sections. That is a **new endpoint**, not a new
regex.

| Tier, over all 638 PRs | Findings |
|---|---|
| 🧹 Nitpick comments | 997 |
| 🔇 Additional comments | 296 |
| ⚠️ Outside diff range comments | 147 |
| 🟡 Minor comments | 95 |
| ♻️ Duplicate comments | 69 |
| 🛑 Comments failed to post | 21 |
| combined (2024 title) | 1 |
| **total** | **1626** |

### 3. Non-blocking severities were dropped at the parser

`if (!BLOCKING.has(severity)) return null` — inside `classifyCodeRabbitComment`. That
made *"what CodeRabbit wrote"* and *"what this corpus files"* the same function, so
widening the parser would have flooded the candidate corpus with nits.

### The ordering trap

Widening the tiers **without** fixing the severity map creates a bug that does not
exist today. `normalizeSeverity("trivial")` returns **`major`** — `KNOWN` in
`severity.mjs` has no `trivial` and unknown → major is the fail-safe for our gate.
CodeRabbit's nitpick tier is 307 `trivial`. Fetch the tier and leave the severity path
alone and **307 lowest-tier nits are filed as blocking majors**.

## The change

**`classifyCodeRabbitHeader(line)`** — new. Reads all three italic arities. Fields are
assigned by **vocabulary** (category / severity / effort), not by position, because
position is not stable across vintages: a single italic field is a *category* in the
2025 shape and an *effort* (`_⚡ Quick win_`) in the 2026-05 one, and 212 of 226
single-field headers in review bodies are efforts.

The `_` delimiter also occurs **inside** a field — GitHub emoji shortcodes contain
underscores (`_:hammer_and_wrench: Refactor suggestion_`) — so a header line is split
on `|` and each part unwrapped, rather than matched with one `[^_]+` regex, which
stops at the first inner underscore and drops the finding.

**`classifyCodeRabbitComment(body)`** — widened to all four vintages, returns every
severity, and now carries `vintage`, `vocabulary`, `severityRaw` and `effort`
alongside the existing fields. Additive: no existing field changed meaning.

**`parseCodeRabbitReview(body)`** — new. Returns `{findings, declared, shortfall,
unrecognised}`. Each finding carries its **tier**.

**`codeRabbitReviewSections(body)`** — new. Tier sections with the count each one
declares, plus `unrecognised` — titles carrying a count that match no tier and no
known housekeeping section.

**`auditCodeRabbit(pr)` and `harvest.mjs --audit`** — new, read-only. Prints what
CodeRabbit wrote per PR against CodeRabbit's own denominators. Writes nothing, files
no candidate, never touches `misses.jsonl`.

**`harvestPr`** — the blocking-only filter now lives here, in the caller, with the
reasoning stated as the corpus policy it is.

**`harvest.mjs:262-265`** — the false comment is gone, replaced by the measurement.

### Where the numbers land

| | before | after |
|---|---|---|
| Inline comments read as findings | 436 | 1485 of 1891 CodeRabbit comments |
| Review-body findings | 0 | 1626 of 1626 declared (100.0%) |
| **Total** | **436** | **3111** |

Per vintage, inline: bold-title 11 · single-italic 64 · two-field 475 · three-field
935. In review bodies: bold-title 780 · single-italic 226 · two-field 147 ·
three-field 473.

## Corrected while building

**The prompt's `838 of ~2662 = 31%` is wrong in both terms, and I could not
reproduce either.**

- **838 counts headers the regex matched, not findings the parser returned.** The
  three-field header appears 935 times (845 of them before 2026-08-06, which is
  where 838 most likely came from), but `classifyCodeRabbitComment` then drops every
  non-blocking severity. It returns **436**.
- **~2662 understates the total.** I measure **3111** — 1485 inline + 1626
  review-body. The review-body half alone is 1626, not 1361, and my recovery is
  100.0% of 1626 declared rather than 94.3% of 1443.
- So the real ratio is **436 / 3111 = 14.0%**, not 31%.

**The vintage table's date ranges are wrong for era 2.** The prompt has the two-field
header as `2026-03 → 2026-04`. Measured: **2026-02-22 → 2026-08-07**, still live.
Monthly: 2026-02 ×6, 03 ×275, 04 ×179, 05 ×6, 06 ×7, 08 ×2. The claim *"zero PRs carry
both"* holds only for the **three-field** subset; the two-field header spans the
boundary and appears in both vocabularies.

**"93 review bodies read as zero" from the combined section title is not
reproducible.** The combined title `Outside diff range, codebase verification and
nitpick comments` appears on **exactly one** review body in this repository — #6,
2024-08-03, declaring one finding. It is handled, but it was never worth 93 bodies.

**Era 1 is two shapes, not one**, and the prompt's 75 is exactly right: 11 bold-title
(2024-08 → 2024-09) plus 64 single-italic (2025-04 → 2025-08). They need separate
handling — one has no header line at all.

**Three tiers the prompt does not list**: 🟡 Minor comments (95), 🛑 Comments failed
to post (21), and the `Additional comments not posted` wording of the additional tier.
`failed-to-post` also uses a **bare** locator (`62-75:`, no backticks) and 2024 uses a
**prefixed** one (``Line range hint `4-15`:``) — three locator shapes, not one.

**I made the exact bug this PR is about, while writing this PR.** The first version of
`CR_TIERS` matched the combined title *with its comma*, against a string that
`headerWords` had already stripped punctuation from. The section matched no tier — and
an unmatched section contributes **neither its findings nor its declared count**, so
the shortfall check that exists to catch this reported a clean **0 of 0**. That is why
`codeRabbitReviewSections` now returns `unrecognised` and the audit prints it: the
denominator alone does not protect you when a section can remove itself from the
denominator too.

## The four decisions

**1. The blocking-only filter goes at the caller.** The parser returns what CodeRabbit
wrote; `harvestPr` states the corpus policy in its own code. `harvest.test.mjs`'s test
named for the old behaviour is requalified against `harvestPr` rather than deleted.

The policy is unchanged. **The input is not, and that is the point** — `harvestPr` now
sees blocking findings behind two-field headers it previously could not read: **716
inline blockers repo-wide, up from 436** (+280 = the 245 major + 35 critical carried by
the two-field vintage). It files no non-blocking finding, which is what the test holds.

**2. An unrecognised severity becomes `""`, not `major` and not `nit`.** The mapping
(`trivial` → `nit`) is the easy half; the default is the decision. `major` files nits
as blockers — today's bug. `nit` silently demotes a real blocker the day CodeRabbit
adds a word. Both are silent. `""` is not: `BLOCKING.has("")` is false, so the finding
is **withheld** rather than guessed into the corpus, which is the recoverable
direction, and `severityRaw` carries what CodeRabbit actually wrote so the gap is
nameable. Per decision 17, this lives in the CodeRabbit adapter — **`severity.mjs`'s
`KNOWN` is untouched**, because it is the shared source of truth for what blocks a PR
in *our* panel and our lenses never emit `trivial`.

**3. The four review-body tiers are four populations, and the tier is preserved on
every finding.** No tier is excluded. A ♻️ Duplicate is the same defect said twice and
double-counts any volume metric; ⚠️ Outside diff range is about code the PR did not
touch. A scorer can pool later; it cannot unpool.

**4. Inline comments and review-body findings do not overlap.** Measured, not assumed —
both carry a `<!-- cr-comment:v1:<hash> -->` fingerprint:

- **684 inline fingerprints, 452 review-body fingerprints, 0 shared.**
- On the un-fingerprinted majority, by `(pr, normalised bold title)`: **12 of 1623
  review-body findings (0.7%)** coincide with an inline finding — and **all 12 are in
  the `duplicate` tier**, which is what that tier means.

So the two counts **add**. A consumer deduping should drop the `duplicate` tier, or
match on `(pr, title)`; the tier is on the finding so it can.

## Fail directions

- **The review-body parser degrades to fewer findings and never throws.** An unclosed
  `<blockquote>` keeps the rest of the body rather than dropping it; a body of the
  wrong type returns an empty findings array.
- **`auditCodeRabbit` catches each endpoint separately.** Losing `pulls/{n}/reviews`
  costs the review-body counts and leaves the inline ones intact.
- **An unrecognised severity is withheld, not guessed** — no row written, so a later
  harvest re-proposes it once the vocabulary is mapped. A wrong row, once curated, is
  permanent.
- **An unrecognised tier section is reported, not skipped.** CodeRabbit has introduced
  four tier names here already, and an unknown one is otherwise indistinguishable from
  a review that found nothing.
- **Every count carries its denominator.** `parseCodeRabbitReview` returns `declared`
  and `shortfall` beside `findings`; the CLI refuses to print a recovery rate without
  the total it is a fraction of, and names each short review rather than summing them.

## Explicit non-goals

- **No mapping into the normalised finding record.** PR 7 owns that record and it does
  not exist yet. Nothing here imports from `scripts/agent/eval/`.
- **`trivial` was not added to `severity.mjs`'s `KNOWN`.** That would change gate
  arithmetic for our own panel, which no CodeRabbit change should ever do.
- **`harvestPr` does not consume review bodies.** It still reads inline comments only.
  Wiring the review-body tiers into the candidate corpus is a policy change about what
  the corpus is, and it belongs with the record schema, not here.
- **No author or login check was loosened.** `CODERABBIT_LOGINS` and `PANEL_LOGINS` are
  untouched; the audit re-checks the login on every comment and every review.
- **No cross-arm matching, no panel/gate/lens/`clusterFindings` change.**

## Verification

- [x] **`agent:tests` lane, its own command**, `node --test '**/*.test.mjs'` from
      `scripts/agent`, **no `node_modules` present**, from the committed tree:
      **1346 tests / 1340 pass / 0 fail / 6 skip**.
      Baseline measured myself on `upstream/main` (`e2883c040`), same command, same
      absent `node_modules`: **1331 / 1325 / 0 fail / 6 skip**. **+15 tests, no new
      skips.** (The 6 skips are the documented pair: 1 without the Agent SDK, 5 in
      `lint-config.test.mjs` without a root install.)
- [x] **`npx eslint scripts` exits 0**, clean, at the lockfile-pinned `9.24.0`.
- [x] **Before/after measured against the live API**, all 638 PRs: **436 → 3111**.
      Inline 1485 of 1891 CodeRabbit comments; review bodies 1626 of 1626 declared.
- [x] **Per-vintage counts** — table above, both endpoints separately.
- [x] **Recovery against each review body's own declared count: 100.0%**, 1626 of
      1626, **0 sections short**. Verified at finer granularity too: all **1243
      per-file sub-sections** match their own declared count exactly.
      `unrecognised` is empty across all 638 PRs after the two housekeeping sections
      (`🧬 Code Graph Analysis`, `🧰 Additional context used`) were enumerated.
- [x] **A real fixture per header vintage and per section-title vintage**, each a
      verbatim slice of an API response pinned with its PR and comment/review id.
- [x] **`harvestPr` files no non-blocking finding**, held by
      *"harvestPr: keeps ONLY blocking CodeRabbit findings"*.
- [x] **No `trivial` reaches `normalizeSeverity`**, held by a test that also asserts
      `normalizeSeverity("trivial") === "major"` so the trap stays visible.
- [x] **12 mutations, each red on the right test**, then restored green at 88:
      three-field-only regex (6 red) · drop the combined title (1) · trivial through
      `normalizeSeverity` (3) · remove the caller filter (1) · default unknown severity
      to major (2) · non-counting blockquote scan (2) · drop the bare locator (5) ·
      drop the `Line range hint` prefix (1) · drop the emoji-shortcode strip (1) · drop
      the effort vocabulary (3) · silently skip an unknown tier (1) · stop counting the
      denominator (3).
- [x] **`--audit` run against the live API**: #692 `inline 5/8 · review-body 2/2` ·
      #435 `0/0 · 2/2` · #6 `2/2 · 15/15` · #477 `0/0 · 9/9`.

**Not verified:** whether the 1626 review-body findings are useful *as corpus
candidates* — none is filed, and that judgement belongs with the record schema.
