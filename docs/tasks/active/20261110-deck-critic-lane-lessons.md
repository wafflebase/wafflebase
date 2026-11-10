# Deck Critic Lane — Lessons

## Inputs

The #1112 dogfood: round 1 had 7 major critic findings (broken line wraps,
card overflow, a duplicated slide, 8 card/table slides in a row, bold lost
in PPTX); round 2 had 0 major and 13 minor; 3 findings were PPTX-only.
Lint-clean-but-weak cases and the 19-people curation miss are the rubric's
worked examples.

## Decisions

- **The CLI stays model-free.** `critique-check` only validates, counts and
  applies the stop rule. The critic is an agent prompt; putting a model call
  in the CLI would make the one deterministic piece non-deterministic.
- **Stop rule keeps a polish round.** "Stop at zero majors" would have ended
  the dogfood at round 2 with 13 minors dropped. The first major-free round
  always continues; later ones continue only while minors fall.
- **Unknown keys are errors.** The stop rule runs on counts, so a typo that
  silently drops a finding changes the verdict.
- **`slideId: "deck"`** for deck-wide findings (variety runs, a missing
  PPTX reader) instead of a nullable field, so every finding has the same
  shape.
- **#1088 has no label format to reuse.** The #1088 stack carries template
  briefs (`catalog/brief.ts`). The repository's real label precedent is the
  review-panel eval (`scripts/agent/eval/labels.mjs`): reused its rules
  (blind presentation, gold vs silver) and not its PR-diff-keyed schema.
- **No labelled fixture committed.** Real A/B pairs are renders of user
  decks; a synthetic fixture would test nothing the stop-rule tests do not.
  The record shape is in the design doc for when labels exist.
- **PPTX render through LibreOffice.** `slides-author.md` warns against
  `soffice` as a *substitute* for the app render; here it renders the
  exported file, which is the surface a PPTX reader sees. The rubric tells
  the critic to separate file problems from reader quirks.

## Verification

- `packages/cli/test/slides-critique.test.ts`: validator, counts, every
  stop-rule branch (including the dogfood's 7-major → 0/13 transition),
  round inference, the command's JSON output and its error exits.
- `plugin.test.ts` keeps the plugin mirror and the safety table in sync
  (`pnpm cli build:plugin` regenerated `command-safety.json` and
  `references/`).
- In this sandbox, `test/docs-export.test.ts` fails twice on `main` too:
  it fetches Noto KR from cdn.jsdelivr.net, which has no DNS here.
- `pnpm verify:fast` otherwise green (the steps after `cli test` were run
  by hand since the chain stops there). `packages/docs`'
  `large-paste-indicator.test.ts` failed once under full-suite load and
  passed alone; untouched by this branch.
