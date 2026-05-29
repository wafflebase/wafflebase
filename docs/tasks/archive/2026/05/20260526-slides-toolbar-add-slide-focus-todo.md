# Slides toolbar "+ Slide" should move to the new slide

## Problem

On desktop, adding a slide via the toolbar `+ Slide` button (or the
layout-picker chevron) does **not** move the editor to the new slide.
The main canvas keeps showing the previously-current slide and the new
slide is appended far at the end of the deck, off-screen.

## Root cause

The editor's "current slide" is editor state (`editor.currentId`),
independent of the store. Most add paths update it after inserting; the
desktop toolbar paths do not.

| Add path | `setCurrentSlide` | Insert position |
|---|---|---|
| Right-click → New slide (`thumbnail-panel.ts:263`) | yes | after current |
| Cmd+M (`keyboard.ts:366`) | yes | after current |
| Mobile add (`mobile-slides-view.tsx:189`) | yes | end |
| **Toolbar `+ Slide` (`slide-group.tsx:25`)** | **no** | **end** |
| **Toolbar layout picker (`slide-group.tsx:42`)** | **no** | **end** |

`store.onChange` in `slides-view.tsx:694` only `markDirty()` + `render()`;
it never touches `currentId`, so the canvas stays on the old slide.

## Decision

Insert the new slide **after the current slide** and move to it — matches
right-click New slide / Cmd+M and Google Slides behavior.

## Plan

- [x] Pass `editor` into `SlideGroup` (the toolbar shell already has it).
- [x] `onAddBlankSlide`: insert `'blank'` at `currentIdx + 1`, capture the
      returned id, `editor.setCurrentSlide(newId)`.
- [x] Layout-picker `onPick`: same, with the picked `layoutId`.
- [x] Extract a single `addSlideAfterCurrent(layoutId)` helper to avoid
      duplicating the index/focus logic.
- [x] `pnpm verify:fast` green.
- [x] Manual smoke in `pnpm dev` — confirmed by user.

## Out of scope

- Mobile already jumps to the new slide (appends at end). Left as-is to
  keep the change minimal; note the position inconsistency in lessons.

## Review

Two files changed:

- `toolbar/slide-group.tsx` — added `editor` prop; new `addSlideAfterCurrent`
  helper finds the current slide index, inserts at `currentIdx + 1`, and
  `setCurrentSlide(newId)`. Both the `+` button and the layout picker route
  through it. Degrades to append-at-end + no-focus when `editor` is null.
- `toolbar/index.tsx` — passes `editor` to `SlideGroup`.

`pnpm verify:fast` green (lint 0 warnings, 796+ unit tests pass). The logic
is a 1:1 mirror of the already-verified `keyboard.ts` (Cmd+M) and
`thumbnail-panel.ts` (right-click New slide) paths. No SlideGroup unit test
existed; behavior still needs a live `pnpm dev` smoke.

Mobile (`mobile-slides-view.tsx`) already jumped to the new slide; left
untouched (it appends at end rather than after-current — minor position
inconsistency, out of scope).
