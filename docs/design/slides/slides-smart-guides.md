---
title: slides-smart-guides
target-version: 0.5.0
---

# Slides Smart Guides (Equal Spacing / Distance / Size)

## Summary

Today the Slides editor snaps a dragged element to slide center, user
guides, and other elements' edges (`view/editor/snap.ts`). This proposal
adds three smart-guide patterns commonly found in PowerPoint and Google
Slides that fire while the user drags or resizes:

- **Equal spacing** — when three elements line up along an axis, the
  middle element snaps so the two gaps are equal.
- **Equal distance** — when the dragged element's gap to a neighbor
  matches a gap already formed by two other elements, the dragged
  element snaps to that distance.
- **Equal size** — during resize, the dragged element's `w` or `h`
  snaps when it matches another element's `w` or `h`.

All three render PowerPoint-style red double-headed arrow overlays
(equal-size renders a dashed outline on the matched element) so users
see *why* the snap fired.

### Goals

- Detect and snap to the three patterns above with the same 8 px
  threshold the existing `snap.ts` uses, so behavior feels consistent.
- Reuse `collectSnapCandidates` so there's a single source of truth for
  which neighbors are considered (root scope vs group drill-in, rotated
  AABB, exclude IDs).
- Render overlays in the same coordinate space as today's `SnapGuide`
  so a single overlay layer can draw both kinds.
- Keep the algorithm a pure function (`bbox in`, `{dx, dy, guides} out`)
  so it can be unit-tested without DOM/Canvas.

### Non-Goals

- Mobile (`MobileSlidesView` light edit). Touch drag has different
  threshold/feedback ergonomics; revisit in v2.
- Rotation-aware matching. Rotated elements still contribute their AABB
  the same way `snap-candidates.ts` already exposes them — we do not add
  rotation-pair alignment.
- Distance labels (the small "10 px" text Google Slides sometimes shows).
  PowerPoint omits these and the arrows already convey the relation.
- Tween/fade animation on guide appearance/disappearance — show on match,
  hide instantly on move-away or `mouseup`.
- Persisted user toggle. v1 ships always-on; a Preferences toggle can be
  added later if users ask.

## Proposal Details

### Module layout

```
view/editor/
├── snap.ts                ← existing (edge / slide-center / guide)
├── snap-candidates.ts     ← existing (scope-aware Frame collection)
├── smart-guides.ts        ← NEW (equal-spacing / equal-distance / equal-size)
└── editor.ts (drag + resize handlers)
```

The drag handler composes the two passes:

```ts
const others = collectSnapCandidates(slide, scope, excludeIds);
const snap   = snapDelta(bbox, dx, dy, others, slide, guides);
const smart  = smartGuides(bbox, snap.dx, snap.dy, others);
return {
  dx: smart.dx,
  dy: smart.dy,
  guides: [...snap.guides, ...smart.guides],
};
```

Order matters: `snap.ts` runs first so edge/center/user-guide snaps
win when both are in range; `smartGuides` then refines within the
remaining 8 px band.

The resize handler calls a parallel entry point:

```ts
const { w, h, x, y, guides } = matchSize(newBbox, handle, others);
```

### Types

```ts
type Span = { from: number; to: number; perpendicular: number };

export type SmartGuide =
  | { kind: 'equal-spacing';  axis: 'x' | 'y'; spans: [Span, Span] }
  | { kind: 'equal-distance'; axis: 'x' | 'y'; spans: [Span, Span] }
  | { kind: 'equal-size';     axis: 'x' | 'y'; matchedFrames: Frame[] };

export function smartGuides(
  bbox: { x: number; y: number; w: number; h: number },
  dx: number,
  dy: number,
  others: readonly Frame[],
): { dx: number; dy: number; guides: SmartGuide[] };

export function matchSize(
  bbox: { x: number; y: number; w: number; h: number },
  handle: ResizeHandle,
  others: readonly Frame[],
): { x: number; y: number; w: number; h: number; guides: SmartGuide[] };
```

`SmartGuide` is intentionally separate from `SnapGuide` because the
overlay shapes differ (arrow span vs single line). The overlay layer
imports both and dispatches on tag.

### Detection — equal spacing

Trio pattern, x-axis (mirror for y):

```
for each pair (L, R) in others where same row (overlapY) AND
                              L.right <= dragged.left AND
                              R.left  >= dragged.right:
  gapL = (dragged.left + dx) - L.right
  gapR = R.left - (dragged.left + dx + dragged.w)
  diff = gapR - gapL
  if |diff/2| <= 8: candidate(adjust = diff/2)

for each pair (A, B) in others where same row AND
                              dragged is on one side (left or right of both):
  gapInner = B.left - A.right            (between the two others)
  gapOuter = either dragged↔A or B↔dragged depending on side
  diff = gapInner - gapOuter
  if |diff| <= 8: candidate(adjust = diff)   (drag to make outer == inner)
```

"Same row" = perpendicular-axis bbox overlap. Two elements at very
different `y` should not generate an `x`-axis equal-spacing match.

Axes are independent — `x` may match equal-spacing while `y` matches
edge from `snap.ts`.

### Detection — equal distance

Pair → pair pattern:

```
knownGaps = []
for each pair (A, B) in others where same row AND A.right < B.left:
  knownGaps.push(B.left - A.right)

for each C in others where overlapY(C, dragged):
  for g in knownGaps:
    if C.right < dragged.left:
      target  = C.right + g
      adjust  = target - (dragged.left + dx)
    if C.left  > dragged.right:
      target  = C.left - g
      adjust  = target - (dragged.left + dx + dragged.w)
    if |adjust| <= 8: candidate
```

Smallest absolute `adjust` wins.

### Detection — equal size

Resize-only. Drag-move does not trigger equal-size matching (matches
PowerPoint and Google Slides behavior).

```
for each o in others:
  if |newBbox.w - o.w| <= 8: candidate(w → o.w, axis: 'x', matched: o)
  if |newBbox.h - o.h| <= 8: candidate(h → o.h, axis: 'y', matched: o)
```

Pick smallest `|adjust|` per axis. Axes are independent; `w` may match
shape A while `h` matches shape B. When several others share the same
matched dimension, **all** of them go into `matchedFrames` so the
overlay can highlight every peer.

Handle-aware origin compensation:

```
if handle includes 'w': x += (oldW - newW)
if handle includes 'n': y += (oldH - newH)
```

### Priority

Within the residual 8 px band after `snap.ts`:

```
edge / slide-center / guide   (already resolved by snap.ts)
  > equal-spacing             (3+ elements, strong visual)
  > equal-distance            (pair pattern, weaker)
```

`equal-size` lives in the resize path and does not compete with
positional snaps.

### Overlay rendering

Same HTML/CSS overlay that already paints `SnapGuide` via
`makeGuide` in `view/editor/overlay.ts`. New `makeSmartGuide` builds
DIVs in the same coordinate convention (`position * scale` for
placement). Color shared with the existing `#e11d48` guide red.

- Equal-spacing: **two** absolutely-positioned 1 px DIVs along the
  matched axis at the middle element's center line, each capped with a
  3-DIV arrowhead+stem composite (CSS borders for the chevrons)
- Equal-distance: same arrow primitive, drawn at both the existing
  `(A, B)` gap *and* the new `(C, dragged)` gap so the match is
  obvious at both ends
- Equal-size: 1 px dashed-border DIV (`border: 1px dashed #e11d48`)
  wrapping every entry in `matchedFrames`. No label

Guides disappear on the first frame they no longer match, or on
`mouseup`. No fade (`renderOverlay` already clears `innerHTML` per
call, so leaving guides off the next render is enough).

### Performance

| Concern | Mitigation |
|---|---|
| Trio scan is O(N²) | N is typically 5–20; pre-filter with `overlapY`/`overlapX` cuts most pairs |
| N > 30 slides | Cull candidates to those whose bbox lies within `slide.w/2` and `slide.h/2` of the dragged bbox |
| `collectSnapCandidates` cost | Already paid by `snap.ts`; reuse the same array |
| Threshold vs zoom | `SNAP_THRESHOLD = 8` is in slide coordinates today (matches `snap.ts`). `smart-guides.ts` uses the same constant from the same source so any future zoom-aware change applies to both |

### Group & rotated handling

`collectSnapCandidates` already returns rotated AABB and scope-correct
world frames. `smartGuides` and `matchSize` operate on those as-is.
Rotated-resize equal-size matching is excluded from v1 because the
handle coordinate space makes "same width" ambiguous.

### Mobile

`MobileSlidesView` light edit does not call `smartGuides`. Touch drag
needs separate threshold and overlay tuning.

### Tests

**Unit (`smart-guides.test.ts`):**

Equal-spacing: middle-trio within threshold, outside threshold,
end-of-trio (`drag — A — B`), perpendicular-axis miss, two competing
trios, edge-vs-spacing precedence.

Equal-distance: matching known gap, multiple known-gap candidates,
perpendicular miss.

Equal-size: each handle (`e`/`w`/`n`/`s`/`se`/etc.) with origin
compensation; both axes matched simultaneously; multiple matched peers
collected.

Boundary: empty `others`, very large/small dragged bbox, rotated
neighbor (AABB).

**Integration (`editor.test.ts` extension):**

- 3 shapes on a slide → drag middle → committed `frame.x` produces
  equal gaps
- Resize handle simulation → committed `frame.w` equals matched peer

**Visual (`pnpm verify:browser:docker`):**

2–3 screenshot diffs covering equal-spacing arrows and equal-size
dashed outline — regression protection only.

## Risks and Mitigation

| Risk | Mitigation |
|---|---|
| Snap "fights" the user near multiple candidates within 8 px | Strict priority order (edge > equal-spacing > equal-distance) and smallest-`|adjust|` tie-break keep behavior deterministic |
| Overlay noise during free movement | Guides only render on the frames they actually snap, and disappear instantly when out of band |
| O(N²) on dense slides | `overlapX`/`overlapY` pre-filter prunes 90% of pairs; viewport culling triggers at N > 30 |
| Inconsistency vs distribute action in `align.ts` | Both compute "equal gaps" the same way (`(last - first - Σw) / (n - 1)`); same fixtures can verify both |
| Behavior diverges from PowerPoint/GS in subtle cases | v1 explicitly matches PowerPoint where the two products differ (no labels, drag-move skips equal-size, end-of-trio supported). Add Preferences toggle later if users disagree |
