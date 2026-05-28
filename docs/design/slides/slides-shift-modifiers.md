---
title: slides-shift-modifiers
target-version: 0.4.2
---

# Slides Shift Modifiers — Draw / Move / Endpoint Constraints

## Summary

Extend the slides editor with Google Slides / PowerPoint parity Shift
modifiers during four drag interactions: drawing shapes (1:1 aspect),
drawing lines and connectors (15° angle snap), dragging connector
endpoints (15° angle snap), and moving selected elements (axis lock).
Shape resize Shift (aspect ratio) and rotate Shift (15° snap) already
exist; this work fills the remaining gaps and unifies the mental model
that "Shift = constraint" across every draggable interaction.

### Goals

- Shape draw + Shift → force `w === h` (squares, circles, regular
  triangles, etc.) for every `ShapeKind`.
- Connector / line draw + Shift → snap the end-point angle to 15°
  increments while preserving drag length.
- Existing line / connector endpoint drag + Shift → same 15° snap,
  relative to the opposite endpoint's world position.
- Element move + Shift → axis-lock to the dominant displacement axis
  (max-displacement model, switches live).
- Live (per-`mousemove`) sampling of `e.shiftKey`, matching the
  existing `resizeFrameWorld` / `applyRotate` pattern. Pressing or
  releasing Shift mid-drag updates the constraint immediately.
- Pure-function constraint math co-located with existing interaction
  helpers, fully unit-testable without a DOM.

### Non-Goals

- **Alt = resize-from-center** (Google Slides supports it). Separate
  design; orthogonal extension point.
- **Ctrl-drag = duplicate-move** (Google Slides supports it). Separate
  design.
- **Local-axis lock for rotated frames.** `lockAxis` operates in world
  H / V; Google Slides does the same.
- **Customizing the angle-snap step** (currently 15° everywhere via
  `rotate.ts`'s `STEP = π/12`).
- **Mouse / touch differences.** Touch interactions are out of scope
  for this pass — Shift is a keyboard modifier.

## Proposal Details

### Existing Shift behavior (preserved, no change)

| Site | Behavior | File |
|---|---|---|
| Corner resize handle + Shift | Preserve aspect ratio | `interactions/resize.ts` `preserveAspect` |
| Rotate handle + Shift | Snap to 15° | `interactions/rotate.ts` `STEP = π/12` |
| Adjustment handle + Shift | Snap to per-shape defaults | `editor.ts` `snapToDefaults` |
| Arrow-key nudge + Shift | Larger nudge step | `interactions/keyboard.ts` `NUDGE_SHIFT` |
| Tab + Shift | Reverse element-cycle direction | `interactions/keyboard.ts` |

### New scope

| Site | Behavior | Source of truth |
|---|---|---|
| Shape draw drag + Shift | Force `w === h` from drag rect | `constrainToSquare` |
| Connector / line draw drag + Shift | Snap endpoint to 15° angle from start | `snapEndpointAngle` |
| Endpoint drag (existing connector) + Shift | Snap dragging endpoint to 15° relative to opposite endpoint | `snapEndpointAngle` |
| Element move drag + Shift | Project `(dx, dy)` onto dominant axis (max-displacement) | `lockAxis` |

### Architecture

**New module:**
`packages/slides/src/view/editor/interactions/constraints.ts`

Three pure functions. No DOM, no editor reference, no shared state —
mirrors the structure of the sibling `resize.ts`, `rotate.ts`, and
`adjustment.ts` modules.

```typescript
const ANGLE_STEP = Math.PI / 12; // 15°, same as rotate.ts STEP

/**
 * Force a 1:1 aspect on the drag rect. The longer of |dx| / |dy| sets
 * the side length; the shorter axis's sign is preserved so the result
 * stays in the user's drag quadrant (NW / NE / SE / SW).
 *
 * If start === end, returns end unchanged.
 */
export function constrainToSquare(
  start: { x: number; y: number },
  end:   { x: number; y: number },
): { x: number; y: number };

/**
 * Rotate `end` around `start` so the angle from start→end snaps to the
 * nearest 15° increment. Length |end - start| is preserved (only
 * direction changes).
 *
 * If start === end (zero-length vector), returns end unchanged — no
 * meaningful angle exists.
 */
export function snapEndpointAngle(
  start: { x: number; y: number },
  end:   { x: number; y: number },
): { x: number; y: number };

/**
 * Project a pointer delta onto the dominant axis. When |dx| >= |dy|
 * returns (dx, 0); otherwise (0, dy). Tie-break (|dx| === |dy|): X
 * wins for determinism, matches Google Slides observed behavior.
 *
 * Re-evaluated every mousemove — when the user changes drag direction
 * mid-stream, the lock switches axes naturally.
 */
export function lockAxis(
  dx: number,
  dy: number,
): { dx: number; dy: number };
```

Constants kept inline. `ANGLE_STEP` duplicates `rotate.ts`'s `STEP` —
acceptable cost for module independence (no cross-import).

### Call sites

**B1 — Shape draw (`editor.ts:1934-1939`, `startInsert` onMove):**

```typescript
const onMove = (ev: MouseEvent) => {
  const raw = this.clientToLogical(ev.clientX, ev.clientY);
  endPoint = ev.shiftKey ? constrainToSquare(start, raw) : raw;
  const init = buildInsertElement(kind, start, endPoint);
  const ghost = { ...init, id: '__preview__' } as Element;
  this.renderer.forceRender(slide, this.options.store.read(), [ghost]);
};
```

Applies to every `ShapeKind` (all 55 in the shape library — Rectangle,
Ellipse, Triangle, Star, etc.). Text-box insert (`kind === 'text'`)
follows a separate code path earlier in `startInsert` and is excluded —
Google Slides also exempts text boxes. Click-without-drag (sub-threshold)
falls through to `buildInsertElement`'s default-sized path; Shift is a
no-op there, matching GS.

**B2 — Connector draw (`editor.ts:2009-2018`, `startConnectorInsert` onMove):**

```typescript
const onMove = (ev: MouseEvent) => {
  const raw = this.clientToLogical(ev.clientX, ev.clientY);
  endPoint = ev.shiftKey ? snapEndpointAngle(start, raw) : raw;
  this.connectorCursor = endPoint;
  const init = buildConnectorInit(
    variant, start, endPoint, slide.elements, this.scale(),
  );
  const ghost = { ...init, id: '__preview__' } as Element;
  this.renderer.forceRender(slide, this.options.store.read(), [ghost]);
  this.repaintOverlay();
};
```

**Decision — connection site vs angle snap:** Shift wins. The snapped
coordinate is what `buildConnectorInit` sees, so attachment falls out
naturally: if the snapped point lands inside a connection-site radius,
the endpoint attaches; otherwise it stays free. No extra branching.
Live feedback (the dot doesn't light up) teaches the user to release
Shift when they want to attach. Matches Google Slides.

**B3 — Existing connector endpoint drag + Shift → 15° snap:**

The endpoint-drag handler lives in `editor.ts` (exact symbol to be
identified during implementation; current grep places connector
endpoint resolution near `resolveEndpoint` usage around the move-drag
ghost code). Once located, the transform is:

```typescript
const otherWorld = resolveEndpoint(otherEndpoint, slideLookup);
const draggedRaw = this.clientToLogical(ev.clientX, ev.clientY);
const dragged = ev.shiftKey
  ? snapEndpointAngle(otherWorld, draggedRaw)
  : draggedRaw;
// ... commit `dragged` as the new endpoint (free or attached per site test)
```

- Angle is computed from the **fixed opposite endpoint's world coordinate**.
- Length is whatever the user drags; only direction is constrained.
- If the dragged endpoint was previously attached: Shift overrides
  attachment the same way as B2. The snapped coordinate's site test
  decides re-attachment vs detach to free.

**B4 — Element move drag + Shift → axis lock (`editor.ts` near 2180):**

```typescript
const rawDx = cur.x - start.x;
const rawDy = cur.y - start.y;
const { dx: liveDx, dy: liveDy } = ev.shiftKey
  ? lockAxis(rawDx, rawDy)
  : { dx: rawDx, dy: rawDy };
// ... existing ghost-frame computation, snap-guide pass, etc.
```

- Axis is re-decided every frame from cumulative `(rawDx, rawDy)`, so
  the lock follows the user's intent if they change direction.
- Multi-select: the same `(liveDx, liveDy)` is applied to every selected
  element (existing loop), so the whole group moves in lockstep along
  one axis.
- Drilled-in group children: pointer delta is in world space; scope-local
  conversion happens at commit time. No change required for groups.
- Connector free endpoints get `(liveDx, liveDy)` added; attached
  endpoints follow their host. Same path as today, no extra Shift logic.
- Smart-snap-guide interaction: Shift applies first, then snap-guide
  fine-tunes. Guides only nudge along the locked axis — Google Slides
  behaves identically.

### Why the helper module (vs inline `if (ev.shiftKey)` blocks)

- Matches the project's existing pattern: `resizeFrame`, `applyRotate`,
  `snapToDefaults` are all pure helpers next to their consumers.
- Snap math (especially `snapEndpointAngle`'s atan2 + cos/sin) is
  duplicated across B2 and B3 if inlined.
- Pure functions are vitest-friendly; the consumer call sites become
  single-line and self-documenting.
- A centralized "ModifierState" manager (the third option considered)
  would be over-architected for three pure transformations and would
  diverge from the existing `interactions/` convention.

### Testing

**Unit — `packages/slides/test/view/editor/interactions/constraints.test.ts`** (new)

| Function | Coverage |
|---|---|
| `constrainToSquare` | All four drag quadrants (NW / NE / SE / SW); `|dx| > |dy|` and reverse; sign preservation on the shorter axis; `start === end`; exact `|dx| === |dy|` tie |
| `snapEndpointAngle` | 0 / 15 / 30 / 45 / 90 / 180 / 270 / 345° inputs unchanged; 7° → 0°, 8° → 15° boundary; 22° → 15°, 23° → 30°; length preservation (epsilon-tolerant); all four quadrants; `start === end` → unchanged |
| `lockAxis` | `|dx| > |dy|` → `(dx, 0)`; reverse; `|dx| === |dy|` → X-wins; `(0, 0)` → `(0, 0)`; sign preservation for negative deltas |

**Integration — extend existing editor interaction specs**

- Shape insert drag with `shiftKey: true` → committed frame has
  `w === h`.
- Connector insert from `(0, 0)` to `(100, 30)` with Shift → endpoint
  lands at `(100, 26.79...)` (atan2 = 15°).
- Connector insert with Shift near a connection site that is **not**
  on the snapped trajectory → endpoint stays free.
- Connector endpoint drag with Shift → committed endpoint angle is a
  15° multiple from the opposite endpoint.
- Element move (50, 10) with Shift → `dx = +50`, `dy = 0`.
- Multi-select move with Shift → every selected element has the same
  `(dx, dy)` along the locked axis.
- Regression: corner resize + Shift still preserves aspect; rotate +
  Shift still snaps 15°.

**Manual smoke (pre-merge, `pnpm dev`)**

- Rectangle and Ellipse drag + Shift produce visually exact square /
  circle.
- Line tool: draw at 0°, 45°, 90°. Boundary at 7°/8°.
- Existing line endpoint: rotate with Shift, verify 15° clicks.
- Two-element selection + Shift-drag confines to one axis; multiple
  selected items all translate together.
- Rotate handle and corner resize Shift still behave as before.

### Documentation

Update `docs/design/slides/slides-keyboard-shortcuts.md` with a new
"Shift modifiers during drag" section reproducing the new-scope table
above. The in-app shortcuts-help modal (which reads from
`shortcuts-catalog.ts`) gets corresponding entries so users can
discover the behavior without reading docs.

No new top-level catalog category is needed — these live under a
"Drag modifiers" subsection of the existing keyboard help.

### Rollout

One PR, but split into commits the reviewer can read independently:

1. `constraints.ts` + unit tests (math only, no call sites — passes
   on its own).
2. B1: shape draw call site.
3. B2: connector draw call site.
4. B3: endpoint drag call site.
5. B4: move drag call site.
6. Docs update (`slides-keyboard-shortcuts.md` + shortcuts catalog).

Each commit independently green under `pnpm verify:fast`.

## Risks and Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Snap-guide vs axis-lock interaction in B4 produces unexpected drift | Med | Med | Apply `lockAxis` **before** snap-guide adjustment; integration test asserts guide nudges only along the locked axis |
| Connection-site vs angle-snap collision (B2/B3) confuses users | Med | Low | Documented decision: Shift wins, attachment falls out from snapped coordinate. Live feedback (dot doesn't light up) is self-teaching. No extra branching keeps the code simple |
| Mac Shift + click is multi-select toggle — drag conflict? | Low | Low | Multi-select reads Shift at `mousedown`; drag constraints read at `mousemove`. Separate code paths, no interference |
| B3 endpoint drag handler location not what the design assumes | Low | Med | Implementation task starts with a `grep`-driven scan to confirm the symbol; if endpoint drag re-uses the generic resize path, B3 needs a kind-specific branch (still small) |
| Cross-platform `e.shiftKey` differences | Low | Low | Existing resize/rotate Shift already uses `ev.shiftKey` and works cross-platform; same primitive |
| Resize Shift (aspect ratio) and new Shift behaviors confuse users with "different meanings" | Low | Low | All five behaviors fall under "Shift = constraint" — aspect, angle, axis. Documented together in the keyboard-shortcuts page |
