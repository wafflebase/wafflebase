# Agentic Office Workflow — Lessons

Paired with [20260831-agentic-office-workflow-todo.md](20260831-agentic-office-workflow-todo.md).
Step 3 (close gap A) was built by nine parallel agents behind a sequential seam
for the shared files. These are the lessons from that, not from the design.

## Parallel agents produce a half-consistent surface unless the invariant is shared

Twelve worksheet `get` / `set` pairs were split across nine agents. Seven of them
independently discovered that the `get` prints an envelope the `set` must unwrap,
and solved it — two different ways (`unwrap()` in `sheets-styles.ts`, an inline
unwrap in `sheets-charts.ts`, `extractRules()` in `sheets-rules.ts`). Five did
not, so `merges`, `filter`, `pivot`, `column-widths` and `row-heights` shipped a
documented round-trip that 400s.

Every agent was individually reasonable. The defect lives in the *space between*
them, which no single agent's context contains.

**Rule:** a cross-cutting invariant belongs in the shared prompt, or in an
explicit post-fan-out consistency pass over the whole surface. "Each agent
follows the recipe" does not produce a coherent surface — the recipe has to name
the invariant. Ask before fanning out: *what property must hold across all N
outputs?* That question has an answer even when each unit looks self-contained.

## Tests written per-unit will not catch a cross-unit inconsistency

All nine suites tested their own `set` by passing the already-bare payload via
`--data`. Not one piped a real `get` stdout into `set`, so the double-wrap was
invisible to 958 passing tests. The regression test that catches it — run `get`,
capture stdout, feed it to `set` — is the one no per-unit author thinks to write,
because within one unit it looks redundant.

## Do not mandate a file path the target package does not use

The orchestration prompt required tests at `src/commands/*.spec.ts`. The CLI's
convention is `test/*.test.ts`, with zero `src` specs on `main`. All nine agents
dutifully complied, then all nine reported that their tests were not collected,
and the integrator widened `vitest.config.ts` to compensate — a shared config
change made to accommodate a mistake in the prompt.

**Rule:** read the target package's existing convention before writing the
prompt. A prompt that contradicts the codebase gets obeyed, not corrected.

## Relocating a test file means rewriting its mock specifiers, not just its imports

Moving the nine suites rewrote `from './x.js'` and left
`vi.mock('../client/http-client.js')` untouched. An unresolved `vi.mock` path
does not error — it silently leaves the real module in place, so the tests ran
against a live `HttpClient` instead of a fake. Here it surfaced as 88 loud
failures, but the same slip in the other direction (a mock path that resolves to
something harmless) is a suite that passes while asserting nothing.

## Agent self-reports need independent counting

The integration agent reported "43 new registry entries"; the real figure is 38
(47 → 85). The verification agent caught it, and a set-difference against `main`
confirmed 38. Two agents also reached opposite conclusions about the envelope
bug — one calling it a defect, one calling it correct-by-design. The tiebreak was
reading `cli.md`'s claim and the client methods directly, not counting votes.

**Rule:** a number an agent reports is a claim, not a measurement. Re-derive
anything that will end up in a PR body or a roadmap.

## What the review lenses were worth

Six findings came back; one survived scoring. The five rejected ones were all
pre-existing conventions copied from `cells.ts` (the `--dry-run` branch outside
`try`, `if (dataStr)` treating `--data ''` as absent) or gaps no guidance file
requires (`skills/` entries). The one that survived was found independently by
two lenses. **Checking a finding against `main` before believing it** is what
separated the two groups — every rejected finding was disproved by
`git show main:packages/cli/src/commands/cells.ts`.
