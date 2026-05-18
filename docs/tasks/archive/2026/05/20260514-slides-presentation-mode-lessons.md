# Slides Presentation Mode v1 — Lessons

Shipped as PR #240 (`10e61651`).

## What shipped

- Framework-free presenter module at
  `packages/slides/src/view/present/` (~450 LOC, 54 unit tests).
- Single dpr-aware canvas in a host container, one slide at a time
  through `SlideRenderer` with a 16:9 letterbox.
- Fullscreen on entry with a fixed-position overlay fallback when the
  API is unavailable or denied.
- Navigation: Arrow keys, Space, PageUp/Down, Home/End, n/p, plus
  click-to-advance and an explicit end-of-slideshow screen.
- React shell `SlidesPresentationMode` as a portal-style component
  (renders null, owns a host div on `document.body`, forwards
  `store.onChange` snapshots into `presenter.setDocument`).
- Present split-button in the slides header; Cmd/Ctrl+Enter routes
  through the same handler.

## Patterns worth keeping

- **Identity-gated `fullscreenchange`.** Only the presenter's own
  fullscreen transitions trigger `onExit`; otherwise unrelated
  fullscreen elsewhere in the page would tear it down.
- **Slide identity tracked by id, not index.** Concurrent Yorkie edits
  (including a remote peer deleting the current slide) surface as an
  index-clamped jump or a clean exit when the deck empties.
- **Ref-wrapped `onStartPresentation` prop.** A fresh parent callback
  identity won't tear down the editor, since the wrapper keeps a
  stable reference into the ref cell.

## Stumbles worth not repeating

- CodeRabbit caught a real optional-chain bug on
  `requestFullscreen?.().then()` (the `?.()` short-circuits the entire
  promise chain). Per-task reviews missed it; the cross-cutting final
  review caught it. Worth budgeting for a final pass even after every
  per-task review.

## Out of scope (v2)

- Presence broadcast / auto-follow for collaborators.
- Speaker-notes display and dual-screen presenter view (per design
  doc).
