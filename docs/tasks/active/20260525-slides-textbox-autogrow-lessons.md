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

- **Reconciling conflicting user preferences early.** The user picked
  "keep the drawn rectangle" for drag sizing *and* "Google-Slides-style
  auto-grow" for height. Those collide on the height axis. Surfacing the
  reconciliation explicitly (drag sets width + position only; height
  always fits content) in the design doc before coding avoided building
  the wrong thing. When two answers conflict, name the conflict and pick
  a rule rather than silently honoring one.

- **Persist derived geometry at commit, not per keystroke.** The first
  instinct (spec draft) was a live `updateElementFrame` on every height
  change. That fragments undo and spams CRDT ops, and is inconsistent
  with text itself (which is local until commit). Writing `frame.h` once,
  in the same `batch` as `withTextElement`, gives one undo entry and a
  single CRDT op. Live visual growth is just the editing canvas resizing
  — no store writes.

- **Pick a callback seam that the test env can reach.** Tying the height
  signal to `renderNow` (which early-returns without a 2D ctx) means the
  docs jsdom unit env can't exercise it. The slides `test-canvas-env`
  shim *does* supply a working `getContext('2d')`, so the end-to-end
  firing/resize test lives in the slides package; the docs package only
  asserts the API surface. Match the test to where the code path runs.

- **Mirror existing interaction patterns.** The text drag-insert flow
  reuses the shape branch's `pointermove`/`pointerup`/`keydown(Escape,
  capture)` structure verbatim (including the `cleanup` closure that
  references `onUp`/`onKey` declared after it). Following the established
  shape pattern kept lint happy and behavior consistent for free.
