# Slides Thumbnail — Preserve Scroll + Arrow Key Navigation

**Goal:** Fix the thumbnail panel scroll position resetting to the top
on every click, and add ArrowUp/ArrowDown keyboard navigation when the
panel is focused.

---

### Background

`packages/slides/src/view/editor/thumbnail-panel.ts`'s `render()` wipes
the panel with `container.innerHTML = ''` and rebuilds every thumbnail.
While the children are gone the scrollable ancestor's `scrollHeight`
collapses, the browser clamps `scrollTop` to 0, and the just-appended
children paint at the top. Every click triggers `render()` (via the
`onSelectionChange` subscription **plus** an explicit force-render in
the click handler), so the user constantly snaps back to slide 1.

Arrow keys are reserved for element nudging on the canvas
(`keyboard.ts:97-124`). Slide navigation already exists for
PageUp/PageDown but the thumbnail panel itself isn't focusable and has
no keydown listener.

### Task 1 — Preserve scroll position across `render()`

**Files:**
- Modify: `packages/slides/src/view/editor/thumbnail-panel.ts`
- Modify: `packages/slides/test/view/editor/thumbnail-panel.test.ts`

- [ ] Walk up from `container` to find the scrollable ancestor
      (`overflowY: auto | scroll`).
- [ ] Capture its `scrollTop` before `innerHTML = ''`; restore after
      all thumbnails are re-appended.
- [ ] Subscribe to `editor.onCurrentSlideChange` instead of
      `onSelectionChange` — element selection changes don't affect
      thumbnail content and trigger redundant renders. Drop the
      force-render in the click handler now that the subscription
      catches the .current highlight update.
- [ ] Test: after scrolling the panel and clicking a thumbnail, the
      scroll position is preserved.

### Task 2 — Arrow key navigation on the thumbnail panel

**Files:**
- Modify: `packages/slides/src/view/editor/thumbnail-panel.ts`
- Modify: `packages/slides/test/view/editor/thumbnail-panel.test.ts`

- [ ] Make `container` keyboard-focusable (`tabIndex = 0`,
      `outline: none` so no visible focus ring on the host).
- [ ] On plain click of a thumbnail, focus the container with
      `{ preventScroll: true }` so subsequent arrow keys route here.
- [ ] Add a keydown listener on `container`: ArrowUp / ArrowDown moves
      to prev / next slide via `editor.setCurrentSlide` (clamped at
      ends, `preventDefault` on actual moves to stop the scrollable
      parent from page-scrolling).
- [ ] After moving, `scrollIntoView({ block: 'nearest' })` on the new
      current thumb so off-screen targets become visible.
- [ ] Tests: ArrowDown advances current slide; ArrowUp reverses;
      clamps at both ends.

### Task 3 — Verify + commit

- [ ] `pnpm verify:fast` clean.
- [ ] Manual smoke: `pnpm dev`, open a slides doc with 10+ slides,
      scroll, click, then arrow-key navigate.
- [ ] Capture lessons in `*-lessons.md`, archive.

### Review

(Populated after merge.)
