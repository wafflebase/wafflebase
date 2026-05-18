# Slides Mobile View — Lessons

Companion to
[`20260517-slides-mobile-view-todo.md`](./20260517-slides-mobile-view-todo.md).
Capture anything surprising encountered during implementation —
edges in the existing slides/Yorkie surface, pointer-event quirks
on real devices, ResizeObserver timing issues, Playwright snapshot
rebaselines, etc.

## Notable decisions made during brainstorming

- **No `readOnly` flag on the editor.** Read-only is enforced by not
  mounting the editor module at all on mobile, instead of plumbing a
  flag through toolbar, keymap, handles, etc. Keeps the desktop
  code path untouched and gives future shared-link viewers a ready
  building block.
- **`computeFitSize` is duplicated three places now** (desktop
  `slides-view.tsx`, `presenter.ts`, `mobile-slides-view.tsx`).
  Accepted — the slides package must stay frontend-agnostic and the
  math is ~10 lines. Revisit if a fourth caller appears.
- **iOS edge swipe-back cannot be intercepted.** Documented as a
  limitation; footer arrow buttons are the screen-reader and
  fallback affordance.

## Observations during implementation

- **Frontend tests use `node:test`, not Vitest.** The original plan
  wrote Vitest-style tests (`vi.mock`, `renderHook`, `@testing-library/
  react`). These would have failed at load: the runner is Node's
  native runner, and `tests/resolve-hooks.mjs` stubs every `.tsx`
  file under `src/` to no-op exports so React components cannot be
  rendered in unit tests at all. The pattern in this repo is to
  extract pure logic into `*-helpers.ts` and test that; UI behavior
  is left to Playwright (visual/interaction). The hook was reshaped
  into `attachPointerSwipe` (pure DOM, fully unit-tested against a
  fake element) + `usePointerSwipe` (thin React wrapper, unverified
  in unit tests — covered by manual smoke).

- **The mobile branch had to move up to `slides-detail.tsx`, not
  `slides-view.tsx`.** The plan placed `useIsMobile` inside
  `SlidesView`, but `SlidesLayout` (in `slides-detail.tsx`) mounts
  the desktop sidebar, site header, toolbar, theme panel, and
  `SlidesView` together. Branching inside `SlidesView` would leave
  all that desktop chrome above a tiny mobile canvas. The fix:
  branch at the top of `SlidesLayout` and extract the existing body
  into `DesktopSlidesLayout`. This is also the only way to preserve
  React's rules-of-hooks across the breakpoint swap.

- **Visual baseline scenario for the mobile chrome deferred.** The
  visual-harness pattern (`harness/visual/slides-scenarios.tsx`)
  renders scenarios as plain React with in-memory `SlidesDocument`
  data — it has no Yorkie wiring. `MobileSlidesView` is tightly
  coupled to `useDocument` (for the doc handle, presence, and
  remote-change subscription), so adding a scenario would require
  either decoupling the component into a presentational shell
  (moderate refactor) or building a `DocumentProvider` mock for the
  harness (new infra). For a static header/footer chrome around an
  already-tested `SlideRenderer`, the cost outweighs the regression
  coverage. Tracked as a possible follow-up.
