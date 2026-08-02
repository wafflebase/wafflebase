# @wafflebase/board

Infinite-canvas engine for Wafflebase — a Miro/FigJam-style boundless
pan/zoom plane. This is the engine behind the `"board"` document type.

Rather than fork a new scene engine, board **reuses the Slides scene engine**
(`@wafflebase/slides`): its element model, renderer, hit-testing, and editor
already operate in transform-agnostic world coordinates. A board is presented
as "one unbounded slide" via a single-synthetic-slide adapter, and a
`Viewport { panX, panY, zoom }` is injected at the fit-scale chokepoints.

## Architecture

- **Model** (`model/board.ts`) — `BoardModel` is intentionally flatter than a
  `SlidesDocument`: no slides/layouts/masters/themes, just an `elements[]`
  array plus a small `meta` (title, display unit, recent colors).
  `boardToSlidesDocument(model)` wraps that array in a single-slide
  `SlidesDocument` (`SYNTHETIC_SLIDE_ID = 'board'`, blank layout, default
  master, default-light theme) so the reused slides renderer/editor operate on
  a board unchanged.
- **Viewport** (`view/viewport.ts`) — re-exports the slides `Viewport` type and
  `worldToScreen`/`screenToWorld`, and adds `DEFAULT_VIEWPORT`, `zoomAt`
  (zoom about a screen anchor, keeping the world point under the cursor fixed),
  and `panBy`.

## Public API

Exports from `src/index.ts`:

```typescript
// Model
type BoardModel
SYNTHETIC_SLIDE_ID, boardToSlidesDocument

// Viewport
type Viewport
worldToScreen, screenToWorld, DEFAULT_VIEWPORT, zoomAt, panBy
```

## Build

```bash
pnpm --filter @wafflebase/board build
```

## Further Reading

- [board.md](../../docs/design/board/board.md) — the reuse strategy, the
  single-synthetic-slide adapter, `board-<id>` docKey, presence, and the
  phased rollout (SP1 canvas skeleton → SP2 sticky/image → SP3 Miro import).
