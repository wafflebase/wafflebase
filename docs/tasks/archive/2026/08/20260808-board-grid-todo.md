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

- [x] `packages/frontend/src/app/board/board-grid.ts` — pure module
  - [x] `BoardGridKind = "none" | "dot" | "line"`, `DEFAULT_GRID_KIND = "dot"`
  - [x] `gridStep(zoom)` — 1-2-5 × 10^k ladder, floor 20 world units, picks
        the smallest step whose on-screen spacing is >= 20 px
  - [x] `gridBackgroundStyle(kind, viewport, theme)` — returns the
        `backgroundImage` / `backgroundSize` / `backgroundPosition` triple
        (or `null` for `"none"`); positions normalized into `[0, size)` so a
        board far from the world origin (Miro imports) keeps small offsets
  - [x] `loadGridKind()` / `saveGridKind()` — `localStorage`, validated,
        try/catch (private-mode / quota)
- [x] `board-grid.test.ts` — ladder boundaries, position normalization for
      large and negative pan, `"none"`, light vs dark colors
- [x] `board-view.tsx`
  - [x] Fold the four direct `editor.setViewport` calls (minimap navigate,
        `commitViewport`, wheel, pan-drag) into `commitViewport` — one
        chokepoint for viewport changes
  - [x] Apply the grid style there, plus a `useEffect` for grid-kind and
        theme changes
- [x] `board-toolbar.tsx` — `Grid ▾` dropdown next to `ZoomControl`
- [x] `docs/design/board/board.md` — short subsection (no new design doc)
- [x] `pnpm verify:fast`
- [x] Browser smoke: wheel zoom in/out (density switches), space-drag pan
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

All tasks above are done and `pnpm verify:fast` is green (exit 0).

**Shipped**

- `app/board/board-grid.ts` — `gridStep` ladder, `gridBackgroundStyle`,
  `applyGridBackground`, `localStorage` load/save. 13 unit tests.
- `board-view.tsx` — four `setViewport` call sites folded into
  `commitViewport`; grid applied there, on mount, and on mode/theme change.
- `board-toolbar.tsx` — `Grid ▾` radio dropdown beside Zoom.
- `docs/design/board/board.md` — "Background grid" subsection.

**Verified**

- `pnpm verify:fast` — exit 0 (frontend 138 files / 1099 tests, all lanes).
- Rendering: the shipped `gridBackgroundStyle` output driven into a real
  browser across six cases — dot at zoom 1 / 0.25-panned / 4, line with
  majors at zoom 1, line at zoom 0.5 with a ~100k-unit pan, and line in
  dark. All render as intended; the far pan does not disturb the tiling.

- In-app behavior: manual smoke run by the author and passed. The local
  stack has no dev auth bypass, so the automation browser could not open a
  board — this step is not automatable as things stand. Steps covered:
  1. Open a board → dot grid visible.
  2. `Grid ▾` → Line → majors every 5 cells; → None → clears.
  3. Ctrl/⌘+wheel zoom out → density steps up rather than collapsing.
  4. Space+drag pan → grid tracks the content, no drift.
  5. Toggle dark mode → grid ink inverts without a remount.
  6. Minimap content free of grid.
  7. Reload → the chosen mode persists.

## Code review

Reviewed over the full branch diff. No Critical findings; the reviewer
independently confirmed the transparent-canvas premise, the dot half-cell
offset, the line-layer index matching, the four rewritten `setViewport`
sites, and that skipping a grid reset in the mount-effect cleanup is
correct rather than a leak.

Applied: corrected the `[20, 50)` px spacing claim (false above 1×, and
the shipped test already said so) in both `board.md` and the source
comment; moved the degenerate-size guard into `gridBackgroundStyle`, where
the claim is actually made; set `background-repeat` explicitly instead of
relying on the initial value; made the toolbar's grid props required so a
controlled-but-inert dropdown is unrepresentable; spoke the current mode
in the trigger's `aria-label` and dimmed the icon on `none`; commented the
`commitViewport` forward reference; added tests for line-layer offset
pairing, `applyGridBackground` including the `none` clear path, and
throwing storage, plus a `beforeEach` clear so the persistence cases stop
depending on each other.

Not applied, with reasons:

- **Skip unchanged style writes on a pan frame.** Attempted, reverted. The
  only stateless way to diff is against `host.style`, which returns the
  CSSOM's re-serialized value rather than the string written — the
  comparison never matches, so it rewrote everything anyway (a test caught
  this). The alternative is per-element cache state, which is not worth it
  against the RAF loop's own canvas repaint. The overstated "no per-frame
  cost" claim was corrected instead.
- **Ref assigned during render** (`gridKindRef.current = gridKind`). Left
  as is, on the reviewer's own reasoning: it mirrors the pre-existing
  `resolvedThemeRef` two lines above, and consistency beats a lone
  divergence here.
- **The 20-unit floor** stays. Zooming in grows cells (160 px at 8×)
  rather than subdividing, which is how Miro and Figma behave and is what
  makes a cell mean a fixed distance. A finer rung below the floor would
  turn it into a pixel grid — a different feature.
