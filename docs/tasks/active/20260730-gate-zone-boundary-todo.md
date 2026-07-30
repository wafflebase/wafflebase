# Gate-zone no-touch boundary (shadow mode)

Name the files that decide whether a PR can be promoted, so an agent PR changing
**the gate** can be told apart from one changing **product code**. Prerequisite for
auto-merge; inert before it.

**Nothing here blocks anything.** It renders one advisory line.

## In this PR

- [x] `scripts/agent/gate-zone.mjs` — `GATE_ZONE`, `GATE_ENTRY_POINTS`, `NON_GATE`,
      `gateZoneHits`, `isMergeEligible`, `renderMergeEligibility`, plus `UNPUSHABLE`
      / `pathsMentionedIn` / `unpushableAsksIn`.
- [x] `metrics.mjs summarize` — a `Merge-eligibility (advisory, gates nothing)` row.
- [x] `agent-implement.yml` — advisory pre-flight for undeliverable asks.
- [x] `gate-zone.test.mjs` — including the import-closure anti-rot check.

## The gap this closes

`.github/workflows/**` is already unpushable by the App. **Every other file that
defines the gate is unprotected**, and the agent edits them routinely: #564 rewrote
`lenses.json` itself; #525/#526/#550 changed the orchestrator and round guard; this
series changed nine of them. `CODEOWNERS` covers them for *human* review — exactly
the control that disappears the day a human stops reviewing.

Safety under auto-merge comes from narrowing what is **eligible**, not from trusting
the reviewer more. Dependabot patch bumps are safe because the diff shape is
mechanically verifiable, not because something reviewed them well.

## Deviation from the plan: the list was stale

The plan's `GATE_ZONE` predates seven files that now decide the gate. Membership was
re-derived from what the promotion decision actually depends on:

| added | why it decides the gate |
|---|---|
| `ask.mjs` | owns `PERMITTED_TOOLS`. Widening it hands a model reading an untrusted diff the ability to execute — a bigger hole than any verdict rule. |
| `review-panel.mjs` | `isDroppingVerdict`, `keepUnrefuted`, `gatingFindings`, `panelEntry`. The plan omitted the orchestrator itself; without it the boundary is bypassable in one edit. |
| `novelty.mjs` | `DEMOTING_ORIGINS` — whether a finding gates **at all** |
| `citation.mjs` | what counts as evidence for a refutation |
| `review-state.mjs` + `review-scope.mjs` | whether code is reviewed at all |
| `gh-checks.mjs` + `prior-findings.mjs` | the gate's inputs from the checks API |
| `disclosure.mjs` | `mark-ready` gate 3 |

Including `review-panel.mjs` makes most pipeline PRs report ineligible. That is
**correct** — those are exactly the PRs a human should keep reviewing — and it is
survivable only because this ships in shadow mode.

## Why the list stays hand-written, and why that is safe

Membership is a judgement a derived list cannot express: `metrics.mjs` reads the
gate's outcome and is outside it; `set-state.mjs` is inside `mark-ready`'s import
closure but only projects a decision into a label.

But hand-written is how `DEFAULT_REVIEW_CHECKS` nearly rotted. So the test walks the
**import closure** of `GATE_ENTRY_POINTS` and fails if anything in it is neither
listed nor in `NON_GATE` with a reason. Verified by mutation: adding a
`metrics.mjs` import to `mark-ready.mjs` fails with *"these decide the gate but are
neither in GATE_ZONE nor in NON_GATE: metrics.mjs"*. `NON_GATE` is checked in reverse
too — an exclusion for something no longer in the closure is stale reasoning.

## Two sets, deliberately not one

- **`GATE_ZONE`** — "a human should look at this before it merges."
- **`UNPUSHABLE`** — "no agent run can deliver this at all."

#563 conflated them, and that is why #564 never converged: a doable script change was
bundled with a workflow-prompt change, design-fit correctly reported an incomplete
deliverable every round, and the fixer had nothing it could do.

The pre-flight therefore tells the **kickoff agent** rather than posting a comment
nobody reads: deliver what you can, and state in the PR body which criteria need a
human push. It emits globs from this module's own constants, never issue text — so a
warning cannot relay author-controlled content into the prompt.

## Opposite fail directions in one file, on purpose

| function | junk input | why |
|---|---|---|
| `gateZoneHits` | `[]` | It feeds a **report**. A metrics comment must never fail to render because a file list was odd. |
| `isMergeEligible` | **ineligible** | It is the **gate** half. "We could not read the changed files" must never read as "nothing sensitive changed". Every PR changes something, so an empty list is broken input, not a clean bill of health. |

## Verification

- `agent:tests`: **345 tests** green (333 on `main`); 12 new.
- `pnpm verify:self` green. All three touched workflows parse.
- The anti-rot check mutation-tested in both directions (drop a zone entry; add an
  unlisted gate dependency).
- `metrics.mjs` still imports and runs **without the SDK installed** — it now depends
  on `gate-zone.mjs` → `review-panel.mjs` → `ask.mjs`, and the promote/fix jobs have
  no `scripts/agent/node_modules`. Confirmed by importing and running the CLI in a
  worktree with none.
- The pre-flight snippet executed both ways: a workflow-asking issue emits
  `unpushable=.github/workflows/**` plus a `::warning::`; an ordinary issue emits
  nothing, leaving the prompt byte-identical.

## Follow-ups

- **The thresholds are guesses.** `rounds > 2` and `disjoint` come from the audit's
  observed split, not from a measurement of what humans actually intervened on.
  Shadow data is what makes them defensible.
- Flipping advisory → blocking is one line, and must not be done until the shadow
  comparison exists.
- The pre-flight only warns the kickoff agent. Escalating to an issue comment is
  worth it once the false-positive rate is known.
