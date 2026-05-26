# Slides — mobile GNB + toolbar shell (Phase B-0)

## Problem

`MobileSlidesView` (`packages/frontend/src/app/slides/mobile-slides-view.tsx:394`)
paints its own bespoke 44px header (back / title / Present ▶) and no
formatting toolbar. The other two document types use the shared
`SidebarProvider + AppSidebar + SiteHeader + <module>FormattingToolbar`
shell, with `useIsMobile()` driving in-component adaptation:

- Sheets (`packages/frontend/src/app/spreadsheet/sheet-view.tsx`) hides
  the formula bar / autofill handle, swaps to `MobileEditPanel`.
- Docs (`packages/frontend/src/app/docs/docs-formatting-toolbar.tsx:540-630`)
  collapses to undo / redo / `TextFormatGroup` + an `IconDotsVertical`
  overflow `DropdownMenu` for styles / insert / export.

Slides has neither: opening a deck on a phone gives up the sidebar,
title rename, share dialog, presence, and the toolbar — so users can't
e.g. add a slide, change a layout, or undo without leaving mobile.

This task is the scaffolding step toward the broader
`docs/design/slides/slides-mobile-edit.md` plan (Phase B). It stops
short of the bottom-sheet text-format panel, slide-ops FAB, and
touch-tuned undo/redo described there — those land in a follow-up PR
once the GNB / toolbar real estate is in place.

## Goal

Mobile slide decks render the same chrome as docs/sheets:

1. `SidebarProvider + AppSidebar + SiteHeader + SlidesToolbar` shell,
   built once and reused by mobile and desktop paths.
2. `SlidesToolbar` has a `useIsMobile()` branch that collapses to
   `UndoRedoGroup + SlideGroup + IconDotsVertical` overflow menu (the
   contextual middle section + Theme / Background right-globals get
   hidden until phase B-1).
3. `PresentButton`, `UserPresence`, `ShareDialog` sit in the
   `SiteHeader` children slot exactly like desktop / docs.
4. The canvas + overlay + Yorkie editor mount inside
   `MobileSlidesView` is unchanged — only its outer wrapper and inline
   header are dropped. Touch hit tolerance, iOS callout suppression,
   slide footer arrows, and Present mode continue to work.

## Non-Goals

- Bottom-sheet text formatting bar (Phase B-1).
- Slide-ops FAB (`+` / duplicate / delete long-press) (Phase B-1).
- `ObjectSection` / `TextEditSection` mobile rework — they stay
  desktop-only via the `isMobile` branch.
- Theme panel / background fill access from mobile (Phase C).
- Mobile-specific styling pass on `AppSidebar`'s Radix Sheet drawer —
  the existing docs/sheets drawer is reused as-is.

## Plan

### 1. `SlidesToolbar` — mobile branch

`packages/frontend/src/app/slides/toolbar/index.tsx`:

- Import `useIsMobile` from `@/hooks/use-mobile`.
- When `isMobile` is true, render: `UndoRedoGroup` →
  `ToolbarSeparator` → `SlideGroup` → `flex-1` spacer →
  `ToolbarSeparator` → mobile overflow trigger.
- Mobile overflow is a `DropdownMenu` (`IconDotsVertical`) seeded with
  placeholder items so the wiring is visible but mutation surface
  matches phase B-0:
  - `Add slide` (delegates to `SlideGroup`'s primary action via store)
  - `Background…` (disabled — TODO B-1)
  - `Theme…` (disabled — TODO B-1)
- Keep the desktop layout exactly as-is in the `!isMobile` branch
  (idle / object / text-edit contextual sections, right-globals).

### 2. `MobileSlidesView` — drop inline header, lift editor/store

`packages/frontend/src/app/slides/mobile-slides-view.tsx`:

- Remove the `<header>` (lines 394-451) and the outer wrapper's
  height-100dvh + flex-column container; instead render only the
  canvas host + the new thumbnail strip footer.
- Add props `onStoreReady?: (s: YorkieSlidesStore | null) => void` and
  `onEditorReady?: (e: SlidesEditor | null) => void`. Notify on the
  same lifecycle hooks the desktop `SlidesView` already uses, so the
  parent mobile layout owns the editor reference for toolbar wiring.
- Drop the local `presentingFrom` state / `handlePresent` /
  `SlidesPresentationMode` mount — those move up to the new layout to
  keep parity with `DesktopSlidesLayout`.
- Replace the `‹ 2/12 ›` footer with a `<ThumbnailStrip>` (also defined
  in this file): horizontal-scroll bar of mini slide thumbnails
  rendered via `@wafflebase/slides`'s `renderThumbnail`. Tap → set
  current slide. Active thumb has a `border-primary` outline and is
  auto-`scrollIntoView`'d on change. Repaint is debounced at 120 ms
  per `store.onChange` so per-keystroke edits don't redraw every
  slide on every character.

### 3. `slides-detail.tsx` — `MobileSlidesLayout`

`packages/frontend/src/app/slides/slides-detail.tsx`:

- Replace the `if (isMobile) return <MobileSlidesView .../>;` branch
  with `if (isMobile) return <MobileSlidesLayout ... />`.
- Implement `MobileSlidesLayout` as a near-copy of
  `DesktopSlidesLayout`, reusing the same: workspace fetch, items,
  `handleWorkspaceChange`, `handleRenameDocument`, `uploadFn`,
  `handleImagePick`, `presentingFrom` state, `slideCount` mirror,
  `activeTheme`, theme-id subscription.
- Mount tree:
  ```
  SidebarProvider
    AppSidebar (variant="inset", items, workspaces, currentWorkspace)
    SidebarInset
      SiteHeader (title, editable, onRename)
        PresentButton + ShareDialog + UserPresence
      div.flex.flex-1.flex-col.min-h-0.overflow-hidden
        SlidesToolbar (editor, store, theme, onImagePick, upload)
        MobileSlidesView (onStoreReady, onEditorReady, mode="edit")
    [presenting] SlidesPresentationMode
  ```
- The two layouts share enough that we will extract a `useSlidesShellState`
  hook (workspace + rename + upload + image pick + presenting +
  slideCount + activeTheme) to avoid drift, but keep both layouts as
  thin distinct components so future divergence (e.g. mobile-only
  bottom sheet) doesn't bloat the desktop path.

### 4. Verification

- `pnpm verify:fast` green.
- Manual smoke in `pnpm dev` with Chromium devtools mobile emulation:
  - Open a deck on a 375×667 viewport — sidebar drawer opens / closes,
    title is editable, Present launches, share dialog opens,
    presence avatars appear.
  - Add slide via overflow → new slide appears, footer indicator
    updates.
  - Undo / redo in toolbar.
  - Switch slides via footer arrows.
  - Tap a text element on slide → existing select handles still
    appear (no regression to editor mount).
- Verify desktop path is byte-identical after the refactor (extracted
  hook keeps the same behavior).

## Out of Scope (tracked separately)

- Bottom-sheet text-format bar — slides-mobile-edit.md "Bottom sheet".
- Slide-ops FAB and long-press menu — slides-mobile-edit.md "FAB".
- Theme / background access from mobile.
- Mobile peer jump from UserPresence.

## Risks

- Sidebar drawer eats from the canvas's vertical space (44px → ~56px).
  The slide canvas already calls `computeFitSize` against its host,
  so the canvas re-fits without code changes; the visual budget loss
  is ~12-15px and acceptable for the consistency win.
- Extracting `useSlidesShellState` is a quiet refactor on the desktop
  path. Mitigation: keep the hook's return shape 1:1 with the inlined
  state today and run the existing desktop smoke before merge.
