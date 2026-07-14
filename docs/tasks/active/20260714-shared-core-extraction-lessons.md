# Shared Core Extraction — Lessons

Paired with [`20260714-shared-core-extraction-todo.md`](20260714-shared-core-extraction-todo.md).

## Decisions

- **One package, not two.** Original design proposed `@wafflebase/core` +
  `@wafflebase/ooxml`. Consolidated to a single `@wafflebase/core` with subpath
  exports (`/geometry`, `/canvas`, `/ooxml`, `/ooxml/drawingml`) to keep the
  package count low. Subpath entries + tree-shaking isolate the `jszip` weight,
  which was the only reason to split.
- **Behavior-preserving moves, not rewrites.** slides is the largest OOXML/
  DrawingML consumer; extraction promotes slides' existing code as canonical and
  migrates other engines to it, gated by slides' existing test suites.

## Lessons

_(fill in as PRs land)_
