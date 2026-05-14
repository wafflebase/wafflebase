# TODO — Slides click-insert + cursor affordance

Improve shape insertion UX in `@wafflebase/slides`:

1. Show a `crosshair` cursor on the slide while insert mode is armed (any
   `ShapeKind` or `'text'`) so the user can see they are about to insert.
2. Treat a no-drag click as "insert at this point with a sensible default
   size", per shape kind, instead of dropping every shape at a fixed
   200×100.

Both changes target `packages/slides/src/view/editor/`.

## Tasks

- [x] Add `DEFAULT_INSERT_SIZE: Map<ShapeKind, {w, h}>` in
      `view/editor/interactions/insert.ts` (9 size tokens, 117 shape
      mappings). Move click-vs-drag default branch from
      `editor.ts:startInsert` into `buildInsertElement`.
- [x] Switch click threshold to Euclidean distance (`dx² + dy² < 16`,
      i.e. < 4 px movement) — current per-axis `< 4 && < 4` lets a
      1×100 drag fall back to default.
- [x] Wire `setInsertMode(kind)` to toggle `cursor: crosshair` on the
      slide canvas + overlay; restore to `''` when kind goes back to
      `null`.
- [x] Extend `interactions/insert.test.ts`: one assertion per
      representative kind covering each size token plus
      drag-overrides-default.
- [x] Editor test in `editor.test.ts`: `setInsertMode('rect')` →
      cursor is `'crosshair'`; `setInsertMode(null)` → cursor is `''`.
- [x] Run `pnpm verify:fast` → exit 0, 764 frontend tests + 708 slides
      tests pass.
- [x] Smoke test against `pnpm dev` (Puppeteer-driven, logged-in
      session). Cursor toggles, and click-insert produces the exact
      size-token frame for every representative kind tested.

## Size tokens (1920×1080 slide)

| Token | Size | Used by |
|---|---|---|
| `LINE_H` | 400×0 | `line`, `arrow` |
| `ARC_HALF` | 320×160 | `arc` |
| `SHAPE_WIDE` | 320×200 | basic rect family, callouts |
| `FLOWCHART` | 280×160 | 14 flowchart kinds |
| `SHAPE_SQUARE` | 200×200 | ellipse / polygons / equation / cloud-ish |
| `SHAPE_SQUARE_L` | 240×240 | stars, multi-dir arrows |
| `BANNER` | 480×140 | ribbons (horizontal/vertical-scroll variant) |
| `ARROW_H` | 320×160 | horizontal block arrows |
| `ARROW_V` | 160×320 | vertical block arrows |
| `ACTION_BUTTON` | 140×140 | 12 action buttons |

`horizontalScroll` → 400×200, `verticalScroll` → 200×400 (rotated banner
variants); `can` / `cube` → 240×200; `cloud` / `cloudCallout` → 280×200.

## Review

Changes landed across two slides files plus paired tests:

- `packages/slides/src/view/editor/interactions/insert.ts` — added
  `DEFAULT_INSERT_SIZE` map (9 size tokens covering all 117
  `ShapeKind`s), exported `defaultInsertSize(kind)`, and updated
  `buildInsertElement` to branch on a Euclidean
  `dx² + dy² < CLICK_THRESHOLD_PX_SQ` (= 16) movement test. Click
  branch anchors a per-kind default frame at `start`; drag branch
  uses the normalised drag rect.
- `packages/slides/src/view/editor/editor.ts` — `setInsertMode` now
  toggles `cursor: 'crosshair'` on the canvas + overlay (and `''`
  back to default on disarm). Removed the inline 4-px-per-axis
  branch in `startInsert`. Switched `insertAt` (context-menu path)
  to call `buildInsertElement` with `start === end` so it picks up
  the new per-kind defaults instead of the hard-coded 200×100.

Tests:

- `editor.test.ts` — one new assertion sequence checking cursor
  toggle across `rect → text → null`.
- `interactions/insert.test.ts` — 13 new assertions covering each
  size token + a drag-overrides-default + sub-threshold-drag-as-click.

Verification (against a logged-in session through Puppeteer):

| Shape | Token | Measured frame |
|---|---|---|
| Rectangle | SHAPE_WIDE | 320×200 |
| Line | LINE_H | 400×0 |
| Right arrow | ARROW_H | 320×160 |
| Up arrow | ARROW_V | 160×320 |
| 5-point star | SHAPE_SQUARE_L | 240×240 |
| Ribbon | BANNER | 480×140 |
| Home action button | ACTION_BUTTON | 140×140 |
| Plus | SHAPE_SQUARE | 200×200 |

Cursor: `crosshair` on `setInsertMode(kind)`, empty string on the
toolbar Select button (which calls `setInsertMode(null)`).

Notes / follow-ups:

- ESC currently does not disarm insert mode — pressing Escape leaves
  the crosshair cursor + armed kind in place. That's pre-existing
  behaviour (no key rule for it); flagged separately and not part of
  this change.
- The dev server in use was running from a separate clone at
  `/wafflebase/waffleslides/`. The smoke patch was applied there
  for verification and then reverted; no upstream leakage.

### Hover ghost + drag ghost + ESC (added after first smoke pass)

The original scope landed cursor toggle + per-kind default click size.
A second pass added three coupled features so insert mode feels like a
single coherent tool:

- **Hover ghost.** While shape insert mode is armed and the pointer is
  over the slide, the editor paints a translucent preview of the
  to-be-inserted shape at the cursor's logical position. Uses the
  same `buildInsertElement` default-size frame, so the user sees the
  exact kind / size / position they'll commit. `mouseleave` clears
  it; rAF throttling coalesces rapid pointer moves into one paint
  per frame. Skipped for text mode (single-click insert, no useful
  preview) and during an active drag-to-size (the drag preview owns
  the canvas).
- **Drag preview also goes ghost.** The drag-to-size live preview
  reuses the same `forceRender(slide, doc, ghost)` channel, so the
  in-flight rectangle is also semi-transparent — the user can read
  any underlying content while sizing. The commit on mouseup is the
  moment the shape becomes opaque.
- **Escape disarms insert mode (and cancels a drag).** Added an
  Escape key rule to `keyboard.ts` that calls `setInsertMode(null)`
  when armed (no-op otherwise so other ESC consumers can layer on).
  During an in-flight drag-to-size, the drag handler installs its
  own capture-phase ESC listener that aborts the drag without
  committing — clears the ghost, removes its mouse listeners,
  disarms insert mode, and stops propagation so the keyrule doesn't
  double-fire.

Renderer change: `SlideRenderer.forceRender` accepts an optional
`ghost?: Element`; `drawSlide` paints it on top of the committed
elements at `GHOST_ALPHA = 0.4` (in `ctx.save()`/`ctx.restore()` so
the alpha never leaks). Ghost lives outside `slide.elements` so it
can never participate in selection, hit-test, or z-order.

Verification (Puppeteer against the live editor, dark theme): with
Rectangle armed and pointer at canvas (200, 150), pixels inside the
ghost area sample to `[74, 92, 121]` (accent1-blue × 0.4 over the
`[32, 33, 36]` slide bg). `mouseleave` returns those pixels to bg
color. ESC clears cursor + Shape data-state and ghost in one frame.
Drag (mousedown → mousemove) shows the same alpha-blended pixel
during the drag; ESC mid-drag returns the canvas to bg color and
commits zero elements (verified via `selectionHandles === 0`).

### Toolbar regressions surfaced during smoke (fixed in same change)

The first browser pass exposed three issues outside the original
scope but caused by surrounding components — fixed alongside since
they directly affect this feature's usability:

- **Select / Text Toggle buttons did not visually highlight when
  active.** Root cause: the Toggle is wrapped in `<TooltipTrigger
  asChild>`, and the Tooltip's `data-state` ("closed" / "open") gets
  cloned onto the button element via `asChild`, clobbering the
  Toggle's own `data-state="on"`. The toggle.tsx CSS rule
  `data-[state=on]:bg-accent` therefore never matched once any
  Tooltip was paired with it. Fix in
  `packages/frontend/src/components/ui/toggle.tsx`: add a parallel
  `aria-pressed:bg-accent aria-pressed:text-accent-foreground`
  selector. Radix Toggle sets `aria-pressed` correctly regardless
  of Tooltip wrapping, so the pressed visual now lights up in both
  bare and Tooltip-wrapped placements.
- **Shape picker dropdown did not close after picking a shape.**
  Root cause: the picker's grid buttons are plain `<button>`s, not
  `DropdownMenuItem`s, so Radix's auto-close-on-select didn't fire.
  Fix in `packages/frontend/src/app/slides/shape-picker.tsx`: lift
  the picker's `open` state into a local `useState`, pass
  `open`/`onOpenChange` to `DropdownMenu`, and call `setOpen(false)`
  inside the IconButton `onSelect` wrapper. Verified by Puppeteer
  (`pickerOpenAfterPick: false`).
