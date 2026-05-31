---
title: Slides connector elbow/curved routing
status: active
owner: hackerwins
related-design: docs/design/slides/slides-connectors.md (PR2)
---

# Slides connector elbow/curved routing

## Why

`docs/design/slides/slides-connectors.md` PR1 shipped with straight
routing only. `routing.ts` exported `routeStraight` only;
`connector-renderer.ts` always called it regardless of `el.routing`.
The PPTX importer maps `bentConnector*` → `'elbow'` and
`curvedConnector*` → `'curved'` (`import/pptx/shape.ts:711-715`), but
those connectors rendered as straight lines.

Reported by the user: slide 24 of `Yorkie, 캐즘 뛰어넘기.pptx` (4×
`curvedConnector2`) shows straight lines instead of curves.

Per request "동시에 처리 / 같은 PR에서 진행" — scope expanded to the
full PR2 surface (toolbar tools, right-click routing change, store
methods for routing + elbow bend, per-shape connection sites), except
for the elbow-bend yellow-diamond drag interaction which is deferred
to a follow-up PR (still requires its own overlay surface).

## Routing engine

- [x] `routing.ts` — `routeCurved` (cubic bezier, control points =
      `dist/3` along exit angles) and `routeElbow` (Manhattan polyline
      with cardinal snap, optional `bend` for the parallel-opposite Z
      cross-leg). Exports `ConnectorPath` union + `isBezierPath`.
- [x] `connector-frame.ts` — `resolveEndpointWithDir` (free fallback:
      `atan2(other - self)`), `buildConnectorPath` dispatcher,
      `computeConnectorFrame` tight bbox (polyline + cubic bezier
      parametric extrema).
- [x] `connector-renderer.ts` — draws `bezierCurveTo` for curved,
      polyline `lineTo` for elbow; arrowhead angle = path-local
      tangent (bezier derivative / first/last distinct segment).
- [x] `element-hit.ts` — hit-test against actual path (polyline +
      32-step bezier sampling).
- [x] `ctx-spy.ts` — `bezierCurveTo` added.

## Store

- [x] `SlidesStore.updateConnectorRouting(slideId, id, routing)` —
      switches routing, clears `elbowBend` on leaving elbow, recomputes
      `frame`.
- [x] `SlidesStore.updateConnectorElbowBend(slideId, id, bend)` —
      persists user-dragged bend ratio (rounded to 0.01); `undefined`
      clears.
- [x] `MemSlidesStore` implements both with batch/undo guards and
      validation that the target is a connector.

## Insertion + toolbar

- [x] `ConnectorInsertKind` extended with `'connector:elbow'` and
      `'connector:curved'` (`editor.ts`); `connectorVariant` switch.
- [x] `ConnectorInsertVariant` extended; `buildConnectorInit` sets the
      correct `routing` per variant and gives Arrow / Elbow / Curved
      all an end arrowhead by default (Line gets none — GS parity).
- [x] `LINE_PICKER_ENTRIES` adds "Elbow connector" + "Curved
      connector" (frontend); `isLinePickerKind` extended.
- [x] `drawConnectorIcon` paints L-shape for elbow, cubic-bezier for
      curved; arrowhead aligns with the local end-tangent.
- [x] LinePicker dropdown width bumped to 200px + `whitespace-nowrap`
      on labels (the new entries wrapped to two lines at 160px).

## Right-click menu

- [x] Single-connector selection adds a `Straight` / `Elbow` /
      `Curved` radio group to the context menu (mirrors the existing
      Align text vertical group). Selecting writes through
      `store.updateConnectorRouting`.

## Per-shape connection sites

- [x] `connection-sites/overrides.ts` — diamond / parallelogram /
      trapezoid (4-sided shapes following OOXML `[T, L, B, R]`
      convention, rect-remap-compatible); pentagon / hexagon /
      octagon (≥5 sites → OOXML idx ≥ 4 bypasses rect remap);
      star4..star10 vertex anchors.
- [x] Triangle / rtTriangle deliberately excluded — 3-site OOXML
      `cxnLst` would be scrambled by the importer's 4-site rect
      remap. Future: per-shape ooxml→waffle index table.
- [x] `getConnectionSites(el)` consults `CONNECTION_SITES` and falls
      back to `fourCardinal()` for other shapes / non-shape elements.

## Tests

- [x] `routing.test.ts` — `routeCurved` control-point math, degenerate
      coincident endpoints; `routeElbow` for perpendicular L, parallel-
      opposite Z (facing each other, w/ and w/o bend, w/ clamp),
      parallel-opposite U (facing away), parallel-same C; non-cardinal
      angle snap.
- [x] `connector-renderer.test.ts` — curved emits `bezierCurveTo` (not
      `lineTo`); elbow emits polyline `lineTo`s; arrowhead renders on
      curved end.
- [x] `connector-frame.test.ts` — curved bbox extends past endpoint
      AABB when the exit angle pulls the curve outside the chord;
      elbow bbox covers the corner.
- [x] `connection-sites.test.ts` — diamond/parallelogram/pentagon
      overrides; non-shape elements get cardinal default.
- [x] `memory.test.ts` — `updateConnectorRouting` switches routing
      and clears `elbowBend` on exit; `updateConnectorElbowBend`
      rounds to 0.01 and clears on undefined.
- [x] `line-picker.test.ts` (frontend) — 4 entries in GS order;
      `isLinePickerKind` accepts elbow/curved.

## Out of scope (follow-up PR)

- `elbow-bend-drag.ts` — yellow-diamond drag handle UI for adjusting
  `elbowBend` interactively. The data + routing engine already
  support it; only the overlay + interaction handler remain.
- Per-shape connection sites for triangle / rtTriangle / 3-sided
  OOXML cxnLst shapes (needs per-shape ooxml→waffle index table).
- Inspector-panel arrowhead picker (open variants, sm/md/lg sizes).

## Verification

- [x] `pnpm --filter @wafflebase/slides test` — 1554 pass / 2 skip.
- [x] `pnpm verify:fast` — frontend / backend / sheets / slides / cli
      / docs all green.
- [ ] Manual: slide 24 of `Yorkie, 캐즘 뛰어넘기.pptx` renders the 4
      `curvedConnector2` connectors as curves after browser reload
      (no re-import — data was already stored with `routing:
      'curved'`); new Line ▾ dropdown lists Line / Arrow / Elbow
      connector / Curved connector on a single line each; right-
      clicking a selected connector shows the Straight / Elbow /
      Curved radio with the current routing marked.

## Lessons

See `20260601-slides-connector-elbow-curved-routing-lessons.md`.
