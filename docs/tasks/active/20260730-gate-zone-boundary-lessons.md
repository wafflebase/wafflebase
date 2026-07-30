# Lessons: gate-zone no-touch boundary

## Derive the truth, keep the judgement by hand

`GATE_ZONE` had two bad options. Fully derived (the import closure of the gate entry
points) is always current but cannot express that `metrics.mjs` *reads* the gate's
outcome rather than deciding it, or that `set-state.mjs` is in `mark-ready`'s imports
only to paint a label after the decision. Fully hand-written expresses all of that
and rots — which is exactly what nearly happened to `DEFAULT_REVIEW_CHECKS` when a
fifth lens was added.

The resolution was to have both: the list is hand-written and authoritative, and a
test derives the closure and demands every member of it be either listed or
explicitly excluded **with a reason**. `NON_GATE` is checked in reverse too, so an
exclusion for something that has left the closure fails as stale reasoning.

The mutation that proves it is not "delete an entry" — it is *"a gate entry point
gains a new dependency and nobody updates the list"*, which is the thing that
actually happens. That fails with the name of the file.

**When a list encodes judgement but must stay current, don't choose between derived
and hand-written. Hand-write the answer and derive the question.**

## Two failure directions can live in one small module, but they must be named

`gateZoneHits` returns `[]` on junk. `isMergeEligible` returns **ineligible** on junk.
Both are correct and they are opposites:

- `gateZoneHits` feeds a *report*, and a metrics comment must never fail to render
  because a file list was odd.
- `isMergeEligible` is the *gate*, and "we could not read the changed files" must
  never be indistinguishable from "nothing sensitive changed".

The trap is that these two sit ten lines apart and look like the same kind of
function. A reader who copies the fail-soft habit into the gate half creates a
silent fail-open. So the asymmetry is stated at both definitions and pinned by a test
whose name says *fails toward INELIGIBLE, never eligible*.

## "It should not be auto-merged" and "you cannot write it" are different questions

The plan had one list. The #563/#564 failure needed the other one.

`GATE_ZONE` answers *should a human look at this before it merges* — `severity.mjs`
qualifies, and the agent may edit it perfectly well. `UNPUSHABLE` answers *can an
agent run deliver this at all* — only `.github/workflows/**`, because the App has no
`workflows` scope. #563 bundled a doable script change with a workflow-prompt change;
design-fit correctly reported an incomplete deliverable every round, and the fixer
had nothing it could do about it. One list cannot express that difference, and
collapsing them would either warn about far too much or protect far too little.

**Before adding to a policy list, check whether the new item answers the same
question as the existing ones.** If it doesn't, it needs its own list — and then the
relationship between them (here: strict subset) is worth asserting in a test.

## Warn the party that can act, not the party that will read

The plan said the pre-flight should "warn". The obvious implementations — a run
annotation, or a comment on the issue — both fail: the annotation is seen only by
someone already debugging, and the comment is noise that arrives after the agent has
already started.

The party that can actually change the outcome is the **kickoff agent**, so the
warning goes into its prompt: deliver what you can, and say in the PR body which
criteria need a human push. That converts a silent multi-round burn into one honest
sentence.

It also constrains the implementation: text derived from an issue is heading into a
prompt. So the function returns **globs from its own constants**, never the matched
issue text, and there is a test asserting that an injection attempt in the issue body
cannot appear in the output. A fuzzy matcher whose output reaches a prompt has to be
built so the fuzziness cannot carry a payload.

## Check the import you just added against the leanest environment that runs it

Adding `gate-zone.mjs` to `metrics.mjs` quietly pulled in `review-panel.mjs` →
`ask.mjs` → the Agent SDK. `metrics.mjs` runs in the promote and fix jobs, which have
no `scripts/agent/node_modules` — so a non-lazy SDK import would have broken the
metrics comment on every promotion, and no unit test would have noticed, because
tests run where the dependency happens to exist.

It works because `ask.mjs` imports the SDK lazily. But that was luck rather than
design on my part, and confirming it took one command in a worktree with no install.

**A new import is a claim about every environment that loads the module.** Run the
thing in the barest one before believing it.
