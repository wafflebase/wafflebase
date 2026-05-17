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

_(Fill in as work proceeds.)_
