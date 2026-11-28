# Slide Lint: Density and Composition Rules — Task Tracking

Issue: [#1112](https://github.com/wafflebase/wafflebase/issues/1112)
("Deck authoring: a design-critic lane and richer visual builders") — the
lint part. Branch: `slides-lint-density`.
Design: [slides-lint.md](../../design/slides/slides-lint.md).

## Plan

- [x] `token-wrap` (warning): a wrap inside a short bracketed group, a
      number ratio, or a digit-bearing word broken mid-word; read off
      `layoutText`, not a second line breaker.
- [x] `empty-region` (info; warning from 70%): bottom empty band ≥ 45% of
      the safe area on a content slide; sparse layouts and < 3 content
      elements skipped. Thresholds as `LintOptions`.
- [x] `inset-inconsistent` (info): sibling cards whose text inset differs
      from the group median by > 8 px (`insetTolerance`).
- [x] `isBackground` moved from `overlap.ts` to `context.ts` (shared).
- [x] Register in `RULES`, `LintRuleId`, default rule list, CLI
      `LINT_RULES` (`--rules`), command / registry descriptions.
- [x] Unit tests: positive and negative cases per rule.
- [x] Seed templates: run the new rules, record counts (no baseline
      entries needed — see lessons).
- [x] Docs: deck-author.md rules table (+ plugin mirror via
      `build:plugin`), slides-lint.md, design README row.
- [x] `pnpm verify:fast` green.
