# Slides — connector drag crash lessons

## What broke

`startDrag` (and `applyFrameUpdates`, `rotateBy`, keyboard nudge) all
funnelled selected ids through `store.updateElementFrame`. The store
guards connectors because their `frame` is derived from `start`/`end`
endpoints — selecting a connector and dragging therefore threw on
mouseup.

A second, quieter bug rode along: `paintLive` patched only `frame`
during a drag. Connectors render off the endpoint positions, so the
visual line did not follow the cursor — only the cached bbox moved.
The user never saw motion until the throw cancelled the gesture.

## What to keep in mind

- **Derived state needs its own write path.** When a model field is
  derived (`frame` from endpoints), every selection-iteration helper
  has to fork on element type, not just the store. Future "translate
  selection" entry points (e.g. a new toolbar action) should route
  through `commitTranslate(store, slideId, el, dx, dy)` from
  `interactions/drag.ts`, not call `updateElementFrame` directly.
- **paintLive needs the same fork.** A `Map<id, Frame>` is not enough
  for connectors. The replacement signature takes
  `Map<id, Element>` — callers pre-translate via the pure
  `translateElement(el, dx, dy)` helper, which mirrors what
  `commitTranslate` will write at mouseup so preview = commit.
- **Attached endpoints stay put intentionally.** Translating a
  connector by (dx, dy) moves only `kind: 'free'` endpoints. Attached
  endpoints follow their host shape; if the host is also in the
  drag selection its frame moves and the store's
  `recomputeDependentConnectorFrames` (mem) /
  `recomputeDependentConnectorFrames` (yorkie) refreshes the cached
  bbox. If the host is *not* in the selection, the connector
  rubber-bands — desired behavior (attachment wins).
- **rotateBy on a connector is a no-op.** A connector's frame
  rotation is always 0 (derived). Skip the element entirely rather
  than trying to translate "rotation" through the endpoints.
- **align/distribute translate connectors by (newX - oldX).** They
  pass a target `Frame`; `applyFrameUpdates` computes the implied
  delta and routes through `commitTranslate`. Size/rotation fields
  are ignored for connectors because they're derived.
- **`commitTranslate(dx=0, dy=0)` is a no-op by design.** Earlier
  paths emitted a redundant `updateElementFrame` op for
  click-without-drag; the new helper short-circuits, so the Yorkie
  changelog no longer carries a noise op for that case. Affects
  every translate caller (drag, nudge, align, distribute) — if a
  caller deliberately wants to "touch" an element with zero delta
  (e.g. to trigger a remote subscription), it must use a different
  mutation, not call `commitTranslate(0, 0)`.
