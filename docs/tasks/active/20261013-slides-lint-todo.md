# Slide Lint + Layout Report — Task Tracking

Issue: [#1091](https://github.com/wafflebase/wafflebase/issues/1091) (sub-PRs 0–2).
Branch: `feat/deck-lint`, on top of the #1088 seed-template stack.
Design: [slides-lint.md](../../design/slides/slides-lint.md).

## Sub-PR 0 — meta round-trip

- [x] `readSlidesRoot` / `writeSlidesRoot` keep `pxPerPt`, `slideHeight`
      (+ `unit`, `recentColors`) via `migrateMeta`; test fails on old code.

## Sub-PR 1 — layout report

- [x] `layoutReport` + `estimateMeasurer` in `@wafflebase/slides` (Node-safe).
- [x] `wafflebase slides layout-report [doc-id] [--file]` (`slides layout` is
      taken by the `layouts` alias).
- [x] Offline PNG render: `pnpm frontend render:slides <deck.json> --out dir`.

## Sub-PR 2 — linter

- [x] `lintSlides` with contrast / out-of-bounds / overlap / edge-margin /
      min-font / overflow, one file per rule; replaces `lintLayout`.
- [x] `applyAllowlist` (id, text prefix, or slide-wide; reason required).
- [x] `wafflebase slides lint` (`--rules`, `--allowlist`, `--fail-on`).
- [x] Seed-template regression gate + reasoned baseline.
- [x] Design doc + README index + cli.md.

## Later (not in this branch)

- [ ] Composition builders review / deck-author skill update (sub-PRs 3–4).
- [ ] Contrast and min-font for table-cell text.
- [ ] Fix the two baseline seed covers (product-launch-plan, marketing-campaign).
- [ ] Seed body text renders at 12 slide-pt (in-app 18pt): a template-size
      decision, not a lint rule.
