# Slides: rotated resize-handle cursors

## Problem

When a single slide element is rotated, its 8 resize handles still show
axis-aligned CSS cursors (`ns-resize` / `ew-resize` / `nwse-resize` /
`nesw-resize`) keyed only by handle direction. So a 90°-rotated element's
top (`n`) handle shows a vertical `ns-resize` cursor even though the handle
now stretches the element horizontally. The cursor should follow the
element's rotation.

Note: the resize *math* already handles rotation
(`resize.ts` `resizeFrameWorld` projects the drag delta into the frame's
local axes). Only the **cursor hint** is missing.

## Approach

Resize cursors repeat every 45° and are symmetric across 180°, so there are
only 4 distinct cursors. Take each handle's base outward-normal angle, add
the frame rotation, quantise to the nearest 45° bucket (mod 180°), map to a
cursor. At rotation 0 this reproduces `RESIZE_HANDLE_CURSORS` exactly.

## Tasks

- [ ] Add `rotatedResizeCursor(handle, rotation)` to `hit-test.ts` with a
      base-angle map, `mod 180 → 45° bucket` quantisation.
- [ ] Thread `rotation` into `overlay.ts` `handleCursor` / `makeHandle`;
      pass `frame.rotation` from `renderRotatedHandles`.
- [ ] Apply the same rotated cursor to crop handles (`makeCropHandle`,
      `renderCropHandles` already has the rotated frame).
- [ ] Unit test: rotated helper agrees with `RESIZE_HANDLE_CURSORS` at
      rotation 0, and rotates correctly at 45°/90°.
- [ ] `pnpm verify:fast` green.

## Out of scope

- Edge-zone hover cursor beyond the 5° cap: `edgeZoneAt` uses axis-aligned
  geometry for the hover-band detection, so un-capping it needs rotated
  hit-band math, not just a rotated cursor. Separate change.
- Multi-select rotated resize (v2 item, axis-aligned bbox).
