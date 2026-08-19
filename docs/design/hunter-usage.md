---
title: hunter-usage
target-version: 0.6.4
---

# Running the Issue Hunters

Two autonomous defect hunters live in `scripts/agent/`. Both drive the real product,
propose candidate defects, verify them independently, and write a local report.

| | CLI hunter | UI hunter |
|---|---|---|
| entry point | `scripts/agent/hunt.mjs` | `scripts/agent/hunt-ui.mjs` |
| what it drives | the `wafflebase` CLI, as argv probes | a real browser on `/harness/hunt` |
| slash command | `/hunt` | `/hunt-ui` |
| design | [harness-engineering.md](harness-engineering.md) Phase 26 | Phase 31 |

**Neither files an issue.** Both write a report so precision can be measured before any
maintainer attention is spent. Filing is a human decision, and the section on
[what to do with a finding](#what-to-do-with-a-finding) matters more than the rest of
this document.

## Summary

This is the operator's guide: prerequisites, commands, what a run costs, and how to read
what comes back. It does **not** explain why the gates exist — that is
`harness-engineering.md`, and it is worth reading before you disagree with a result.
The `/hunt` and `/hunt-ui` slash commands are the same workflow written as instructions
to Claude Code; this document is the same thing for a person.

## Goals / Non-Goals

**Goals.** Get a new operator from a clean checkout to a report they can act on, with an
honest expectation of cost and of how often a run finds nothing.

**Non-Goals.** Explaining the grounding tiers, the verifier panel, or the gate. Those are
design, they are documented, and changing them without reading that document is how the
expensive lessons get re-learned.

## Prerequisites

Both hunters call the Claude Agent SDK, which is **deliberately not a workspace
dependency** — `agent:tests` runs with `scripts/agent/node_modules` absent, so the SDK is
imported lazily and installed separately:

```bash
cd scripts/agent && npm ci
```

And a credential in the shell that runs the hunter — either works:

```bash
export CLAUDE_CODE_OAUTH_TOKEN=…      # or
export ANTHROPIC_API_KEY=…
```

Keep it out of your shell history and out of the repository. A token pasted into a
terminal that a transcript captures is a leaked token.

**Always run `preflight` first.** It checks both of the above plus the charter manifest,
returns before the SDK is imported, and costs nothing:

```bash
node scripts/agent/hunt.mjs preflight        # CLI hunter
node scripts/agent/hunt-ui.mjs preflight     # UI hunter
```

The UI hunter additionally needs the frontend to build — it boots Vite and Chromium
itself, and needs no backend and no database. If `pnpm install` has not been run since
you last pulled, do that first; a stale install surfaces as unrelated type errors.

## The CLI hunter

```bash
node scripts/agent/hunt.mjs run [--charter <id>]... [--out <dir>] [--repo <dir>]
                                [--samples N] [--ledger <file>] [--run-id <id>]
node scripts/agent/hunt.mjs report --out <dir>
```

Charters are the areas it may hunt: `contract`, `crash`, `round-trip`, `state`. Each
declares its own oracles, code scope and severity floor. With no `--charter` the manifest
default runs.

```bash
node scripts/agent/hunt.mjs run --charter contract --out /tmp/hunt-1
```

## The UI hunter

```bash
node scripts/agent/hunt-ui.mjs run [--charter <id>]... [--surface <doc|sheet|slides>]...
                                   [--out <dir>] [--repo <dir>] [--ledger <file>]
                                   [--coverage <file>] [--run-id <id>] [--fault <id>]
node scripts/agent/hunt-ui.mjs replay --plan <file.json> [--attempts N]
node scripts/agent/hunt-ui.mjs report --out <dir>
```

Three personas, each with two briefs — one per surface, which
`hunt-ui.test.mjs` enforces: a surface nobody explores makes its reader list dead weight.

| persona | surface | briefs |
|---|---|---|
| `doc-writer` | `doc` | `body-and-styles`, `structure-and-links` |
| `sheet-author` | `sheet` | `values-and-formulas`, `navigation-and-selection` |
| `slide-author` | `slides` | `arrange-and-order`, `content-and-undo` |

A persona names its own surface, so `--surface` narrows what a named charter may run
rather than selecting something to hunt on its own.

The slides surface has **no drag action**, because the action vocabulary has none
(`goto | click | type | key | scroll | read | wait`). Toolbar controls, keyboard nudge,
z-order, alignment, slide operations and text editing are all reachable; move, resize,
rotate, connector drawing and crop are not. A brief that asks for the second group will
produce failed actions, not findings.

Naming one persona runs its briefs only, which is the normal case:

```bash
node scripts/agent/hunt-ui.mjs run --charter doc-writer --surface doc \
  --out /tmp/hunt-ui-1 --coverage .hunt/coverage.json
```

### `--coverage` is not optional in practice

The hunter remembers what each persona has already tried — which controls, on which
selection shapes, and which it round-tripped rather than merely clicked — and uses it to
push the next run somewhere new. That memory lives in the file `--coverage` names.

**It defaults to `<out>/coverage.json`.** A fresh `--out` per run therefore starts with an
empty memory every time, and the feature does nothing at all. Point it at a stable path:

```bash
--coverage .hunt/coverage.json
```

The same argument applies to `--ledger`, which suppresses defects already assessed.

### `--fault` is a positive control, not a hunt

`--fault <id>` injects a known defect so you can confirm the pipeline still detects
anything. A seeded run deliberately writes **neither** the ledger nor the coverage file:
its findings are fabricated, and letting one claim a control was explored would suppress
that control for the next real run.

## What a run costs

Measured across the runs in this repository's history, not estimated:

| persona | typical | range |
|---|---|---|
| `sheet-author` | **~$2.10** | $2.01 – $2.17 |
| `doc-writer` | **~$6** | $3.93 – $7.65 |

Wall-clock runs roughly 5–25 minutes and tracks cost. A doc run that proposes two
candidates costs about twice one that proposes none, because **the verifier panel is
~60% of the bill**: every candidate is judged by two independent verifiers, and each
reads source to locate the cause.

So the cost driver is *candidates proposed*, not actions taken. A run that explores 100
actions and proposes nothing is the cheap case.

Since #835 each completed action prints a line, so a live run is not a black box:

```
hunt-ui:   doc-writer/body-and-styles [15/80] #14 click Bold ok · held
```

The bracketed budget is what separates "working through a long brief" from "stuck": it
climbs in the first case and stalls in the second.

## Reading the report

`<out>/report.md` is written at the end of a run. Read it in this order.

**1. Personas that did NOT run.** A zero means nothing until you know something executed.
A brief can die on a session error or a turn ceiling, and that section is the difference
between "explored and found nothing" and "never got to answer".

**2. The funnel.** `proposed → unique → novel → reproduced → reported`, plus the drops:

| stat | what it means |
|---|---|
| `actionRefusals` | actions the harness refused — off-screen cell, wrong surface |
| `refutedAfterReplay` | reproduced, then rejected by the panel |
| `splitPanel` | **one verifier confirmed and the run still reported nothing** — read the drop table |
| `ungroundedRefutation` | a refutation that would not have cleared its own confirmation's bar |
| `scopedTitleDisagreement` | the verifiers scoped the finding differently; reconcile before filing |
| `collapsedDuplicate` | a candidate merged into another as the same defect |
| `overclaimed` | the verifiers had to narrow the hunter's title |

**3. The drop table**, which names every candidate that did not make it and why. This is
where a real defect that lost a coin toss will be, and `splitPanel > 0` is the signal to
look hard.

**A zero-report run is a normal outcome.** Most runs report nothing. The design is
precision-over-recall on purpose: a false positive costs a maintainer's attention, a false
negative costs nothing because the next run looks again.

## Reproducing a finding

Every reported UI finding carries an action plan, replayable with no model and no API key:

```bash
node scripts/agent/hunt-ui.mjs replay --plan <out>/<persona>/repro-1.json
```

That is the point of the plan: a repro nobody can run without a credential is not a repro.

## What to do with a finding

**Verify it yourself before filing.** Across this repository's hunting history, every
issue that was filed needed a human to check the claim first, and several candidates that
looked strong were false — a stale reader description, a brief asserting something untrue
about the surface, a control name the harness could not actually click. The panel is good
and it is not sufficient.

Then, when filing:

- **Never label a hunted issue `agent:candidate`.** That label plus a non-Bot author is
  what lets the fix pipeline ingest a spec, and a hunter-filed `agent:candidate` closes
  that loop on itself. File unlabelled.
- **Do not use an `agent/` branch prefix** for hunter work. `agent-review-panel.yml`
  treats it as managed.
- **Narrow the title to the evidence.** The verifiers produce a `scopedTitle` for exactly
  this; when they disagree, the report says so and you choose.

## Risks and Mitigation

**A run costs real money and can find nothing.** Check the brief actually asks for what
you want tested before spending — a capability nothing points at is a capability nothing
exercises, which has cost several runs here. `dom.controls` and the coverage memory exist
to make that self-correcting, but the task text still steers.

**The memory does not travel.** `--coverage` writes a local file. A different machine or a
CI runner starts with an empty memory unless the file is shared deliberately.

**Descriptions can be wrong.** A reader whose description misstates what it returns
produces confident false findings — this has happened more than once, and it is the
failure mode with no mechanical guard. If a finding turns on what a reader "means", check
the reader.
