# Omit generated ANTLR output from the reviewed diff

Stop paying four lenses × two samples × N rounds to "review" ANTLR parser
tables that nobody is allowed to hand-edit.

First of eight PRs from the review-panel recall & cost audit.

## Motivation

The review panel reviews `git diff origin/main...HEAD` verbatim, which includes
the generated ANTLR parser output under `packages/sheets/antlr/`.

Measuring the generated/lock share of every agent PR diff to date:

| PR | generated share |
|---|---|
| #513, #544, #546, #547, #548, #549, #559 | 0% |
| **#521** | **48%** (35.6 KB of 75.6 KB) |

The exclusion is worthless on routine PRs and material on exactly one category —
formula-engine work, which regenerates the parser. #521 is also the only PR to
date that exhausted `MAX_REVIEW_ROUNDS` without converging, so those 35.6 KB
were re-read by 4 lenses × 2 samples × 5 rounds.

Reviewing them was never meaningful:

- `CLAUDE.md` states regeneration is the only valid edit path, and the repo
  already enforces that mechanically — `scripts/hooks/guard-generated-files.sh`
  is a `PreToolUse(Edit|Write)` hook that **blocks** edits under
  `packages/sheets/antlr/` while explicitly allowing `Formula.g4`. This change
  simply makes the reviewer consistent with a boundary the harness already
  enforces at edit time.
- The files carry `@ts-nocheck` and are ANTLR serialization tables; no reviewer
  meaningfully audits them.

## Scope

- [x] `agent-review-panel.yml`: exclude `packages/sheets/antlr/*.interp|.tokens`
      from the diff **body**; keep `changed.txt` unfiltered; add an
      empty-filter fallback; add `set -euo pipefail`.
- [x] `agent-review-on-demand.yml`: the identical step, marked KEEP IN SYNC.
- [x] `docs/design/harness-engineering.md`: document the reviewed-artifact scope
      in the review-panel section.

## Narrowed after review: the generated `.ts` files stay in the diff

The first revision also excluded `packages/sheets/antlr/*.ts`. **The security
lens raised a `major` on that, and it was right:**

> Excluding `packages/sheets/antlr/*.ts` from the reviewed diff body creates a
> security review blindspot: arbitrary TypeScript added/modified in that path is
> executed as part of the sheets package but is never shown to any review lens,
> and the only compensating control is bypassable.

That is the same gap this task's own lessons file had already written down — so
it was a documented risk, not a surprise, and documenting a risk is not
mitigating it. The `.ts` exclusion is reverted.

What remains excluded is `.interp` / `.tokens`, which is unambiguously safe:
`grep` across `packages/sheets/src`, `packages/sheets/package.json`, and
`scripts/` finds **zero** references, so nothing loads them at runtime or build
time and no lens could act on their contents.

Cost of the narrowing, measured on #521:

| exclusion | reviewed body | saving |
|---|---|---|
| none | 75,566 B | — |
| `.ts` + `.interp` + `.tokens` (first revision) | 39,923 B | 47% |
| `.interp` + `.tokens` (shipped) | 58,398 B | **22%** |

Half the benefit, and worth it. A 22% cut on formula-engine PRs is still real,
and it is now bought with no security tradeoff at all.

The `.ts` exclusion can return once a **regen-and-diff CI lane** exists — CI
runs `pnpm sheets build:formula` and fails if the committed output differs from
what `Formula.g4` produces. That is a strictly stronger control than review (no
reviewer meaningfully audits 18 KB of ANTLR tables), but it needs a JRE in CI
(`antlr4ts-cli` wraps the Java tool; not installable locally here) and its
determinism must be verified before anything depends on it. Filed as a follow-up
rather than guessed at inside this PR.

## Design decisions

- **`Formula.g4` is deliberately kept.** It is the hand-written grammar and the
  only semantically reviewable file in the directory — 1.1 KB of the 36.7 KB on
  #521, and where a bad grammar change is actually visible. The pathspec mirrors
  `guard-generated-files.sh`'s own `.g4`-allowed carve-out.
- **`changed.txt` is deliberately NOT filtered.** It drives `lensApplies` →
  `required_checks`. A changed-file list that shrank mid-PR could mark a
  narrow-glob lens non-applicable in a later round, drop it from the required
  set, and promote a PR whose lens FAILED an earlier round. Only the diff body
  is filtered. (Unreachable with today's all-`**` manifest; PR #564 introduces
  narrow globs, so the invariant is about to start mattering.)
- **Lockfiles are deliberately NOT excluded**, despite being the obvious
  candidate. They are supply-chain relevant — a swapped dependency is a real
  attack the security lens should see — and measurement showed they are 0% of
  every agent PR diff to date. Excluding them would trade a real signal for no
  measured saving.
- **Empty-filter fallback.** A regeneration-only change filters down to nothing,
  and `review-panel.mjs` fails closed on an empty diff. The step falls back to
  the unfiltered diff so an empty review only ever pages for a genuinely empty
  change, never because the filter ate everything.
- **`set -euo pipefail` added.** Previously a failed `git fetch` could leave a
  stale `origin/main` and silently produce the wrong diff; only the final
  command's status was observed.

## Deliberately out of scope

- **Metrics/cost instrumentation** — this PR originally carried a `cachedTokens`
  split, superseded mid-flight by PR #565. See the lessons file.
- **Prompt reordering for prefix caching** — scoped in, then dropped on a wrong
  premise. See the lessons file.
- **A regen-drift check.** Nothing currently regenerates the parser and compares
  it to the committed files, so a hand-edit that does not match `Formula.g4` is
  caught by nothing. Pre-existing gap, not introduced here, but worth a lane.

## Verification

- `pnpm verify:self` — all 11 lanes green (incl. lane 1 `agent:tests`, 73 tests,
  and `verify:entropy`'s doc-staleness check over the edited design doc).
- Simulated against PR #521's squashed change: 75,524 B → 39,885 B (47% of the
  reviewed body removed), `Formula.g4` still present in the filtered diff, all
  three `antlr` entries still in `changed.txt`, zero generated `.ts` leaked.
- Both workflow files re-parsed as YAML; both `run:` blocks checked with `bash -n`.
