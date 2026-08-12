# Read a CodeRabbit finding's title from prose, never from quoted code

*Follow-up to the CodeRabbit parser work in #714 and #719. It changes one field on
one arm's findings — `summary` — and touches neither the header vintages nor the
prose boundary those two established.*

CodeRabbit quotes the shell commands it runs, and `**` is ordinary shell syntax.
The title search read the whole body, so on 28 findings the first `**…**` it found
was a glob out of an `rg` invocation rather than a sentence.

## The problem

`classifyCodeRabbitComment` took a finding's title as the first bolded span
anywhere in the comment body:

```js
const title = /\*\*(.+?)\*\*/s.exec(text)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
```

`parseCodeRabbitReview` had its own copy of the same regex over a finding's span.

A CodeRabbit body is mostly not prose. It carries the web queries it ran, the shell
transcripts, a committable suggestion and a `🤖 Prompt for AI Agents` block, and all
of those are fenced code. `**` is a glob in `sh` and a quantifier in a regex, so a
fenced command contains bolded-looking spans that are not emphasis.

**Comment 3651715274 (#549), 9224 bytes**, on
`packages/notes/src/view/list-empty-bullet-plugin.ts:202`. Its prose ends at offset
54. The first `**…**` in it is at offset **2183** — 2129 bytes further on, inside a
fenced block inside `<details>`:

```
rg -n '"markdown-it"' -S . --glob '!**/node_modules/**' --glob '!**/dist/**'
```

so the finding's `summary` was the string **`/node_modules/`**. The title CodeRabbit
actually wrote is in the same body, below the analysis block:

> **Pin the markdown-it dependency or switch to the public `getRules()` API.**

The failure was not a crash. It was a *plausible-looking* summary that travelled all
the way into a human adjudication pass over `pilot-01__k2`, where that one record
scored 0.46–0.75 against six different panel findings **on location alone** and
produced **6 of the 23 pairs at or above 0.70** — 26% of the adjudication shortlist.
All six were marked `unsure`, with the note *"CodeRabbit finding only contains file
path and no explanation."*

### How big it is, measured rather than estimated

Over **all 2061 CodeRabbit inline comments and all 614 review bodies** in this
repository, 2026-08-12:

| population | findings | wrong titles |
|---|---|---|
| inline comments | 1588 | **28** |
| review bodies | 1693 | **1** |

The 28 are not all short globs. Several are multi-kilobyte: the summary on comment
2911274299 (#27) is 1.4 KB of shell transcript, and 3746536596 (#740) carries an
embedded Python script. Those strings were reaching `summaryTokens`, `findingKey`
and the verifier prompt as a finding's one-line title.

## The change

One exported function, used by both readers:

```js
const CR_NON_PROSE = /```[\s\S]*?```|<!--[\s\S]*?-->/g;

export function codeRabbitTitle(body) {
  const prose = str(body).replace(CR_BLOCKQUOTE_PREFIX, "").replace(CR_NON_PROSE, "\n");
  return /\*\*(.+?)\*\*/s.exec(prose)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}
```

The search stays over the whole body and becomes blind to the two spans where a
`**` is markup. `classifyCodeRabbitComment` and `parseCodeRabbitReview` both call
it, so the two paths cannot drift apart again — that they each had their own copy
of the regex is why the review-body path could have regressed on its own.

### Why not stop at the first structured block

That was the obvious alternative — reuse `CR_PROSE_END`, the boundary
`codeRabbitDetail` already applies — and it is **strictly worse**. A narrower search
can only ever return *less*, so it cannot correct a wrong title; it can only delete
one. Measured over the same 1588 inline findings:

| | summaries changed | repaired | deleted |
|---|---|---|---|
| stop at the first block | **200** | 0 | **200** |
| skip fenced code (shipped) | **28** | 28 | 0 |

Every one of the 200 went from a real title to `""`, including
`"CORS FRONTEND_URL Validation Missing"` (#11) and `"Avoid side effects inside the
`setDefinition` updater callback."` (#21). On the record that motivated this work it
would have replaced `/node_modules/` with `""` while the real title sat unread.

The reason is a false premise in `CR_PROSE_END`'s own comment, which this PR
corrects in place: it claimed *"prose never resumes after the first block"*, verified
against #548, #594 and #639. **200 of the 1588 inline findings — 12.6% — open with a
`🧩 Analysis chain` `<details>` block and state their title and prose after it**, back
to #11 in 2025-04. All three pull requests it was verified against post-date that
vintage, so none of them could show it.

## Corrected while building

- **The premise this task was scoped on was wrong.** It was written to bound the
  title at `CR_PROSE_END` on the belief that comment 3651715274 has no title at all
  and that bounding is a pure fix. The comment has both a title and prose; they sit
  after the analysis block. Bounding would have been a regression on 200 findings,
  and measuring it first is the only reason that is not what shipped.
- **The review-body title must be read from the raw span, not the de-locatored
  copy.** The first attempt passed both `summary` and `detail` the same
  locator-stripped text, which reads as the tidier choice. `CR_LOCATOR`'s third
  group is `(.*)$` — the whole rest of the locator's line — and the 2024/2025
  vintages put the title *on* that line (``` `17-19`: **Add error handling** ```).
  So stripping the locator strips the title with it: it emptied **756 of the 1693**
  review-body findings. Caught by measuring the population, not by review; the
  fixture `RV_TITLE_ON_LOCATOR_LINE` now pins it.
- **`CR_NON_PROSE` must match lazily.** A greedy `[\s\S]*` runs from the first fence
  to the last, and the ordinary comment shape puts the title *between* two of them —
  analysis chain above, AI-agents block below — so a greedy match eats exactly the
  string the function exists to find. The first version of the regression fixture was
  trimmed down to one fenced block, which made that mutation survive because the
  fixture could not express the risk rather than because a test was missing.
- **The closing fence must be matched BY LENGTH** (raised in review on #801). A fence
  may legally contain a shorter one, and 81 of the 2061 inline comments open with four
  or more backticks — 35 of those wrapping a three-backtick run, which is the whole
  reason to open with four. A fixed ```` ``` ```` closer ends the span at the inner run
  and hands the rest of the block back to the title search as prose. It changes **no
  title in today's data** (0 of 1588 inline, 0 of 1693 review-body), so this hardens a
  shape that exists rather than fixing a live defect. Tildes are accepted for the same
  reason and are pure widening — CommonMark allows them, CodeRabbit has emitted none
  here (0 of 2061).
- **The anchor's one gap is deliberate, and bounded by a test.** Anchoring the fence to
  line start leaves an inline `` ```**x**``` `` span unstripped. Widening to inline code
  spans is NOT the fix: a real title routinely quotes a symbol, so stripping spans
  before the bold search deletes the identifier out of the middle of the title. Measured
  — 39 comments carry a mid-line backtick run, **none** with a `**` on that line, 0
  titles differ. The wrong fix reddens 6 tests, one of which exists only to say so.

## Fail directions

- **A body with no bolded span outside code yields `""`**, and nothing is
  substituted. A first-sentence fallback would manufacture a title CodeRabbit never
  wrote, and no consumer could then tell a manufactured one from a real one.
- **`""` is not inert downstream, which is an argument for not emitting it, not for
  inventing a value.** `findingKey` is `` `${file}::${summary}` ``, so every empty
  summary in one file collides on one key and `dedupeFindings` keeps one of them;
  and `findingSimilarity` scores two empty summaries at **1.00** against each other
  (`rounds.mjs:525`), so they merge into one defect class unless both are also
  anchorless. This change **emits zero new empty summaries** on either population.
- **Unbalanced fences degrade to today's behaviour.** An odd `` ``` `` has no
  closing partner, so `CR_NON_PROSE` does not match and the search sees the text as
  it does now — fewer removals, never more.
- **The counts cannot move.** `--audit` tallies findings, and a finding is counted on
  its header or its leading bold line, never on its title. Verified identical.

## Explicit non-goals

- **`codeRabbitDetail`, `CR_PROSE_END`, `CR_HEADER` and the blockquote strip are
  unchanged.** Only `CR_PROSE_END`'s *comment* changes, to stop asserting something
  the data contradicts. `detail` is byte-identical on all 1588 inline findings and
  all 1693 review-body findings.
- **No finding is dropped, filtered or reclassified.** The corpus census stays
  **30 in-window / 0 / 0**.
- **The empty `detail` on the analysis-chain vintage is left alone.** 200 of 1588
  inline findings carry `detail: ""` because `CR_PROSE_END` cuts at offset 0 for
  them. Fixing it would widen `detail` on ~1577 findings and move numbers #773 and
  #779 have already published, so it is recorded in the code and handed on rather
  than taken here.
- Nothing under `eval/` is touched. No adapter, no scorer, no threshold.

## Verification

- [x] **Tests: 1705 + 55 = 1760, 0 fail, 0 skipped.** Baseline on `upstream/main`
      at `d327ee4`, measured the same way in an identically-provisioned tree:
      **1696 + 55 = 1751**. `+9`. Two invocations, the shape the lane uses since
      #774 — everything except `eval/run.test.mjs`, then that file alone. Both
      trees carry the same `node_modules`, which is what holds the skip count at 0
      on each side.
- [x] `npx eslint scripts` exits 0 on the branch, and on the base tree.
- [x] **Every new test mutation-tested — 12 mutations, 11 caught, 1 deliberate.**
      Unbounding the title again reddens 4; stripping only comments reddens 3;
      stripping only fences reddens 1; a greedy `CR_NON_PROSE` reddens 2; giving the
      review-body path its own regex back reddens 1; reading its title from the
      de-locatored copy reddens 1; a first-sentence fallback reddens 2. From the
      review round: a fixed-length fence closer reddens 2, dropping tildes reddens 1,
      an exactly-three opener reddens 1, and stripping inline code spans — the wrong
      way to close the anchor gap — reddens 6. **Dropping the line anchors survives**,
      and that one is a documented trade-off rather than a missing test: it is
      behaviour-changing on a synthetic inline-code-span shape that occurs 0 times in
      2061 comments, and the alternative corrupts every title that quotes a symbol.
- [x] **Comment 3651715274 now yields the real title**, against the live body
      fetched from the API: `"Pin the markdown-it dependency or switch to the public
      `getRules()` API."`, where `upstream/main` yields `"/node_modules/"`.
- [x] **`--audit` recovery counts are unchanged**, per PR and in total, over the 7
      corpus PRs with the endpoint payloads held fixed: `inline 16/22`,
      `review-body 14/14`, and every per-vintage and per-severity tally identical.
- [x] **Corpus impact: 1 of the 30 records changes** — comment 3651715274 — and its
      `finding_key` changes with it. `detail` moves on none. No record gains an
      empty summary. Census still `30 / 0 / 0`.
- [x] **Population impact: 28 of 1588 inline findings and 1 of 1693 review-body
      findings**, all 29 from markup to a real title; 0 emptied, 0 `detail` changes,
      0 findings gained or lost.
- [x] Verified from the **committed tree** (`git archive` of the branch), not the
      working copy.
- [ ] **Not verified: whether any of the 29 repaired titles changes a downstream
      score.** Nothing consumes a CodeRabbit finding record yet on the scoring side
      except `volume-mix`, which reads counts and never `summary`. This is expected
      to move no published number today.
