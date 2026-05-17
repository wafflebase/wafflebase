# Lessons — Slides text-box click scale bug

## Where to look when a click in a Canvas-based editor "lands far from
## where the user clicked"

The first instinct is to look at the hit-test math (`findPositionAtPixel`),
but in practice the regression is almost always at a **layer boundary**
where one side reasons in host pixels and the other in logical pixels.
For Canvas-rendered surfaces, the candidates are:

1. The shim that converts pointer coords (`getScaleFactor`,
   `getCanvasOffsetTop`, `container.getBoundingClientRect`) into
   layout-local coords.
2. The render-side scale (`ctx.scale(dpr * scale, ...)`) — but this
   only affects drawing, not clicks.
3. The container's CSS transform (`transform: scale(...)`).

The hit-test code itself (`findPositionAtPixel`) is straightforward —
if `localX` and `run.x` are in the same coordinate space, alignment
already "just works" via `applyAlignment` mutating `run.x` directly.

User symptom: caret jumps to offset 0 on click. Symptom is most visible
on **center/right-aligned** text because the rendered glyphs sit far
from the layout origin, so an undersized `localX` drops into the
`localX < firstRun.x` branch and snaps to line start.

## Tests at scale=1 won't catch scale-propagation bugs

`packages/slides/test/view/editor/text-box-editor.test.ts` ran all
scenarios at `hostWidth: 1920` (= slide width), which makes
`scale = 1` and silently dodges the entire class of bug. **Any shim
that takes a `scale` should be exercised at scale ≠ 1 in tests.**

## jsdom rAF flush timing

The docs text-box's `requestRender` uses `requestAnimationFrame`. jsdom
polyfills rAF via setTimeout, but `setTimeout(0)` is sometimes too tight
to flush a render cycle plus the cursor-blink scheduling that runs
after `cursor.moveTo`. Use `setTimeout(16)` (one frame) for assertions
that depend on a callback firing from inside `renderNow`.

**Why:** the docs paint pipeline batches via `requestAnimationFrame`,
and `cursor.moveTo` re-arms the blink interval before the paint
deduper releases — both go through the same scheduler.
**How to apply:** any test that mounts a docs/slides editor in jsdom
and asserts on cursor-position callbacks should await ~16 ms (one
frame), not 0 ms, after dispatching the input event.

## Workspace dist must be rebuilt for cross-package typecheck

`packages/slides/tsconfig.json` consumes `@wafflebase/docs` types from
the package's published `dist/*.d.ts`. The vite test alias points to
source for runtime but TypeScript still reads dist. Adding a new field
to `TextBoxEditorOptions` requires `pnpm --filter @wafflebase/docs build`
before `pnpm verify:fast` will succeed on the slides typecheck step.
