# Slides Gradient Editing — Lessons

Running log of non-obvious findings and corrections while implementing
`20260711-slides-gradient-editing-todo.md`. Fill in as work proceeds.

## Context

- Design spec: `docs/design/slides/slides-gradient-editing.md`
- Prior art: `docs/design/slides/slides-gradient-fill.md` (linear import/render/export
  already shipped; editing UI was an explicit non-goal there).

## Lessons

- **Plan reference code for pointer-drag handlers had a stale-closure commit bug.**
  Task 4's `startDrag` committed `sortStops(value.stops)` on pointer-up, where
  `value` is the pre-drag prop captured in the once-registered `window`
  listener closure — so every marker drag self-reverted on release. Rule: when
  writing plan code that registers long-lived event listeners inside a render
  closure, the commit-on-end must read a mutable accumulator updated by the
  live handler, NOT re-read the captured prop/state. Also: don't sort the array
  during a live drag (re-sort reorders indices and breaks the captured index →
  dragged element mapping); sort once on commit and re-derive the selected
  index by object reference.
- **Frontend tests must live under `packages/frontend/tests/**`** — vite.config
  `test.include` is `tests/**` only, so a colocated `src/**/*.test.ts` silently
  never runs (there's a pre-existing orphan at `src/app/slides/theme-fonts.test.ts`).
  Rule: never colocate frontend tests in `src/`.
- **This repo has no frontend RTL/component unit tests by convention** (RTL +
  jsdom installed but unused). Verify components via `tsc --noEmit` + lint +
  build + browser smoke; missing a component unit test is not a defect. jsdom
  has no layout so pointer/getBoundingClientRect geometry tests are unreliable
  anyway.
- **No `Popover` primitive in `components/ui`** — nested pickers reuse the
  `DropdownMenu` primitive (as `shape-controls.tsx` / `border-picker.tsx` do),
  with `useMenuCloseHandlers` for focus/close. Radix `DropdownMenuTrigger`
  opens on `pointerdown`; disambiguate click-to-open vs drag with
  `e.preventDefault()` + a small (3px) drag threshold.
