# Panel feedback corpus: record when the review panel was wrong

PR 8 of the review-panel audit series. Script-only, consumed by nothing yet.

## The problem

The panel has been tuned repeatedly — severity thresholds, `samples: 2`, file-class
routing (#582), the novelty gate (#583), verifier unanimity, restatement clustering
(#591, #601) — and **not one of those decisions can be scored**. Everything the
pipeline records measures effort (`metrics.mjs`), self-agreement
(`compareSampleAgreement`), or process (`rounds.mjs`). Nothing records outcomes, so
each change was argued from intuition and two or three remembered incidents.

The audit's own success bar is unmeasurable for the same reason: "0 proven false
negatives", "`critical` demonstrably in use", "≤ 2 rounds to converge" all need a
corpus of known-wrong verdicts to be scored against.

## The change

- [x] `scripts/agent/misses.jsonl` — strict JSONL, one record per line, stable
      field order. `label` is `miss` **or** `false-positive`, both in one corpus so
      a change that cuts misses by raising more findings has to pay for it.
- [x] Added `fileClasses` and `origin` to the planned shape, now that #582 and #583
      ship the classifiers. Turns "we missed four bugs" into a claim about which
      population the panel is weak on.
- [x] `scripts/agent/harvest.mjs` — pure helpers + thin CLI, mirroring `metrics.mjs`.
      Two signatures: human commits after handoff, and CodeRabbit blocking findings
      the panel did not raise.
- [x] `verifiedBy: ""` on every harvested record, and the harvester **cannot** set
      it — `toMissRecord` defaults it and neither harvest path passes it. Test:
      *EVERY harvested candidate is unverified*.
- [x] `HANDOFF_MARKER` moved from `mark-ready.mjs` to `disclosure.mjs`. It is now a
      contract between two modules, and `mark-ready.mjs` runs its CLI at import
      time so nothing can import a constant from it.
- [x] `handoffTime` falls back to the `ready_for_review` timeline event.
      `mark-ready.mjs` posts the marker comment inside a `try/catch` *after* the PR
      is already ready, so a genuinely promoted PR can carry no marker at all.
- [x] `interestingFiles` routes through `classifyFile` (#582) instead of the planned
      hand-written drop-list, so the harvester's notion of reviewable code cannot
      drift from the panel's own.
- [x] `commitCheckRuns` extracted in `gh-checks.mjs` — reading one commit's verdict
      no longer costs one API call per commit on the PR.
- [x] `parseArgs` gained a **declared** `booleans` option (see lessons).
- [x] Backfilled #548's two documented misses, then ran the harvester over #548 and
      appended its three candidates.
- [x] `pnpm verify:self` green (11/11); 425 agent tests (388 on `main`).

## Corrected from the plan

The plan specified `classifyCodeRabbitComment` keeping "Potential issue" /
"Refactor suggestion" and dropping "Nitpick". **This repository has never emitted
those strings.** Every inline CodeRabbit finding back to #525 uses a three-field
italic header (`_🎯 Functional Correctness_ | _🟠 Major_ | _⚡ Quick win_`). A
classifier keyed on the upstream vocabulary would have matched zero comments and
reported an empty corpus as a clean bill of health.

Only *Functional Correctness* → `correctness` and *Security & Privacy* → `security`
get an automatic lens. Stability, Performance, Maintainability and Data Integrity
each plausibly map to two of our lenses or to none, and a guessed mapping would
corrupt the per-lens miss count the corpus exists to produce — so they harvest with
an empty `lens` for the curator.

## Fail directions, opposite on purpose

| path | on doubt | why |
|---|---|---|
| every read (`harvestPr`, `panelVerdictAt`, `parseJsonl`) | fewer candidates, never throws | a GitHub hiccup costs this run's proposals, not the corpus |
| the one write (`--append`) | **refuses** | one unparseable line means we do not know every id in the file, so appending could duplicate a curated record — and a duplicate double-counts in every later tally, silently and forever |

`dedupeById` keeps the **first** occurrence for the same reason: existing records
are passed ahead of fresh candidates, so a re-harvest can never blank a human's
`verifiedBy`.

## Explicit non-goal

`misses.jsonl` **must never enter a lens prompt** — not as few-shot examples, not as
"past misses to watch for". It biases lenses toward historical bug shapes when the
next defect is by definition new; it re-grows the prompt incremental review exists
to shrink; and it is a verbatim archive of attacker-influenceable text (CodeRabbit
bodies, contributor commit messages). If it ever must reach a model it goes in
fenced as DATA, exactly like the diff.

## Verification

- [x] 34 new tests in `harvest.test.mjs`, plus 3 in `prior-findings.test.mjs` for
      `commitCheckRuns` and the `parseArgs` boolean.
- [x] End-to-end against the real API on #548: 3 candidates, exit 0.
- [x] `--append` run, then re-run — second run appends nothing.
- [x] Append refusal mutation-tested: a truncated line added by hand produced
      `refusing to append — 1 unreadable line(s)`, named the line number, and wrote
      nothing.
- [x] The corpus file is asserted by its own test — every line parses, every record
      has the exact field order, a known label/source, a PR number, a summary and
      an evidence URL, and no duplicate ids.

## What needs a human

The five seeded/harvested records all carry `verifiedBy: ""`. **Nothing counts them
until someone puts their handle there.** Two are mechanically proven (see the
lessons file); one — "Address review: restore test shims, add copy coverage" — is
probably *not* a panel miss and is exactly the noise the curation step exists to
reject. It was left in rather than quietly curated out, so the corpus reports the
signal-to-noise ratio truthfully from line one.

## Not built

`harvest --report` roll-up, scheduled harvesting, and the paired shadow-mode
comparison against PR 9's merge-eligibility line.
