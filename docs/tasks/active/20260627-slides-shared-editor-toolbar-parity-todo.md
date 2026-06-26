# Slides shared editable toolbar parity

## Problem

In an **editable share link** (`/shared/:token`, role `editor`), the
slides toolbar is missing controls that the **owner route** (`/p/:id`)
shows. Both mount the same `SlidesToolbar`, but `shared-document.tsx`
passes only `editor, store, theme, onImagePick`, while
`slides-detail.tsx` also passes `upload`, the three right-panel toggles
(`onToggleThemePanel/FormatPanel/MotionPanel` + `*Open`), and
`zoomController`. Because each toolbar control is gated on its prop
(`{onToggleThemePanel && …}`, `disabled={!controller}`,
`disabled={… || !upload}`), the shared editable toolbar silently drops:

- Theme panel toggle (palette)
- Format options panel toggle (adjustments)
- Motion panel toggle (sparkles)
- Zoom control (rendered but disabled → stuck on "Fit")

Image upload (`upload`/`onImagePick`) is **intentionally** absent —
share-link users lack workspace-scoped auth. Keep the toast behavior.

## Goal

Bring the editable share toolbar to parity with the owner toolbar for
everything that does NOT require workspace auth: theme / format / motion
side panels + zoom control. Desktop and mobile shared layouts both.

## Plan

- [ ] Lazy-import `ThemePanel`, `FormatPanel`, `MotionPanel` in
      `shared-document.tsx` (keep them out of sheet/doc share chunks).
- [ ] Import `createZoomController`, `FIT_ZOOM`, `ZoomController` (small,
      direct import).
- [ ] **SharedDesktopSlidesLayout**: add `rightPanel` state +
      `zoomControllerRef`; wire the three toggle props + `zoomController`
      into `SlidesToolbar`; pass `zoomController` to `SlidesView`; render
      the three panels beside the canvas (mirror owner desktop).
- [ ] **SharedMobileSlidesLayout**: add `rightPanel` state + `panelMeta`;
      wire the three toggle props into `SlidesToolbar`; render panels in a
      bottom `Sheet` (mirror owner mobile). No zoom control on mobile.
- [ ] Leave `onImagePick` toast + absent `upload` as-is (intended).
- [ ] `pnpm verify:fast` green.
- [ ] Self code-review over branch diff; address blocking findings.
- [ ] Manual smoke in `pnpm dev`: open an editor share link, confirm the
      palette / adjustments / sparkles toggles + zoom dropdown all work,
      panels dock/close, and image insert still shows the toast.

## Notes / decisions

- Minimal-impact: mirror the owner layouts inline rather than extracting
  a shared `useSlidesShellState` hook (the owner file itself duplicates
  desktop/mobile; a hook extraction would balloon the diff and touch
  `slides-detail.tsx`). The hook refactor is tracked separately in
  `20260519-slides-mobile-shell-todo.md`.

## Review

- [x] Lazy-import panels + import zoom-controller / Sheet.
- [x] SharedDesktopSlidesLayout wired (toggles + zoomController + docked panels).
- [x] SharedMobileSlidesLayout wired (toggles + bottom Sheet panels).
- [x] `onImagePick` toast + absent `upload` left as-is (intended).
- [x] `verify:fast` green for all steps that exercise this change (frontend
      lint + test, backend test, sheets, slides). The only red step —
      `cli typecheck` (`exportPptx` missing from `@wafflebase/slides/node`)
      — is **pre-existing on `main`** (in-progress PPTX-export work),
      unrelated to this diff. Verified by re-running the CLI typecheck on
      `main`.
- [x] Code review (correctness + cleanup angles): zero correctness bugs.
      Applied the one actionable nit — dropped the redundant per-panel
      `!readOnly &&` guards on desktop (the toolbar gate already keeps
      `rightPanel` null for viewers), so the desktop panel blocks now match
      the owner route verbatim.
- [ ] Manual browser smoke (pre-merge): open an editor share link, confirm
      palette / adjustments / sparkles toggles + zoom dropdown work, panels
      dock/close, image insert still shows the toast.

### Decisions held against review findings

- **`MOBILE_PANEL_META` re-defined locally** (not imported from
  `slides-detail.tsx`): intentional. Importing from the owner route would
  pull that heavy module into the shared-link chunk, defeating the lazy
  split. A tiny constant copy is the right trade for chunk isolation.
- **`RightPanel` type / toggle-handler duplication**: left as-is — the
  owner route already duplicates these across desktop/mobile; consolidating
  belongs to the tracked `useSlidesShellState` extraction, out of scope here.
