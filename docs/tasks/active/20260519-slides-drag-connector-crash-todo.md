# Slides — dragging a connector crashes editor

## Symptom

Selecting a connector and dragging (mouseup at end) throws:

```
Uncaught Error: Element <id> is a connector; update its endpoints instead of its frame
  at YorkieSlidesStore.updateElementFrame
  at editor.ts onUp (startDrag)
```

Same crash reproduces by keyboard arrow-nudge on a connector, and by
align/distribute/rotate when the selection includes a connector.

## Root cause

Editor selection-translate paths funnel every selected element through
`store.updateElementFrame`. The store rejects that for connectors —
their `frame` is derived from `start`/`end` endpoints — and the rule is
to mutate endpoints via `updateConnectorEndpoint` instead.

## Fix

Add `translateElement(store, slideId, el, dx, dy)` helper:

- Non-connector → `updateElementFrame({ x: x+dx, y: y+dy })`.
- Connector → for each `kind === 'free'` endpoint, call
  `updateConnectorEndpoint(side, { kind: 'free', x: x+dx, y: y+dy })`.
  Attached endpoints are left alone (they follow their host shape; the
  store recomputes the cached connector frame).

Wire it into:

- [x] `startDrag` commit (multi-select translate; the reported crash)
- [x] `paintLive` during a drag — render the connector's translated
      endpoints in the synthetic slide so the line follows the cursor
      visually instead of staying put until commit
- [x] keyboard nudge (`interactions/keyboard.ts`)
- [x] `applyFrameUpdates` (align/distribute) — translate connectors by
      `targetFrame - origFrame` delta; leave size/rotation untouched
- [x] `rotateBy` — skip connectors (their frame rotation is always 0)

## Tests

- [x] Editor test: select a connector, simulate pointerdown/move/up,
      assert no throw + endpoints translate by the drag delta.
- [x] Editor test: select connector + shape together, drag — both
      translate; attached endpoint follows its host.
- [x] Keyboard nudge on a free connector translates endpoints.
- [x] `pnpm verify:fast` green.

## Out of scope

- Visual polish for connectors with both endpoints attached to shapes
  outside the selection (would rubber-band) — current behavior matches
  intent (attachment wins).
- Multi-select resize for connectors (still a v2 item).
