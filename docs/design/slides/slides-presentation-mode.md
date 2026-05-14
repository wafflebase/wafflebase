---
title: slides-presentation-mode
target-version: 0.4.2
---

# Slides Presentation Mode — v1 (local-only)

## Summary

Fill in the presentation-mode UI that `docs/design/slides/slides.md`
Phase 5 has reserved a slot for. The editor already exposes a
`onStartPresentation?: (from: 'current' | 'first') => void` callback,
and `Cmd/Ctrl+Enter` / `Cmd/Ctrl+Shift+Enter` are wired through
`view/editor/interactions/keyboard.ts` — they currently no-op because
no handler is registered. This pass implements the handler and the
underlying presenter.

The presenter is **local-only**: it does not broadcast the active
slide via Yorkie presence, and collaborators are not auto-snapped to
the presenter's slide. Follow-along behavior, speaker-notes display,
and the dual-screen presenter view stay in v2.

### Goals

- Full-screen one-slide-at-a-time rendering driven by the existing
  `SlideRenderer`, with fit-to-screen sizing and a black letterbox.
- Keyboard navigation: `→` / `Space` / `PageDown` / `n` advance,
  `←` / `PageUp` / `Backspace` / `p` go back, `Home` / `End` jump,
  `Esc` exits. All other keys are swallowed so accidental editor
  shortcuts (e.g. `Cmd+Z`) cannot damage the deck while presenting.
- Click-to-advance on the slide canvas.
- A discoverable entry point: a "Present" split-button in the
  slides header (main click = current slide, dropdown menu item =
  from the beginning), in addition to the existing keyboard
  shortcuts.
- Cursor auto-hides after 3 s of no `mousemove`.
- An "End of slideshow" black screen after the last slide; click or
  `Esc` exits.
- Fullscreen API failure (iframe sandbox, permission denied) falls
  back to a fixed-position overlay covering the viewport — same UX,
  no native fullscreen.
- The presenter survives remote edits arriving over Yorkie: current
  slide is tracked by **ID**, the React shell re-renders on every
  store snapshot, and a deleted current slide jumps to the next
  available one (or exits if the deck becomes empty).

### Non-Goals

- **Presence broadcast.** No `presentingSlideId` field on Yorkie
  presence and no UI indicator for collaborators. Deferred to a
  follow-up; `docs/design/slides/slides.md` Phase 5's "Presence shows
  only the presenter's current slide so collaborators can follow
  along" is downscoped to local-only for v1.
- **Speaker notes display.** Notes are stored and edited via the
  existing notes panel; rendering them in present mode (single-screen
  overlay or dual-screen presenter view) is v2.
- **Slide transitions.** Cuts only.
- **Touch / swipe.** Presenting from mobile is out of scope; the
  click-to-advance handler covers tap.
- **Laser pointer, ink annotations, blackout (`B`) / whiteout (`W`)
  keys.** Out of scope.
- **Auto-play / timer / loop.** Out of scope.

## Proposal Details

### Code layout

The presenter is split between a framework-free DOM module in the
slides package and a thin React shell in the frontend, matching how
`initializeEditor` is structured today.

| File | Role |
|---|---|
| `packages/slides/src/view/present/presenter.ts` | Core: canvas creation, fit sizing, render, keyboard, cursor auto-hide, end screen, fullscreen-with-overlay fallback. No React, no Yorkie. |
| `packages/slides/src/view/present/index.ts` | Re-export. |
| `packages/slides/src/index.ts` | Add `export { startPresenter, type Presenter, type PresenterOptions } from './view/present';`. |
| `packages/frontend/src/app/slides/slides-presentation-mode.tsx` | React shell. Mounts a portal `<div>`, calls `startPresenter`, forwards `store` snapshots into `presenter.setDocument(...)`, cleans up on unmount. |
| `packages/frontend/src/app/slides/slides-view.tsx` | Wires `onStartPresentation` to local state (`presentingFrom: 'current' \| 'first' \| null`) and conditionally mounts `<SlidesPresentationMode />`. |
| `packages/frontend/src/app/slides/slides-detail.tsx` | Adds the "Present" split-button to the header chrome. |

### API surface (slides package)

```ts
export interface PresenterOptions {
  /** The element that becomes fullscreen. The presenter mounts its
   *  canvas as a child and restores the element's prior attributes
   *  on dispose. */
  container: HTMLElement;
  /** Initial snapshot. Updated later via setDocument. */
  doc: SlidesDocument;
  /** Identify the starting slide by ID so concurrent structural
   *  edits don't shift us. Pass the first slide's ID for
   *  "from beginning". */
  startSlideId: string;
  /** Called when the user exits (Esc, end-screen click, or
   *  native fullscreen exit via the browser chrome). */
  onExit: () => void;
}

export interface Presenter {
  /** Replace the document snapshot. The presenter re-renders the
   *  current slide; if its ID disappears, jumps to the next slide
   *  (or previous, if it was the last). If the deck becomes empty,
   *  calls onExit. */
  setDocument(doc: SlidesDocument): void;
  /** Current slide id, or `null` while at the end-screen. */
  getCurrentSlideId(): string | null;
  /** True when the user has advanced past the last slide. */
  isAtEndScreen(): boolean;
  /** Tear down: remove canvas, listeners, exit fullscreen,
   *  restore container. Safe to call from inside onExit. */
  dispose(): void;
}

export function startPresenter(options: PresenterOptions): Presenter;
```

### Render path

- One `<canvas>` inside `container`. Container background is `#000`
  (letterbox); canvas is centered.
- A `ResizeObserver` recomputes the fit:
  `scale = min(viewportW / SLIDE_WIDTH, viewportH / SLIDE_HEIGHT)`
  with `devicePixelRatio` applied to the backing store. Same math
  as the editor's `computeFitSize`, lifted into a shared helper if
  the duplication is meaningful (otherwise inline).
- Re-render whenever the active slide changes or `setDocument` is
  called. The renderer is the existing `SlideRenderer` — no DOM
  overlay, no element handles.

### Keyboard

A single `keydown` listener installed at `document` level in the
**capture phase** with `{ capture: true }`. It calls
`stopImmediatePropagation()` for every key it observes (so the
editor's keyRule layer cannot also fire) and `preventDefault()` on
any key it does not consume.

| Keys | Action |
|---|---|
| `→` `Space` `PageDown` `n` `N` | Next slide / end screen |
| `←` `PageUp` `Backspace` `p` `P` | Previous slide |
| `Home` | First slide |
| `End` | Last slide |
| `Esc` | Exit |
| anything else | swallowed |

Before entering present mode the host calls
`document.activeElement?.blur()` so a focused contenteditable text
box does not steal keystrokes inside the fullscreen element.

### Click-to-advance

A `click` listener on the canvas advances to the next slide (or
shows the end screen). The end screen itself is a separate paint
state of the same canvas — pure black with centered text — and any
click while on it triggers `onExit`.

### Cursor auto-hide

A 3 s `setTimeout` armed on entry and re-armed on every `mousemove`.
While the timer is dormant, `container.style.cursor = 'none'`. Any
`mousemove` clears the style and restarts the timer.

### Fullscreen with overlay fallback

```typescript
try {
  await container.requestFullscreen();
} catch {
  applyOverlayStyles(container);  // position: fixed; inset: 0; z-index: 9999
}
```

The `fullscreenchange` event on `document` triggers `onExit` when
the user leaves fullscreen via the browser chrome (Esc inside the
browser's native handling). When we mounted with the overlay
fallback there is no native handler — `Esc` from our keyboard
listener is the only exit path.

On `dispose`, exit fullscreen (or remove the overlay styles) and
restore any prior inline styles on the container.

### Remote-change handling

The slides editor stays mounted under the presenter. Yorkie keeps
flowing changes into the store. The React shell subscribes to the
store and calls `presenter.setDocument(snapshot)` on every change.

The presenter's `setDocument` logic:

1. Look up the slide whose `id === currentSlideId`. If found,
   re-render (theme/element edits are reflected).
2. If not found (deleted by collaborator), pick the slide at the
   same index in the new array. If the index is now out of bounds,
   pick the last slide. Update `currentSlideId` and re-render.
3. If `slides.length === 0`, call `onExit`. The shell surfaces a
   toast ("Presentation ended").

### Empty-deck entry guard

`onStartPresentation` (the editor callback) is a no-op when
`store.read().slides.length === 0`. `slides-view.tsx` already seeds a
blank slide on first mount, so this is defensive only.

### Entry-point UI

A "Present" split-button in the slides header
(`slides-detail.tsx`), placed to the right of the existing theme /
layout chrome:

- Main button click → `onStartPresentation('current')`.
- Dropdown item "Present from beginning" → `onStartPresentation('first')`.

Hotkey hints in the dropdown: `⌘↩` and `⌘⇧↩` (or Ctrl on non-Mac).
The button is disabled when `store.read().slides.length === 0`.

Icon library: `@tabler/icons-react` (`IconPlayerPlay`,
`IconChevronDown`), matching the existing slides toolbar / chrome.

The existing shortcuts (`Cmd/Ctrl+Enter`, `Cmd/Ctrl+Shift+Enter`)
continue to work and are already documented in
`docs/design/slides/slides-keyboard-shortcuts.md`.

### Testing

Vitest + jsdom in `packages/slides/src/view/present/presenter.test.ts`:

- Keyboard navigation maps each key to the expected next slide ID
  (or end-screen state) on a fixture deck with three slides.
- Boundary: `←` on the first slide is a no-op; `→` on the last slide
  enters the end-screen state; a subsequent click invokes `onExit`.
- `setDocument` with the current slide deleted jumps to the next
  slide at the same index; with all slides deleted invokes `onExit`.
- `dispose()` removes the canvas, the document-level keydown
  listener, the `mousemove` listener, and the `fullscreenchange`
  listener; exits fullscreen / removes overlay styles.
- `requestFullscreen` / `exitFullscreen` are mocked. A fallback path
  is exercised by making `requestFullscreen` reject.

No colocated React-shell test — the frontend package's test runner
(Node `--test` + experimental strip-types) doesn't support JSX, and
no existing slides React component is unit-tested. The presenter's
50 unit tests in `packages/slides/src/view/present/presenter.test.ts`
cover the framework-free half; the shell's mount / unmount lifecycle
is exercised by the manual smoke in Task 10.2 of the implementation
plan.

No visual / browser test in this PR — fullscreen behavior is
notoriously flaky in headless Chromium and the render path is the
same `SlideRenderer` already covered by existing visual scenarios.
Manual smoke before merge.

### Risks and Mitigation

- **Stale editor key handlers fire inside present mode.** The
  capture-phase `keydown` listener with `stopImmediatePropagation`
  is the primary mitigation; `document.activeElement?.blur()` on
  entry is the secondary one for contenteditable focus theft.
- **Fullscreen API restrictions on embed contexts.** The overlay
  fallback gives identical visual behavior; the only loss is the
  browser's native Esc handling, which our own `Esc` keybinding
  already covers.
- **Remote deletion of the current slide.** Tracking by ID plus the
  index-preserving fallback gives a deterministic, non-jarring
  outcome. The empty-deck case ends the presentation cleanly with
  a toast.
- **Double-mount / double-listener on hot reload.** `dispose` is
  idempotent and restores container state; the React shell calls
  it from `useEffect` cleanup.
- **Scope creep toward "follow-along" presence.** Calling that out
  explicitly in Non-Goals so a future PR adds it deliberately
  (presence schema, snapshot subscriber, edit-lock UX), not as a
  drive-by.
