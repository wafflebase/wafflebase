---
title: slides-multi-select-resize
target-version: 0.4.5
---

# Slides Multi-Select Resize and Rotate

## Summary

Make the eight resize handles behave when more than one element is
selected. The overlay already draws those handles on the combined
axis-aligned bbox of the selection, but `SlidesEditorImpl.startResize`
bails out for `selectedIds.length !== 1`. (Multi-rotate is already
wired in `startRotate` via the `isMulti` branch in `buildLiveState`
and the move-pattern `paintMoveGhost`; this design extracts the
rotation math to a pure helper for symmetry but leaves the runtime
behavior alone.) This proposal wires the resize gesture end-to-end
with Google Slides / PowerPoint parity:
bbox-relative per-element transforms, type-dispatched handling for
connectors and tables, multi-rotation around the bbox centre, Shift
modifiers preserved, and one batched undo step per gesture. While
we're here we also unify the live-preview paint: every resize / rotate
(single and multi) renders the committed original at full opacity plus
a translucent `GHOST_ALPHA` ghost at the proposed frame, matching the
move drag and single-table-resize patterns; the in-place
`paintLiveScoped` path is retired for these gestures.

### Goals

- Corner / edge resize on a multi-select: each child's centre and size
  scale relative to the bbox anchor; rotation is preserved; Shift
  preserves aspect (uniform scale).
- Rotate handle on a multi-select: rigid rotation around the bbox
  centre; per-child rotation accumulates; Shift snaps to 15°.
- Type-dispatched per-element application: shapes / text / images /
  groups scale their frame; tables scale frame (cells follow);
  `free` connector endpoints scale, `attached` endpoints stay
  attached to their target shape.
- Drilled-in scope (selection inside a group) works the same as
  scope-`[]`: world frames in, world frames out, single
  `toWorldFrame`/`fromWorldFrame` round-trip per gesture.
- Live preview is **ghost-style** for every resize/rotate path (single
  and multi), matching the move and single-table-resize patterns:
  the committed slide stays painted at full opacity, a translucent
  ghost of each selected element paints on top at the proposed frame,
  and handles track the ghost. Commit is one `store.batch(...)` so
  the gesture is one undo unit.
- Pure-function math co-located in `interactions/resize.ts` and
  `interactions/rotate.ts` (the existing rotate helper is extended,
  not replaced), unit-testable without a DOM.

### Non-Goals

- **Multi-select bbox rotation around an arbitrary pivot.** Pivot is
  always the bbox centre (Google Slides and PowerPoint both do this).
- **Alt / Ctrl = resize-from-centre.** An orthogonal modifier
  extension (the Shift drag constraints live in
  [`slides-keyboard-shortcuts.md`](slides-keyboard-shortcuts.md)); the
  same hook will apply to multi.
- **Per-shape "lock aspect" setting from PowerPoint.** Wafflebase has
  no such setting today; corner without Shift always stretches
  independently.
- **Implicit grouping of the selection.** A multi-select is not a
  group; text frames stretch but their font size does **not** scale.
  Explicit groups (with `refSize`) continue to scale their children
  proportionally — that path is unchanged.
- **Connectors-only multi-select.** Selecting only connectors still
  goes through the multi-resize path; we just note that connectors
  with every endpoint attached are no-ops under both the resize and
  rotate gesture (their frame re-resolves from the attached shapes).
- **Smart-guide equal-spacing trios during multi-resize.** Reuse the
  bbox snap (`matchSize`) only; the equal-spacing overlay is a
  separate engine and an extension point, not a blocker.

## Reference behavior (Google Slides and PowerPoint)

The two products converge on the same model. We codify that model as
the canonical spec; subtle PowerPoint extensions (Ctrl-from-centre,
shape-level aspect-lock) are out of scope per the non-goals above.

| Axis | Google Slides | PowerPoint | Wafflebase v1 |
|---|---|---|---|
| Selection frame | AABB across all selected (post-rotation) | AABB | AABB (existing) |
| Corner, no Shift | Independent x/y stretch | Independent x/y stretch | Independent x/y stretch |
| Corner, Shift | Preserve bbox aspect (uniform scale) | Preserve bbox aspect | Preserve bbox aspect |
| Edge | Single-axis stretch | Single-axis stretch | Single-axis stretch |
| Text frame | Frame stretches, font fixed | Frame stretches, font fixed | Frame stretches, font fixed |
| Rotated child | rotation preserved; `frame.w/h` scale in child-local axes | Same | Same |
| Group child | scales as a frame; its own `refSize` keeps inner children proportional | Same effect | Same (reuse existing render path) |
| Rotate handle | Rigid rotate around bbox centre; child rotation += dθ | Same | Same |
| Shift + rotate | 15° snap | 15° snap | 15° snap (reuse `rotate.ts` `STEP = π/12`) |
| `attached` connector endpoint | Stays attached to its target shape | Same | Same |

## Proposal Details

### 1. Drag-start snapshot

At pointer-down on a multi-select resize or rotate handle, capture an
immutable snapshot used by every `pointermove`:

```ts
type ElementSnapshot =
  | { kind: 'frame'; id: string; worldFrame: Frame }            // shape/text/image/group/table
  | {
      kind: 'connector';
      id: string;
      worldFrame: Frame;             // stored frame (resolved bbox over endpoints); used for the bbox calc
      start: Endpoint;               // { kind: 'free', x, y } | { kind: 'attached', elementId, siteIndex }
      end: Endpoint;
    };

interface MultiResizeStart {
  scope: readonly string[];
  startBbox: Frame;                  // rotation === 0; AABB across snapshots
  snapshots: readonly ElementSnapshot[];
}
```

The bbox is the combined axis-aligned bounding box of every snapshot's
world frame (using existing `boundingBox(frame)` per child to account
for individual rotations). `startBbox.rotation === 0`.

### 2. Resize math (`resizeMultiFrames`)

```ts
export function resizeMultiFrames(
  start: MultiResizeStart,
  handle: ResizeHandle,
  worldDx: number,
  worldDy: number,
  shift: boolean,
): {
  newBbox: Frame;
  frames: Map<string, Frame>;        // updated worldFrames per snapshot id
  connectorEndpoints: Map<string, { start: Endpoint; end: Endpoint }>;
}
```

Reuses `resizeFrame` (not `resizeFrameWorld`) because the bbox is
axis-aligned:

```ts
const newBbox = resizeFrame(start.startBbox, handle, worldDx, worldDy, shift);
const sx = newBbox.w / start.startBbox.w;
const sy = newBbox.h / start.startBbox.h;
```

Per snapshot:

```ts
function mapPoint(px: number, py: number): { x: number; y: number } {
  return {
    x: newBbox.x + (px - start.startBbox.x) * sx,
    y: newBbox.y + (py - start.startBbox.y) * sy,
  };
}

// frame snapshot
const cx = snap.worldFrame.x + snap.worldFrame.w / 2;
const cy = snap.worldFrame.y + snap.worldFrame.h / 2;
const c2 = mapPoint(cx, cy);
const w2 = snap.worldFrame.w * sx;
const h2 = snap.worldFrame.h * sy;
const next: Frame = {
  x: c2.x - w2 / 2,
  y: c2.y - h2 / 2,
  w: Math.max(w2, MIN_SIZE),
  h: Math.max(h2, MIN_SIZE),
  rotation: snap.worldFrame.rotation,
};
```

The min-size clamp is per element; the bbox itself is clamped by
`resizeFrame` to `MIN_SIZE`. When a child clamps but the bbox does
not, the child's centre still tracks the bbox anchor — same behavior
as Google Slides (small children stop shrinking while the rest keep
scaling).

### 3. Connector handling

For each connector snapshot:

```ts
const start2 = mapEndpoint(snap.start);
const end2   = mapEndpoint(snap.end);

function mapEndpoint(ep: Endpoint): Endpoint {
  if (ep.kind === 'attached') return ep;        // unchanged — owned by target shape
  // ep.kind === 'free'
  const p = mapPoint(ep.x, ep.y);
  return { kind: 'free', x: p.x, y: p.y };
}
```

Both endpoints `free` → connector stretches with the bbox like a
shape. One `attached`, one `free` → the free end scales while the
attached end stays attached (the attached shape's own snapshot moves
it). Both `attached` → no entry written into `connectorEndpoints`;
the connector is a follower and its bbox re-resolves from the new
shape positions.

### 4. Rotate math (`rotateMultiFrames`)

```ts
export function rotateMultiFrames(
  start: MultiResizeStart,
  startAngle: number,        // atan2(startCursor - pivot), supplied by editor
  currentAngle: number,      // atan2(curCursor   - pivot)
  shift: boolean,
): {
  frames: Map<string, Frame>;
  connectorEndpoints: Map<string, { start: Endpoint; end: Endpoint }>;
};
```

Pivot is the bbox centre:

```ts
const px = start.startBbox.x + start.startBbox.w / 2;
const py = start.startBbox.y + start.startBbox.h / 2;
```

The editor computes `startAngle` / `currentAngle` from cursor
positions and the pivot — same convention as the existing
`startRotate` path that feeds `applyRotate`. The delta is
Shift-snapped using the existing `snapAngle` helper exported from
`interactions/rotate.ts` (`STEP = π/12`); we snap the **delta**, not
each child's absolute rotation, so the selection rotates rigidly:

```ts
const raw = currentAngle - startAngle;
const dθ  = shift ? snapAngle(raw) : raw;
```

Per snapshot:

```ts
function rotateAround(x: number, y: number): { x: number; y: number } {
  const cos = Math.cos(dθ), sin = Math.sin(dθ);
  const dx = x - px, dy = y - py;
  return { x: px + dx * cos - dy * sin, y: py + dx * sin + dy * cos };
}

// frame snapshot
const cx = snap.worldFrame.x + snap.worldFrame.w / 2;
const cy = snap.worldFrame.y + snap.worldFrame.h / 2;
const c2 = rotateAround(cx, cy);
const next: Frame = {
  x: c2.x - snap.worldFrame.w / 2,
  y: c2.y - snap.worldFrame.h / 2,
  w: snap.worldFrame.w,
  h: snap.worldFrame.h,
  rotation: (snap.worldFrame.rotation + dθ) % (2 * Math.PI),
};
```

Connector free endpoints rotate via `rotateAround`; attached endpoints
are left untouched (the attached shape's own rotation update places
them correctly).

### 5. Editor wiring

`SlidesEditorImpl.startResize` routes by selection shape:

| Selection | Math path | Paint path | Source of change in this PR |
|---|---|---|---|
| `length === 1`, single table | unchanged (existing `resizeFrame` + cell scaling) | `paintTableResizeGhost` (unchanged) | none |
| `length === 1`, single rotated element | unchanged (`resizeFrameWorld` — anchor handle stays fixed in world) | `paintGhostPreview(ghosts, ghosts, guides)` | only paint path moves off `paintLiveScoped` |
| `length === 1`, otherwise | unchanged (`resizeFrame`) | `paintGhostPreview(ghosts, ghosts, guides)` | only paint path moves off `paintLiveScoped` |
| `length > 1` | new `resizeMultiFrames` (§2) | `paintGhostPreview(ghosts, ghosts, guides)` | new |

Why keep `resizeFrameWorld` for the single-rotated case instead of
folding it into the multi path: a single rotated element resizes
around the world-space position of the anchor handle (the opposite
corner / edge midpoint) — that math lives in `resizeFrameWorld` and
matters for the rotated-handle UX. The multi path computes a new
axis-aligned bbox first and back-derives per-child centres, which
gives a different result for a single rotated child. Keeping them
separate preserves the existing single-rotated UX without
re-deriving the same math under a different name.

For `length > 1`:

- Drop the `selectedIds.length !== 1` guard.
- Build `MultiResizeStart` from the selected elements'
  `toWorldFrame(...)` results. Excluded snap candidates = all
  selected ids (existing pattern).
- On `pointermove`:
  1. Call `resizeMultiFrames` to get `newBbox` + per-element ghost
     frames + connector endpoint ghosts.
  2. Run `matchSize` on the **bbox** (`newBbox`) only; if matched,
     recompute per-element ghost frames against the matched bbox
     (re-run `mapPoint` over the snapped dimensions, §6).
  3. Build a ghost element array: each selected element with its
     frame replaced by its ghost world frame (and, for connectors,
     `start`/`end` replaced with the ghost endpoints).
  4. Call `paintGhostPreview(ghosts, ghosts, guides)` — both
     arguments are the ghost array so handles track the ghost
     (active size right now). Same call as the single non-table /
     non-rotated case above; the only difference is how `ghosts`
     was computed.
- On `pointerup`:

```ts
this.options.store.batch(() => {
  for (const [id, worldFrame] of frames) {
    this.options.store.updateElementFrame(
      slide.id,
      id,
      fromWorldFrame(worldFrame, scope, slide),
    );
  }
  for (const [id, { start, end }] of connectorEndpoints) {
    this.options.store.updateConnectorEndpoint(slide.id, id, 'start', start);
    this.options.store.updateConnectorEndpoint(slide.id, id, 'end',   end);
  }
});
```

`startRotate` already supports both single and multi via the existing
`isMulti = entries.length > 1` branch and `paintMoveGhost` with
handles anchored to the originals. The only change here is the
function rename — `paintMoveGhost` becomes `paintGhostPreview` and
the call signature stays `(ghosts, handleElements = originals)`. The
math extraction to `rotateMultiFrames` (§4) is an opt-in refactor
for symmetry with `resizeMultiFrames`; runtime behavior is unchanged.

### 5.5. Ghost preview pattern (unification)

The slides editor today has three live-preview paint paths:

| Path | Originals | Ghost | Handle anchor |
|---|---|---|---|
| `paintMoveGhost` (move drag) | full opacity | `GHOST_ALPHA` at new position | originals ("where it started") |
| `paintTableResizeGhost` (single table resize) | full opacity | `GHOST_ALPHA` table at new frame (cells scaled) | ghost ("active size now") |
| `paintLiveScoped` (single non-table resize, current code) | hidden — replaced in synthetic slide | n/a | replaced element |

The third path mutates the visible slide during the gesture, which
diverges from the other two. This design retires `paintLiveScoped`
for the resize / rotate gestures and routes every non-table resize
(single and multi) through one shared helper:

```ts
private paintGhostPreview(
  ghosts: readonly Element[],
  handleElements: readonly Element[],
  guides: readonly (SnapGuide | SmartGuide)[] = [],
): void
```

The body is identical to today's `paintMoveGhost`. The semantic
difference between move and resize is **captured by the caller**, not
by a new function:

- **Move** calls `paintGhostPreview(ghosts, originals, guides)` —
  handles stay where the gesture started.
- **Rotate** calls `paintGhostPreview(ghosts, originals, guides)` —
  the rotate handle is a direction control, not a position control;
  anchoring to the original keeps it on screen as a stable reference
  (matches existing single + multi rotate code and Google Slides).
- **Resize** calls `paintGhostPreview(ghosts, ghosts, guides)` —
  the resize handle is a position control; the dragged handle must
  follow the cursor for direct manipulation, so handles track the
  ghost.

`paintMoveGhost` is renamed to `paintGhostPreview` and its existing
single caller (the move drag) is updated. `paintLiveScoped` and its
module-private helper `patchElementFrames` are deleted outright: this
design assumed connector-endpoint drag and adjustment-handle drag
depended on `paintLiveScoped`, but inspection shows both call
`this.renderer.forceRender(...)` directly. Once single-resize moves
off `paintLiveScoped` (Task 3) the function has no remaining callers
and is removed. `paintTableResizeGhost` stays for single-table resize
because of its cell-width / row-height scaling; it already follows
the same handle-on-ghost convention.

Why migrate single non-table resize as well: the user's observation
is that resize visually swaps the original in place, which feels
disconnected from move and from single-table resize. The shared
helper is a 0-cost reuse and removes a real inconsistency. Existing
single-resize unit tests are unaffected (they assert frames at
commit, not paint pixels); visual-harness baselines for single
resize are refreshed in the same PR.

### 6. Snap and smart guides

- The bbox is the snap subject. `matchSize(newBbox, handle, others)`
  is unchanged in signature; `others` excludes every selected element.
- After `matchSize` returns the snapped bbox, recompute per-child
  frames against the matched bbox (run `mapPoint` again over the
  matched dimensions). This avoids drift between bbox snap and child
  positions.
- Equal-spacing trio guides during multi-resize are deferred —
  `slides-smart-guides.md` is single-subject by design.

### 7. Edge cases

| Case | Behavior |
|---|---|
| Drilled-in scope | `toWorldFrame` / `fromWorldFrame` round-trip per snapshot. Bbox is in world coords. Same as single-element. |
| Connector with both endpoints `attached` | No frame or endpoint write. Connector follows its attached shapes when they move. |
| Single connector + other elements | General multi path. Connector's `worldFrame` (computed bbox) participates in `startBbox`; endpoints map per §3. |
| Selection containing a group | Group's frame scales; group's `refSize` is unchanged → inner children stay proportional (existing render path). |
| Selection containing a table | Table's frame scales; cells follow via existing table render. The single-element ghost / `paintTableResizeGhost` path is **not** used in multi (would over-complicate live preview). |
| Min size | Per child clamped at `MIN_SIZE = 1`. Bbox clamps via `resizeFrame`. |
| Negative scale (drag past anchor) | `resizeFrame` already flips `left`/`right` so `newBbox.w >= MIN_SIZE`; per-child scale factor follows. We do not mirror children (Google Slides / PowerPoint don't either). |
| Empty selection | Resize / rotate handles are not rendered; nothing to wire. |
| Single selection | Uses existing math paths (`resizeFrame` / `resizeFrameWorld` / table) — see §5 routing table. Only the paint path migrates to `paintGhostPreview`. |

### 8. Files

- `packages/slides/src/view/editor/interactions/resize.ts`
  - New: `resizeMultiFrames` (pure).
  - Existing `resizeFrame` / `resizeFrameWorld` unchanged.
- `packages/slides/src/view/editor/interactions/rotate.ts` (extend, **deferred**)
  - Optional: `rotateMultiFrames` (pure). Multi-rotate is already
    wired in `startRotate` via the `isMulti` branch in
    `buildLiveState` (pre-existing), so extracting the math is a
    symmetry refactor with no runtime effect. Deferred out of the
    initial PR; runtime parity with the resize path is unchanged.
- `packages/slides/src/view/editor/editor.ts`
  - `startResize`: drop length guard; add the `length > 1` branch
    that calls `resizeMultiFrames` (§5). Single math paths
    (`resizeFrame`, `resizeFrameWorld`, table cell scaling) are
    unchanged; all non-table paint calls migrate from
    `paintLiveScoped` to `paintGhostPreview(ghosts, ghosts, guides)`.
    Single-table keeps `paintTableResizeGhost`.
  - `startRotate`: only the rename `paintMoveGhost` →
    `paintGhostPreview` (call signature unchanged: handles=originals).
    Multi-rotate path already exists.
  - Rename `paintMoveGhost` → `paintGhostPreview`; update the move
    drag's single call site.
- `packages/slides/src/view/editor/overlay.ts` — **no changes**.
  Handles already render correctly on the combined bbox.

### 9. Testing

**Unit (`interactions/resize.test.ts`):**

- `resizeMultiFrames` over fixtures:
  - Two unrotated rects, SE corner, no Shift → independent x/y scale.
  - Same, Shift → uniform scale.
  - W edge → width-only scale.
  - One rotated rect + one unrotated, SE corner, no Shift → rotated
    rect's `frame.w/h` scale in its local axes, rotation preserved,
    centre tracks bbox anchor.
  - Connector with `free` start, `attached` end → free endpoint
    moves, attached endpoint unchanged.
  - Per-child min-size clamp triggers without collapsing the bbox.
- `rotateMultiFrames` over fixtures:
  - Two rects, 90° → centres rotate, rotations += π/2.
  - Shift 14° → snaps to 15°.
  - Connector with one attached endpoint → free endpoint rotates,
    attached endpoint unchanged.

**Integration (`view/editor/editor.test.ts` and new
`view/editor/interactions/multi-resize.test.ts`):**

- Select 2 → drag SE corner → both element frames updated, single
  undo step.
- Select 3 (one group, one shape, one connector) → drag E edge →
  group's frame scales (refSize unchanged), shape stretches,
  connector free endpoint moves.
- Multi-rotate handle drag → all selected rotated rigidly around bbox
  centre.
- Drilled-in scope: drill into a group, select 2 children, resize →
  frames update inside the group's local coords.

**Visual (`packages/frontend/src/app/harness/visual/slides-scenarios.tsx`):**

- "multi-select resize": baseline 3-element selection with one
  rotated child, drag SE handle, screenshot before/after.
- "multi-select rotate": same set, drag rotate handle 45°.
- "resize ghost mid-drag": single shape, capture mid-`pointermove` so
  the screenshot includes both the full-opacity original and the
  `GHOST_ALPHA` preview at the new frame. Migrates the existing
  single-resize visual baselines (they currently capture the
  in-place `paintLiveScoped` output).
- "multi-resize ghost mid-drag": same idea with 2-element selection.

## Risks and Mitigation

| Risk | Mitigation |
|---|---|
| Drift between matched bbox snap and per-child positions | After `matchSize` returns the snapped bbox, re-run `mapPoint` against the matched bbox (§6). The map is cheap; running it twice keeps the children rigorously tied to the final bbox. |
| Rotated children look "stretched" under non-uniform scale | Expected per Google Slides / PowerPoint parity. Document in this design and offer Shift for uniform scale. Add a harness scenario so reviewers see the behavior. |
| Connector endpoints decoupling from attached shapes | Both products keep attached endpoints attached during multi-resize; we mirror that explicitly in `mapEndpoint`. Unit test covers the `attached` branch. |
| Tables in multi-resize don't get cell-scaled ghost preview | Multi uses the shared `paintGhostPreview` which scales the table frame visually but does not pre-scale `columnWidths` / `rows[].height`. Commit goes through `updateElementFrame`, which applies the cell scaling for real (existing path). Single-table resize keeps its dedicated `paintTableResizeGhost` for the higher-fidelity preview. |
| Renaming `paintMoveGhost` is a churn risk | Single call site (the move drag) and tests that reference the method by name. Caught at compile time by TypeScript; mechanical refactor. |
| Smart-guide equal-spacing absent during multi-resize | Documented as out of scope; the bbox snap (`matchSize`) is preserved. Equal-spacing during multi-resize is a separate engine question. |
| One-batch undo across many ids | Use `store.batch` (existing pattern); confirm in tests that one undo reverts the whole gesture. |
