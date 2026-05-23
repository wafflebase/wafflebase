---
title: slides-ruler
target-version: 0.4.2
---

# Slides Ruler

## Summary

Add horizontal and vertical rulers to the slides editor, plus
presentation-wide alignment guides that users can drag out of the
rulers. The ruler is primarily a placement aid: it shows slide
coordinates (corner origin, inch / cm based on locale) and exposes
draggable guides that participate in the existing snap engine. Text
indent / tab handles inside text boxes are explicitly deferred to a
later release.

The design reuses the tick rendering and unit helpers from the docs
ruler (`packages/docs/src/view/ruler.ts`) by extracting them into a
shared low-level module so both packages stay visually consistent.

### Goals

- Horizontal ruler above the slide canvas and vertical ruler to the
  left, always visible in the editor.
- Corner origin (top-left = 0,0), inch / cm display driven by
  `navigator.language`. Same convention as the docs ruler.
- Tick density automatically adjusts to the editor zoom factor so the
  ruler stays legible across zoom 0.25× – 3×.
- Drag from a ruler onto the canvas to create a persistent alignment
  guide; drag an existing guide to reposition; drag a guide back onto
  a ruler to delete.
- Guides live at the presentation level (one shared set across all
  slides), synchronized through Yorkie so collaborators see the same
  alignment scaffolding.
- Guides participate in the existing element drag / resize snap
  engine with a higher priority than other-element edges but lower
  than slide-center.
- Read-only share-link mounts display rulers and guides but suppress
  every mutating interaction.

### Non-Goals

- Text-box-local ruler mode with first-line indent (▽) and left indent
  (△) handles or tab stops. Google Slides / PowerPoint switch the
  horizontal ruler into text-box coordinates while editing text; this
  is deferred. The current scope is slide-coordinate placement only.
- `View > Show ruler` toggle. The ruler is always on in v1, matching
  the docs convention. A toggle can land later once Slides gains a
  full View menu and persisted user preferences.
- `View > Show guides` toggle. Guides are always visible in v1.
- Per-slide guides. Guides are presentation-wide; if a user wants a
  guide on only one slide they can place an unmoving line shape, but
  the ruler-drag affordance produces presentation-level guides.
- Center-origin coordinates (PowerPoint's `-6.67 … 0 … +6.67`). Corner
  origin keeps a single coordinate convention across docs and slides.
- Numeric position input (e.g. "place a guide at exactly 4.0\""). v1
  is drag-only; numeric input can land alongside the broader Format
  options panel in v2.
- Guides rendered into PDF export or shown in presentation mode.
  Guides are editor scaffolding, not slide content.

## Proposal Details

### Architecture

The docs and slides rulers share a low-level rendering core; each
package owns its own controller and interactions.

```
packages/docs/src/view/ruler/
├── index.ts            # MOVED — existing docs Ruler class (was view/ruler.ts)
├── tick-renderer.ts    # NEW (extracted) — tick + label drawing
└── unit.ts             # NEW (extracted) — RulerUnit, locale detect

packages/slides/src/view/editor/ruler/
├── ruler.ts            # SlidesRuler controller (H/V canvases + corner)
├── guides-layer.ts     # paints permanent guides on the overlay layer
└── interactions.ts     # ruler drag-out, guide drag, hit-test
```

The docs file move is import-path-preserving: existing `from
'../view/ruler'` resolves to the new `ruler/index.ts`. No call sites
need to change.

The shared modules take `pxPerUnit` as an argument so docs (96 dpi)
and slides (144 dpi — see "Coordinate system") can both use them
without coupling to either coordinate space.

slides already depends on `@wafflebase/docs`, so the imports flow
cleanly from slides → docs without a new package boundary.

### DOM and render structure

The ruler attaches to the slide stage as absolutely positioned
canvases. Permanent guides paint into the existing overlay layer
rather than into the ruler, because they belong to the slide
coordinate system (they zoom and pan with the slide content).

```
editor-shell.tsx
└── <slide-stage> (position: relative)
    ├── <ruler-corner>    absolute; top:0; left:0; 20×20
    ├── <h-ruler-canvas>  absolute; top:0; left:20px; right:0; height:20px
    ├── <v-ruler-canvas>  absolute; top:20px; left:0; bottom:0; width:20px
    └── <canvas-pane>     absolute; top:20px; left:20px; right:0; bottom:0
        ├── <slide-canvas>      # existing
        └── <overlay>           # existing
            └── <guides-layer>  # NEW — permanent magenta solid lines
```

The slide canvas area is offset by 20 px on top and left to make room
for the rulers. Ruler canvases use DPR-aware backing stores
(`devicePixelRatio` ×) and `ctx.scale(dpr, dpr)`.

`SlidesRuler` is the controller:

```ts
class SlidesRuler {
  constructor(opts: {
    container: HTMLElement;
    hCanvas: HTMLCanvasElement;
    vCanvas: HTMLCanvasElement;
    corner: HTMLElement;
  });

  render(viewport: {
    scrollX: number; scrollY: number;
    zoom: number;
    slideW: number; slideH: number;
  }): void;

  setUnit(unit: 'inch' | 'cm'): void;

  onGuideDragStart(cb: (axis: 'x' | 'y') => void): void;

  dispose(): void;
}
```

### Coordinate system

Slides logical canvas is 1920 × 1080 px and maps to a 13.333" × 7.5"
PDF page (slides.md). The implied physical scale is therefore:

| Constant | Slides | Docs (for comparison) |
| --- | --- | --- |
| `PX_PER_INCH` | 144 | 96 |
| `PX_PER_CM` | ≈ 56.7 | ≈ 37.8 |

Slides logical px are *not* CSS px; they sit one zoom step above. The
ruler renders one inch / cm of slide content as `PX_PER_UNIT × zoom`
screen pixels. The shared tick renderer takes `pxPerUnit` as a
parameter to stay neutral.

The corner origin (0, 0) is the top-left of the slide. Both rulers
count outward in positive values only. Coordinates outside `[0,
slideW]` / `[0, slideH]` are clipped (no negative ticks).

### Tick density by zoom

`one unit on screen = pxPerUnit × zoom`. Tick density adapts so the
ruler does not become unreadable when the user zooms out:

| One unit on screen | Display |
| --- | --- |
| ≥ 60 px | major + half + minor |
| 30 – 60 px | major + half |
| 15 – 30 px | major only, labels every 1 unit |
| < 15 px | major only, labels thinned to every 2nd or 4th unit |

The transition points are wired to `view.zoom`; the renderer recomputes
its display level on every `render()` call.

### Unit selection

Locale-driven defaults, same as docs: if `navigator.language` matches
a metric locale (everything except `en-US`, `en-GB`, `my`), use `cm`,
else `inch`. A user-facing unit toggle is not surfaced in v1 — when a
Slides settings surface lands, both docs and slides will share it.

### Guides — data model and Yorkie schema

Guides live on the presentation root, not per-slide. A guide is an
infinite line at a fixed slide-x (vertical guide) or slide-y
(horizontal guide) value.

```ts
type Guide = {
  id: string;          // stable
  axis: 'x' | 'y';
  position: number;    // slide logical px, clamped to [0, slideW] or [0, slideH]
};

type SlidesDocument = {
  meta: { title: string };
  slides: Slide[];
  layouts: Layout[];
  guides: Guide[];     // NEW
};
```

Yorkie root gains `guides: Yorkie.Array<Guide>`. `Yorkie.Array` (rather
than a plain object) gives deterministic convergence under concurrent
add/remove without per-guide id collisions.

Store API additions:

```ts
interface SlidesStore {
  // ...existing
  addGuide(axis: 'x' | 'y', position: number): string;
  moveGuide(id: string, position: number): void;
  removeGuide(id: string): void;
}
```

All three are wrapped in `store.batch()` to produce one undo step per
user action.

#### Migration

Existing Yorkie documents do not have `root.guides`. `YorkieSlidesStore`
initializes it lazily on attach:

```ts
if (!root.guides) {
  root.guides = [];
}
```

No schema migration script is required; the first attach by any
client writes the empty array.

### Presence

```ts
type SlidesPresence = {
  // ...existing
  draggingGuide?: {
    id?: string;            // undefined while creating from ruler
    axis: 'x' | 'y';
    position: number;
  };
};
```

In v1 the `draggingGuide` field is reserved on `SlidesPresence` but
the editor does not broadcast it: the live preview is local-only.
`addGuide` / `moveGuide` commit once on `mouseup`, and the resulting
store change propagates through the standard CRDT path so peers see
the committed guide on their next render. Broadcasting the in-flight
preview to peers is a tracked v1.1 follow-up — the schema is already
in place to keep it a non-breaking change.

### Interactions

| Action | Input | Behavior |
| --- | --- | --- |
| Create guide | mousedown on a ruler, drag onto canvas | shows magenta solid preview via presence; on mouseup inside slide → `addGuide`; on mouseup outside → cancel |
| Move guide | mousedown within 4 px of an existing guide, drag | presence preview; commit `moveGuide` on mouseup |
| Delete by drag | drag guide back onto a ruler | cursor switches to a delete affordance; mouseup over ruler → `removeGuide` |
| Delete by menu | right-click guide | context menu: Delete guide / Delete all on this axis / Delete all guides |
| Hover cursor | hover within 4 px of guide | `col-resize` (vertical guide) / `row-resize` (horizontal guide) |
| Ruler ticks | hover ruler | tick + label only; no interaction beyond drag-out |

There is no explicit "guide selected" state in v1 — hover is the only
trigger. Keeping a separate selection model out keeps the interaction
surface small.

#### Visual treatment

- Permanent guides: 1 px magenta solid line spanning the slide.
- Snap guides (slide-center, element edges) inherit the existing
  1-px solid magenta style — kept consistent with the pre-ruler snap
  rendering so the differentiation lives in how the snap target is
  marked rather than in line style.
- When an element drag snaps to a permanent guide, the matching guide
  is thickened to 2 px and shifted to a deeper magenta (`#be123c`)
  instead of overlaying a separate snap indicator on top.
- In-flight drag preview (creating or moving a guide) paints at
  ~55 % opacity so the user can distinguish the drag from a committed
  guide; the committed copy is suppressed while its preview is in
  flight to avoid a double line.
- Drag interactions clamp into the slide extent
  (`[0, SLIDE_WIDTH]` for vertical, `[0, SLIDE_HEIGHT]` for
  horizontal); a mouseup outside the slide cancels guide creation.
- Ruler markers (small triangles on the ruler at each guide's
  position) and per-drag position labels (`4.25"` / `10.7 cm`) are
  tracked as v1.1 polish; the line + cursor swap are already
  sufficient to position guides confidently.

#### Snap integration

`packages/slides/src/view/editor/snap.ts` gains a new candidate kind:

```ts
type SnapGuide = {
  kind: 'slide-center' | 'edge' | 'guide';  // NEW: 'guide'
  axis: 'x' | 'y';
  position: number;
  guideId?: string;
};
```

When multiple candidates fall within the 8-slide-px snap threshold
(the engine's existing constant), ties resolve in this priority:

1. `slide-center`
2. `guide`
3. `edge`

User-placed guides outrank other-element edges because they encode
explicit intent — a higher-priority candidate wins even when an
edge happens to be closer numerically. When an element drag snaps
to a guide, the implementation thickens that guide to 2 px and
deepens its color rather than overlaying a separate indicator on
top — keeps the visual uncluttered.

Resize and guide-drag participate in the same snap logic. Keyboard
nudge (Arrow / Shift+Arrow) does not trigger snap; nudge stays a
precision tool.

`align()` and `distribute()` do not reference guides. Guides are a
drag-time aid, not an alignment command target.

### Read-only mounts

Viewer-role share links mount the same editor scaffolding (see
slides.md → "Read-only mounts"). The ruler and guides follow the same
opt-in pattern:

- Rulers and guides are **rendered** so viewers can see slide
  measurements and the deck's alignment scaffolding.
- `initializeEditor({ readOnly: true })` skips:
  - the ruler `mousedown` listener (no drag-out → no guide creation),
  - the guide hover hit-test (no move / no delete),
  - the guide right-click context menu,
  - the cursor change on hover (so read-only is visually consistent).
- Peer presence stays receive-only: viewers see other collaborators'
  drag previews but do not broadcast their own.

### Presentation mode and PDF export

`view/present/presenter.ts` does not mount the ruler or guides layer.
`export/pdf.ts` ignores `guides` entirely. Both are editor-only
affordances.

### Phasing

Six PRs, each independently demoable.

| Phase | Scope | Verification |
| --- | --- | --- |
| P1. Extract shared core | Move tick / unit code from `packages/docs/src/view/ruler.ts` into `view/ruler/tick-renderer.ts` and `view/ruler/unit.ts`. `pxPerUnit` becomes a parameter. Docs behavior unchanged. | `pnpm verify:fast`, docs ruler visual smoke |
| P2. Slides ruler display | `SlidesRuler` controller, H/V canvases, corner DOM, zoom + scroll + unit rendering. No guide code yet. | `pnpm verify:fast`, browser smoke at zoom 0.5 / 1 / 2 |
| P3. Guides data + render | `Guide` type, store API, `MemSlidesStore` + Yorkie schema + lazy init. Guides paint into the overlay layer. No interactions. | Unit tests for store CRUD, integration test for Mem vs Yorkie equivalence and concurrent add/remove convergence |
| P4. Guide interactions | Ruler drag-out, guide drag/move/delete, presence preview, ruler markers, context menu. | Interaction tests (drag sequences), two-user presence test |
| P5. Snap integration | Add `'guide'` kind, priority resolution, hit-snap visual emphasis. | Snap-priority unit tests, nudge-no-snap test |
| P6. Read-only mounts + polish | `readOnly` branch suppresses listeners, presentation-mode and PDF skip guides. Design doc finalized. | Read-only mount tests, `pnpm verify:browser:docker` |

Verification gates:

- Every PR: `pnpm verify:fast`.
- P3 / P4: `pnpm verify:integration` (Yorkie + Postgres).
- P6: `pnpm verify:browser:docker`.

### Testing strategy

- **Unit (`packages/slides/src/**/*.test.ts`)**
  - `view/editor/ruler/ruler.test.ts` — tick density transitions
    across zoom thresholds, label values at sample positions for
    inch and cm.
  - `store/memory.test.ts` — `addGuide` / `moveGuide` / `removeGuide`
    including batch behavior.
  - `view/editor/snap.test.ts` — priority resolution between
    slide-center / guide / edge candidates.
- **Integration (`packages/frontend/tests/app/slides/`)**
  - `yorkie-slides-store.test.ts` — guide CRUD equivalence between
    `MemSlidesStore` and `YorkieSlidesStore`.
  - `two-user-slides-yorkie.ts` extension — concurrent add / move /
    remove of guides converge.
- **Visual / browser** — extend `verify:browser:docker` with a
  scenario that creates a guide, drags an element onto it, and
  reloads to verify persistence.

## Risks and Mitigation

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Extracting the shared core breaks docs rendering. | Docs ruler regression. | P1 lands as a no-op refactor with the existing docs ruler tests gating. Visual smoke before merging. |
| Slides 144-dpi vs docs 96-dpi confuses readers and reviewers. | Subtle tick / label bugs. | The shared tick renderer accepts `pxPerUnit` as input — there is no implicit dpi constant. Tests assert tick positions at known zoom × pxPerUnit values. |
| Guides on the Yorkie root migrate poorly for old documents. | Existing decks fail to load. | `if (!root.guides) root.guides = []` on attach. The lazy init is idempotent, runs on the first session, and adds no schema migration step. |
| Snap priority among slide-center, guide, and edge feels surprising. | Users fight the tool. | Document the rule in user-facing help. Priority is overridable in code; tune based on early feedback before broad rollout. |
| Always-on rulers eat 20 px on the top and left, hurting smaller laptop screens. | Cramped canvas. | The 20 px footprint matches docs. A `View > Show ruler` toggle is the planned escape hatch in a later release once a Slides View menu lands. |
| Permanent guides accidentally end up in PDFs. | Wrong export output. | `export/pdf.ts` explicitly ignores `guides`; covered by a unit test that renders a deck with one guide and asserts the PDF page contains no extra paint operations. |
| Concurrent ruler drag-out conflicts with concurrent element drag. | Confusing presence. | The two paths use distinct presence fields (`draggingFrame` vs `draggingGuide`) and distinct interaction states in the editor, so they never collide. |
