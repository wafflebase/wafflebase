# Board background grid (P1 — display only)

Miro-style background grid for the board infinite canvas, so a user can
tell where they are on an unbounded plane. Display only: `Snap to grid`
is deliberately out of scope this pass (see Non-goals).

## Background

Miro's canvas grid is a three-state view setting (`None` / `Line grid` /
`Dot grid`) under `View > Grid`, with a *separate* `Snap to grid` toggle in
the canvas context menu. Two properties of Miro's model shape this design:

1. The grid is a **user-level** preference, not a board-level one — one
   collaborator turning it on does not change anyone else's view.
2. Grid size is **not user-customizable**; Miro instead aligned default
   object sizes to the grid (June 2024).

Our board already ships the two other "where am I" affordances Miro has —
the minimap (SP2) and the zoom readout (SP4). The grid is the missing one.

## Approach

Paint the grid as a **CSS background on the canvas host container**, not on
the canvas.

`drawSlide`'s board branch (`packages/slides/src/view/canvas/slide-renderer.ts`,
the `options.viewport` branch) only `clearRect`s — it deliberately paints no
slide-rect background because a board is an unbounded plane. The canvas is
therefore already transparent, so a background on the host `container`
(`board-view.tsx`) shows through underneath every element.

Why this over painting into the canvas:

- **Zero change to `@wafflebase/slides`.** No new renderer option, no new
  editor option.
- **Zero per-frame cost.** A canvas-painted grid would re-stroke the whole
  viewport every RAF tick; the compositor handles a CSS background.
- **Cannot leak into the minimap.** The minimap snapshots through the same
  `drawSlide`; a renderer-level grid would need an explicit opt-out there.

## Non-goals

- **Snap to grid.** Separate concern (extends `snapDelta` in
  `packages/slides/src/view/editor/snap.ts` with grid candidates); different
  test surface (drag / resize / connector regression). Next pass.
- **Canvas context-menu entry.** The menu is hardcoded in the slides package
  (`view/editor/context-menu.ts`); routing a grid item through it needs an
  additive editor option. The board toolbar is the P1 entry point.
- **Configurable grid size.** Matching Miro, the step is derived from zoom.
- **Per-document grid.** The setting is per-user (`localStorage`), like Miro's.

## Tasks

- [ ] `packages/frontend/src/app/board/board-grid.ts` — pure module
  - [ ] `BoardGridKind = "none" | "dot" | "line"`, `DEFAULT_GRID_KIND = "dot"`
  - [ ] `gridStep(zoom)` — 1-2-5 × 10^k ladder, floor 20 world units, picks
        the smallest step whose on-screen spacing is >= 20 px
  - [ ] `gridBackgroundStyle(kind, viewport, theme)` — returns the
        `backgroundImage` / `backgroundSize` / `backgroundPosition` triple
        (or `null` for `"none"`); positions normalized into `[0, size)` so a
        board far from the world origin (Miro imports) keeps small offsets
  - [ ] `loadGridKind()` / `saveGridKind()` — `localStorage`, validated,
        try/catch (private-mode / quota)
- [ ] `board-grid.test.ts` — ladder boundaries, position normalization for
      large and negative pan, `"none"`, light vs dark colors
- [ ] `board-view.tsx`
  - [ ] Fold the four direct `editor.setViewport` calls (minimap navigate,
        `commitViewport`, wheel, pan-drag) into `commitViewport` — one
        chokepoint for viewport changes
  - [ ] Apply the grid style there, plus a `useEffect` for grid-kind and
        theme changes
- [ ] `board-toolbar.tsx` — `Grid ▾` dropdown next to `ZoomControl`
- [ ] `docs/design/board/board.md` — short subsection (no new design doc)
- [ ] `pnpm verify:fast`
- [ ] Browser smoke: wheel zoom in/out (density switches), space-drag pan
      (grid tracks content), dark mode, minimap free of grid, viewer-role
      share link still shows the grid

## Known limitations

- **A read-only (viewer-role) share-link visitor gets the grid but cannot
  change it.** `BoardView` hides the whole toolbar for `readOnly`, and the
  grid control lives there. The grid still paints (at the visitor's own
  stored preference, default `dot`), which is what matters for orienting on
  an unbounded plane. Giving viewers the toggle means surfacing a
  view-only toolbar for them — a bigger layout decision than this pass.
- **1 px lines are composited, not snapped to device pixels.** At a
  fractional DPR or pan offset the browser antialiases them slightly. A
  canvas-painted grid could snap; that is the trade for zero paint cost.

## Review

(filled in after implementation)
