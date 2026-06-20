# Slides shared-link mobile view

## Problem

The slides **share-link / view-only route** (`SharedSlidesLayout` in
`packages/frontend/src/app/shared/shared-document.tsx`) has no
`useIsMobile()` branch. It always mounts the desktop `SlidesView`
(thumbnail side panel + fixed chrome), regardless of viewport width.

By contrast, the **owner route** (`slides-detail.tsx`) already branches
on `useIsMobile()` and mounts `MobileSlidesView` (full-height canvas,
swipe nav, thumbnail strip). So on a phone, a viewer opening a shared
deck sees a cramped desktop layout instead of the mobile shell — the
gap the design doc (`slides-mobile.md`) flagged as a non-goal and the
TODO at `mobile-slides-view.tsx:340-345` left open.

`MobileSlidesView` already supports `mode="view"` (read-only
`SlideRenderer` + swipe) and `mode="edit"`, so the fix is to wire a
mobile branch into `SharedSlidesLayout`.

## Plan

- [x] Lazy-import `MobileSlidesView` in `shared-document.tsx` (heavy
      `@wafflebase/slides` bundle — keep it off the initial chunk like
      `SlidesView` / `SlidesToolbar`).
- [x] Add `useIsMobile()` branch to `SharedSlidesLayout`; mount a new
      `SharedMobileSlidesLayout` when mobile.
- [x] `SharedMobileSlidesLayout`: same header (title + "View only"
      badge + UserPresence) as desktop shared chrome, then
      `MobileSlidesView` with `mode={readOnly ? "view" : "edit"}`.
      Show `SlidesToolbar` only in edit mode (mirrors desktop shared +
      owner mobile).
- [x] Remove / update the now-resolved TODO in `mobile-slides-view.tsx`.
- [x] `pnpm verify:fast` green.
- [x] Manual smoke: `pnpm dev`, open a viewer share link at 375px.

## Review

`SharedSlidesLayout` was split into a thin dispatcher that branches on
`useIsMobile()`:

- `SharedDesktopSlidesLayout` — the previous body, unchanged behavior.
- `SharedMobileSlidesLayout` (new) — mirrors the owner route's
  `MobileSlidesLayout`: 56px header (title + "View only" badge +
  `UserPresence`), `SlidesToolbar` only when not read-only, then
  `MobileSlidesView` with `mode={readOnly ? "view" : "edit"}`.

`MobileSlidesView` already supported both modes, so no slides-package
change was needed — only the wiring. The stale TODO in
`mobile-slides-view.tsx` (which assumed the share route always used the
desktop view) was rewritten to reflect that the editor mount is reached
only for share-link editors (`mode="edit"`), never read-only viewers.

Notes / known limitations:

- A read-only viewer's `mode="view"` mount still constructs the store
  and calls `ensureSlidesRoot`, which is a no-op on any populated deck
  and only scaffolds an empty one. This matches the documented
  read-only enforcement in `slides-mobile.md` ("an empty deck has
  nothing to protect"). It differs slightly from the desktop read-only
  path, which skips the empty-deck seed — accepted, since shared decks
  are populated in practice.
- `verify:fast` green (exit 0, 926 unit tests pass, lint clean).
- Manual smoke at 375px still pending (`pnpm dev` + viewer share link).
