---
title: deck-critic
target-version: 0.6.15
---

# Deck Critic Lane

## Summary

[slides-lint.md](slides-lint.md) gave the deck-author loop its cheap,
deterministic checks. Issue #1112's dogfood showed what they cannot see: a
deck can be lint-clean and still have empty bottom halves, inconsistent
card padding, a line break inside "(58 / 174)", a plain cover, or a
dark-theme code panel that glares. It also showed a curation failure that
no geometry rule could catch (19 people on 4 dense slides, where a human
picked 8 and gave each a slide), and three bugs that existed only in the
exported PPTX.

This adds a **design-critic lane** to the loop. Following #1091's split,
the primitives are in the repository and the orchestration is in the skill:

- **`packages/cli/skills/deck-critic.md`** — the critic's prompt: inputs,
  a ten-category rubric, `major` / `minor` with examples, the findings JSON.
- **`wafflebase slides critique-check`** — a deterministic check of one
  round: validates the findings, counts them by severity and category, and
  applies the stop rule. No network, no model.
- **`deck-author.md`** — runs the critic as an independent agent after
  render, for at most three rounds, and follows `critique-check`.

### Goals

- A critic independent of the author, judging rendered output only: the
  app render and the PPTX render, against the talk's brief.
- Findings in a fixed, machine-checked shape: `{ slideId, severity,
  category, problem, fix }`.
- Curation judged against the talk's intent (cut / merge / split), not the
  literal outline.
- Bounded rounds whose stop rule does not throw away every minor finding.
- A way to know when to trust the critic: calibration against human A/B
  labels.

### Non-Goals

- Calling a model from the CLI. The critic is an agent the deck author's
  runtime starts; the CLI only checks what it wrote.
- Replacing `slides lint`. Lint runs first and gates every pass; the critic
  runs on lint-clean decks.
- An automatic calibration score. The procedure is written down; the label
  set does not exist yet.

## Proposal Details

### Where it lives, and why

The rubric is in `packages/cli/skills/deck-critic.md`, next to
`deck-author.md` and mirrored into the plugin's `references/` by
`pnpm cli build:plugin` like every other CLI skill. This answers #1112's
open question. The rubric and the lint rules are two halves of one quality
bar: lint owns what geometry can decide, the rubric owns the rest, and the
line between them moves (a rubric item that proves mechanical becomes a lint
rule; a lint rule that keeps being allowlisted is really a judgement). Kept
in one directory they change in one pull request and are reviewed together;
a rubric living in a prompt elsewhere would drift from the rules it is
meant to complement, and a past critic round could not be read against the
rubric it was judged by.

The findings type, validator and stop rule are in
`packages/cli/src/slides/critique.ts`, beside `lint.ts`. They are CLI-only:
nothing in the editor or the slides engine reads a critique.

### Findings format

```json
{
  "round": 2,
  "findings": [
    { "slideId": "s7", "severity": "minor", "category": "alignment-spacing",
      "problem": "The left card has 32 px padding, the right one 48 px.",
      "fix": "Use 40 px in both." }
  ]
}
```

- `slideId` — the slide's id, or `"deck"` for a deck-wide finding (a run of
  same-shaped slides, a missing PPTX reader).
- `severity` — `major` | `minor`.
- `category` — `hierarchy`, `density`, `alignment-spacing`, `type-scale`,
  `contrast`, `visual-variety`, `faithfulness`, `curation`, `skill-rules`,
  `pptx-parity`.
- `problem`, `fix` — non-empty strings.

Unknown keys are refused rather than ignored: a misspelt `severty` would
otherwise drop a finding out of every count, and the stop rule runs on
counts. A bare array is accepted as `{ findings: [...] }`.

### The stop rule

Applied by `decideNextRound(current, previous, round, maxRounds)`:

| order | condition | verdict | reason |
| --- | --- | --- | --- |
| 1 | `round >= maxRounds` (default 3) | stop | `max-rounds`, `escalate` when majors remain |
| 2 | any major | continue | `major-open` |
| 3 | no findings | stop | `clean` |
| 4 | no majors; previous round had majors, or there is none | continue | `polish-round` |
| 5 | no majors; fewer minors than the previous round | continue | `minor-decreasing` |
| 6 | no majors; minors flat or rising | stop | `minor-plateau` |

Why rule 4: "stop at zero majors" would have ended the dogfood at round 2
with 13 minor findings unaddressed. Why rule 6: once the minor count stops
falling, the critic is trading one taste for another, and more rounds cost
time without converging. Why the cap wins: three rounds matches the
repository's own self-review loop, and a deck still carrying majors after
three is a human's call, which `escalate` says out loud.

The round number comes from `--round`, else the file's `round`, else the
previous file's `round + 1`, else 1, so a loop that keeps its files
numbered needs no flags beyond `--previous`.

### The PPTX render

`slides render` paints with the editor's renderer; a PPTX reader paints the
exported file. The two disagree exactly where export loses something, which
is why the dogfood found three bugs only there. The skill renders the export
with LibreOffice (`soffice --convert-to pdf`, then `pdftoppm`), the one
headless PPTX reader commonly available. `slides-author.md`'s warning
against `soffice` is about using it *instead of* the app render; here it is
the second surface, and the rubric tells the critic to separate file
problems (bold lost, a run broken onto two lines) from reader quirks (metric
differences of a substituted font).

### Calibration

A critic is a non-deterministic judge. Before its verdicts gate a loop, and
after any change to the rubric, check them against human labels.

**Where the precedent is.** The #1088 seed-template stack this work builds
on carries authoring *briefs* (`packages/backend/src/template/seed/catalog/
brief.ts`), not labels, so there is no A/B record to reuse there. The label
work that does exist is the review-panel benchmark's
(`scripts/agent/eval/labels.mjs`, [eval-harness-usage.md](../agent-pipeline/eval-harness-usage.md)
§4). This reuses its rules rather than its schema, which is keyed to pull
request diffs:

- **Blind.** The labeler never sees the critic's findings, severity or
  which side it preferred. A label written from the judge's own verdict is
  circular, and the failure has no symptom.
- **Tiered.** `gold` is a human reading blind. A model's reading is at most
  `silver`, and agreement is computed over `gold` only.

**The pairs.** Every critic round already produces them: for each slide a
round changed, the render before the fix and the render after it. The
critic's claim is that *after* is better. Curation findings produce deck-
level pairs (the 4-slide and the 8-slide version of the same section).

**The record**, one JSON line per pair in a file kept with the decks being
judged (they hold user content, so not in this repository):

```json
{ "pairId": "talk-2026-11/s7/r1-r2", "slideId": "s7", "category": "type-scale",
  "a": "r2/app/slide-7.png", "b": "r1/app/slide-7.png",
  "brief": "brief.md", "preferred": "a", "labelSource": "gold",
  "labeler": "<initials>", "note": "the number pair no longer breaks" }
```

`a` / `b` order is randomised per pair when the pair is shown; the record
keeps which file was which so the critic's side is recoverable afterwards.
`preferred` is `a`, `b` or `tie`.

**The numbers.**

- **Agreement**: of the non-tie `gold` pairs, the share where the human
  preferred the side the critic called better. Report it per category too —
  a critic can be right about alignment and wrong about curation.
- **Major precision**: for a sample of `major` findings, show the
  before-render alone and ask whether the human sees a problem worth
  stopping the talk for. Report the share that say yes.

**The bar.** At least 20 non-tie `gold` pairs, with agreement at or above
80% overall and no category below 60% with five or more pairs. Below the
bar, `critique-check`'s verdict is advice: the author still fixes majors
but a human decides when the deck is done. Record each calibration (date,
rubric commit, counts, the two numbers) in the deck-author task's lessons
file so the history travels with the rubric.

### Risks and Mitigation

- **The critic agrees with itself across rounds** and stops finding things
  because it is primed by its last answer. Each round starts a fresh
  context; `previous.json` is input for the stop rule's counts, and the
  skill does not ask the critic to re-check old findings.
- **Counts are gamed by splitting or merging findings.** The skill asks for
  one finding per problem per slide; the plateau rule uses the trend, which
  is robust to a constant bias.
- **LibreOffice is not PowerPoint.** The critic is told to separate file
  problems from reader quirks; a parity finding that turns out to be a
  reader quirk is a calibration data point for `pptx-parity`.
- **No labels yet.** Until the first calibration, treat the critic as
  advisory where it disagrees with the author's own read of the render.
