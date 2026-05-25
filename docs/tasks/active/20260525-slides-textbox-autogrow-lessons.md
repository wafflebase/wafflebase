# Lessons — Slides Text Box Insert-to-Edit + Auto-Grow

Captured during implementation of
`20260525-slides-textbox-autogrow-todo.md`.

## Context / key facts

- The slides package consumes the **built** `@wafflebase/docs` (`dist/`),
  not its source. Docs API changes must be rebuilt
  (`pnpm --filter @wafflebase/docs build`) before slides typecheck/tests
  see them.
- jsdom has no canvas 2D context, so the docs `renderNow` early-returns;
  the docs unit env cannot exercise live render paths. The slides package
  shim `test-canvas-env` patches `getContext('2d')` (and `OffscreenCanvas`)
  so `renderNow` runs there — that is the right home for end-to-end
  text-box render/height tests.

## Lessons

(filled in as they come up)
