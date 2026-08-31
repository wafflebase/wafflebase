---
title: agentic-dev-loop
target-version: 0.6.7
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# The Agentic Dev Loop

## Summary

Between 2026-07-21 and 2026-08-25 this repository grew a loop that takes work from
*somebody noticed something* to *a pull request a human merges*. Nine components do
it, and there has been no single place that says what they are.

This is that place, and it is only that. It does not explain why any of it is shaped
the way it is — [`harness-engineering.md`](harness-engineering.md) owns the
phase-by-phase design, and each subsystem doc owns its own reasoning. Read this to
find the right door; read the linked doc before you disagree with a decision made
behind it.

Two invariants come first, because most of what follows descends from one of them:

- **Nothing merges without a human.** No workflow here can approve or merge. The
  terminal states are *ready for review*, *paged for a human*, or *filed*.
- **The components that generate their own candidates file nothing.** Both hunters
  produce a local report and stop. Only work a person started can open an issue or
  a pull request.

## Goals / Non-Goals

**Goals.** Give a reader one entry point to nine components. Make "is this new, or
has it been here a while?" answerable without reading `git log`. Say which parts can
be run, and how. Name the gaps, including the one subsystem with no design doc.

**Non-Goals.** Restating any component's design — every row in the map names where
its design lives, and that is the point of the row. Being a changelog: the timeline
records first, last and count per component, not commits. The human contributor's
workflow, which is [`CONTRIBUTING.md`](../../CONTRIBUTING.md). And operating
detail: [`hunter-usage.md`](hunter-usage.md) and
[`design-editor-running.md`](design-editor/design-editor-running.md) are the
operator guides.

## Proposal Details

### 1. The components

| Component | Entry point | Code | Design |
| --- | --- | --- | --- |
| CLI hunter | `/hunt` — `.claude/commands/hunt.md` | `scripts/agent/hunt.mjs`, charters in `scripts/agent/charters/` | [`hunter-usage.md`](hunter-usage.md) + harness Phase 26 |
| UI hunter | `/hunt-ui` — `.claude/commands/hunt-ui.md` | `scripts/agent/hunt-ui.mjs`, personas in `scripts/agent/charters-ui/` | [`hunter-usage.md`](hunter-usage.md) + harness Phase 31 |
| Issue → PR | `@claude fix` on an **issue** | `.github/workflows/agent-implement.yml`, verb parsed by `scripts/agent/command.mjs` | harness Phase 24 |
| Spec → PR | `/spec-to-pr` — `.claude/commands/spec-to-pr.md` | `scripts/agent/spec-to-pr.mjs` | harness Phase 25 |
| Design → code | `pnpm design`, then `pnpm design-pr` | `scripts/design.mjs`, `scripts/design-pr.mjs`, `packages/design-editor`, `packages/design-sandbox` | [`design-editor-local-plugin.md`](design-editor/design-editor-local-plugin.md) — start there |
| Debug reporter | `Mod+Shift+Y` in the running app, then `/report-intake` | `packages/debug-report`, `scripts/agent/report-intake.mjs` and its siblings | [`debug-report.md`](debug-report.md) + harness Phase 32 |
| Review panel | automatic on an `agent/` branch; `@claude review` on demand | `.github/workflows/agent-review-panel.yml`, `scripts/agent/review-panel.mjs` | harness Phases 24, 27, 28, 29 |
| Fix agent | `@claude fix` on a **PR**; also automatic within a panel round | `.github/workflows/agent-fix.yml`, `scripts/agent/fix-eligible.mjs` | harness Phase 30 |
| Eval / benchmark | `eval-replay` and `eval-score`, dispatch only | `scripts/agent/eval/` | **none** — see §4 |

### 2. Where work comes from

Five ways in. The last column is the one that matters most.

| Channel | Started by | Produces | Files anything by itself |
| --- | --- | --- | --- |
| An issue | a maintainer commenting `@claude fix` on an issue | a draft PR on an `agent/` branch | yes — the PR it was asked for |
| A spec | a developer, locally, through Claude Code | the same draft PR, pushed from their machine | yes — same |
| A design edit | anyone who can run the editor, including non-developers | edits in their own working tree, then a PR | only when they run `pnpm design-pr` |
| An on-screen report | a person who noticed something while using the app | a confirmed bundle on disk, then PRs or issues | **no** — nothing leaves until the reporter confirms |
| Machine exploration | a hunter run, on demand | a local report of verified findings | **no** — by construction |

The last two are the ones people conflate. The debug reporter carries what a
*person* noticed and needs their confirmation; the hunters carry what a *machine*
noticed and cannot file at all. They are not tiers of the same thing — the
reporter's ground truth is a sentence a human wrote, the hunter's is a prediction
that trusted code checked.

### 3. When each piece landed

First and last merged PR, and how many merged commits touched each area. Counts are
assigned to one primary area, so they sum rather than double-count shared files.

| Component | First | Last | Commits | Recorded in |
| --- | --- | --- | --- | --- |
| Issue → PR + the workflows | 2026-07-21 (#501) | 2026-08-25 (#965) | 48 | `docs/tasks/archive/2026/07/20260720-autonomous-issue-to-pr-pipeline-todo.md` |
| Review panel + lenses | 2026-07-22 (#508) | 2026-08-24 (#953) | 48 | `docs/tasks/archive/2026/07/20260731-panel-feedback-corpus-todo.md` |
| Spec → PR | 2026-07-28 (#559) | 2026-07-28 (#559) | — | `docs/tasks/archive/2026/07/20260724-local-spec-to-pr-pipeline-todo.md` |
| The two hunters | 2026-07-30 (#588) | 2026-08-20 (#906) | 54 | `docs/tasks/active/20260729-autonomous-issue-hunting-todo.md` |
| Fix agent | 2026-08-05 (#672) | 2026-08-19 (#894) | — | harness Phase 30 |
| Eval / benchmark | 2026-08-06 (#677) | 2026-08-24 (#951) | 35 | `docs/tasks/archive/2026/08/20260805-eval-corpus-skeleton-todo.md` |
| Design → code | 2026-08-08 (#701) | 2026-08-25 (#966) | 37 | `docs/tasks/active/20260729-design-editor-layout-sandbox-todo.md` |
| Debug reporter | 2026-08-24 (#946) | 2026-08-25 (#961) | 4 | `docs/tasks/archive/2026/08/20260821-debug-report-todo.md` |

36 days, 269 merged commits over the union of those paths. The review panel and the
hunters dominate the count, and both for the same reason: their output is judged by
a model, so most of the work is in the apparatus that decides whether to believe it.

**One week of `git log` is misleading.** Between 2026-08-11 (#769) and 2026-08-14
(#850) the pipeline was moved out to a separate repository, read through a vendored
copy, and then brought back. Commits in that window are mostly about the move rather
than about behaviour.

---

## The agent pipeline

### The shared back half

Every channel converges on the same machinery:

```text
  issue · spec · design edit · report · (hunter → a human decides)
                        │
                        ▼
            branch  +  DRAFT pull request
                        │
        ┌───────────────┴───────────────┐
        ▼                               ▼
       CI                        review panel          ← concurrent, not sequential
   (verify lanes)          (6 lenses, 1 check run each)
        └───────────────┬───────────────┘
                        ▼
                 blocking findings?
                   │           │
                  yes          no
                   ▼           ▼
              fix agent      promote → ready for review
            (bounded rounds)        │
                   │                ▼
        rounds exhausted →  ┌──────────────────┐
             page a human   │  a human merges  │
                            └──────────────────┘
```

Four facts about it are load-bearing and easy to get wrong:

- **The panel runs concurrently with CI, not after it.** Starting it when CI starts
  rather than when CI finishes is what keeps a round inside one wall-clock window.
- **Six lenses, all blocking** — `correctness`, `security`, `design-fit`,
  `test-adequacy`, `blast-radius`, `docs` — each recording its own
  `agent-review-<lens>` check run, so a verdict cannot be forged by the branch under
  review. Configured in `scripts/agent/lenses/lenses.json`.
- **The fix loop is bounded.** When rounds are exhausted the PR is paged for a human
  rather than retried, and it stays latched until someone clears it.
- **A paged PR needs `@claude rerun`.** Pushing a commit is not enough; the latch is
  deliberate.

### The `@claude` verbs

**`@claude fix` reaches two different workflows and never both.**
`.github/workflows/agent-implement.yml` gates on `!github.event.issue.pull_request`;
`.github/workflows/agent-fix.yml` gates on the presence of it. So the same verb means
*plan and implement this issue* on an issue, and *make one fix attempt against the
panel's standing verdict* on a pull request. This is the most confusable fact in the
loop.

| Verb | Where | Serves |
| --- | --- | --- |
| `@claude fix` | an issue | `agent-implement.yml` — plan, implement, open a draft PR |
| `@claude fix` | a PR | `agent-fix.yml` — one fix attempt against the standing verdict |
| `@claude review` | a PR | `agent-review-on-demand.yml` — advisory, no check runs, works on forks |
| `@claude summarize` | a PR | `agent-summarize.yml` — read-only, throttled per head SHA |
| `@claude loop` | a PR | `agent-loop.yml` — opt into the autonomous machinery, same-repo only |
| `@claude rerun` | a PR | `agent-rerun.yml` — clear the paged latch and re-engage |

[`CONTRIBUTING.md`](../../CONTRIBUTING.md) documents these for contributors, but its
table omits `@claude fix` on a pull request and `@claude rerun` entirely, even though
`scripts/agent/command.mjs` recognises both.

### The hunters

Two slash commands, and the only components here that generate their own candidates.
A model proposes what might be broken; trusted script code runs the probe, replays it
for determinism, and decides whether to report it. Neither files anything — the
output is a local report.

[`hunter-usage.md`](hunter-usage.md) is the operator's guide, and the place to start:
prerequisites, what a run costs, how often a run finds nothing, and how to read what
comes back.

### The debug reporter

The channel for a defect a *person* noticed, so it runs inside the app rather than
from a terminal. The DEV-only harness routes need no login and no backend:

```bash
pnpm frontend dev
# then http://localhost:5173/harness/hunt?surface=sheet
```

`Mod+Shift+Y` turns the overlay on and the badge that appears lists the keys. Nothing
leaves the browser until a batch is confirmed in the preview panel. `/report-intake`
then takes that confirmed bundle through verification and PR assembly — and opens
nothing on its own, so reading its plan is a step, not a formality.

### What has no design doc

**The eval / benchmark rig.** `scripts/agent/eval/` replays a frozen corpus of past
pull requests through the real review panel K times and scores the result — volume
and mix, complementarity against a second reviewer, reliability across replicates,
segmentation, validity, cost and latency. `eval-replay` is the one workflow whose whole
purpose is to spend model budget — every other model call in the loop is a side
effect of reviewing or implementing something — which is why it is dispatch-only and
takes a required cost cap.

It has no *design* document. [`eval-harness-usage.md`](eval-harness-usage.md) is an
operator's guide — what to type, what it costs, how to read the report — not a record
of intent. The reasoning still lives in `scripts/agent/eval/README.md`, and the spec
its scorers cite by section number lives in a separate repository, not in this tree.

---

## Design → code

The editor renders this application's **real** routes from real component source, and
writes edits back into the `.tsx` and design-token files they came from. It is the
one part of wafflebase that runs standalone: its scenes answer their own data requests
from fixtures, so it needs no database, no Yorkie and no `docker compose`.

On a fresh clone it prepares pnpm, installs dependencies, and builds both the editor
and `@wafflebase/core`, then prints the URL to open. Every step is skipped when it is
already done, and a start that dies on a missing package installs once and tries
again:

```bash
pnpm design
```

Edits land in your own working tree, so `git diff` shows exactly what changed. Then:

```bash
pnpm design-pr
```

turns those edits into a pull request using the `git` and `gh` already on your
machine — this project stores no credential and forwards none. It commits only the
files the editor recorded writing, never commits on `main`, and never force-pushes.

**c.f.** the scene frame is a second host for the bug reporter, so a defect noticed
while restyling a page can be reported without leaving the editor:

```bash
VITE_WB_DEBUG_REPORT=1 pnpm design
```

Off unless asked for, read once per frame load, and the pointer has to be over a
scene when the hotkey is pressed — `design-editor-running.md` §5 explains why the
editor's own chrome is not reportable this way.

Design starts at
[`design-editor-local-plugin.md`](design-editor/design-editor-local-plugin.md);
[`design-editor-running.md`](design-editor/design-editor-running.md) is the operator's
guide for when it boots but shows the wrong thing.

## Walkthroughs you can open

`docs/design/agentic-dev-loop/` holds two standalone HTML pages covering the **design
editor and the debug reporter** in more depth than the map above — one explaining what
each does and why it is built that way, one a step-by-step to follow while running
them. Both are in Korean.

Serve the repository root, so the screenshot the first page references resolves:

```bash
python3 -m http.server 8080
# → http://localhost:8080/docs/design/agentic-dev-loop/
```

Opening the files directly with `file://` works too.

## Risks and Mitigation

**The eval rig is undocumented where it matters.** Anyone changing a scorer works
from `scripts/agent/eval/README.md` and a spec in another repository, with no design
doc to check an intent against. *Mitigation:* none yet — §"What has no design doc"
states it so the gap is findable rather than discovered by surprise.

**Two verb tables can disagree.** The table above is complete;
[`CONTRIBUTING.md`](../../CONTRIBUTING.md)'s is not. Two tables covering the same
surface is the condition for one of them being trusted wrongly. *Mitigation:*
recorded here rather than silently left; reconciling `CONTRIBUTING.md` is deliberately
out of scope for this document.

**The counts and dates here go stale.** They are derived from `git log` at one moment.
*Mitigation:* the document holds no design and no thresholds, so a count that drifts
by a few misleads nobody about behaviour. The paths are the load-bearing part, and
those are checked mechanically — `verify:doc-links` walks every relative link and
`verify:entropy` requires every path named in backticks to be a tracked file, so a
moved file fails a lane instead of quietly misdirecting a reader.
