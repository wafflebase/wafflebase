# Deck Critic Lane — Task Tracking

Issue: [#1112](https://github.com/wafflebase/wafflebase/issues/1112) (proposal
parts 2 and 3: the design-critic lane and its calibration).
Branch: `deck-critic-lane`.
Design: [deck-critic.md](../../design/slides/deck-critic.md).

Following #1091: primitives stay in the repo, orchestration lives in the
skill. The critic itself is an agent prompt (`deck-critic.md`); the repo
only adds the deterministic part — a findings schema, its validator and the
stop rule — so a round can be checked and the loop can end on a rule rather
than on the author's mood.

## Plan

- [x] `packages/cli/skills/deck-critic.md`: inputs (app PNGs, PPTX render,
      talk brief — never the author's reasoning), rubric (10 categories),
      major/minor with examples from the #1112 dogfood, findings JSON.
- [x] `packages/cli/src/slides/critique.ts`: `CritiqueFinding` type,
      `validateCritique`, `summarizeCritique`, `decideNextRound`.
- [x] `wafflebase slides critique-check --file f.json [--previous p.json]
      [--round N] [--max-rounds 3]`: validate, count by severity/category,
      print `continue` / `stop`. No network, no LLM.
- [x] Registry entry, cli.md tree + safety table, plugin mirror regenerated
      (`pnpm cli build:plugin`), SKILL.md index row, plugin slides skill link.
- [x] `deck-author.md`: critic step after render (independent context, max 3
      rounds, stop rule) in the loop + checklist only — lint/compositions
      tables untouched (other branches edit them).
- [x] Calibration procedure (human A/B labels → agreement) in the design doc.
- [x] Tests: `packages/cli/test/slides-critique.test.ts`.
- [x] `pnpm verify:fast` green.

## Stop rule (as implemented)

1. Any finding invalid → error, exit 1 (the round did not happen).
2. `round >= maxRounds` → `stop` (`escalate: true` when majors remain).
3. `major > 0` → `continue`.
4. `major == 0, minor == 0` → `stop` (clean).
5. `major == 0`, no previous round → `continue` (one polish round, so minor
   findings are not dropped the moment majors reach zero).
6. `major == 0`, minor count lower than the previous round → `continue`.
7. Otherwise (minor count flat or rising) → `stop`.

## Later (not in this branch)

- [ ] Collect a first set of human A/B labels on real decks and record the
      critic's agreement rate (the procedure exists; the data does not).
- [ ] If the agreement holds, consider a `--labels` agreement mode on the
      CLI instead of a hand count.
