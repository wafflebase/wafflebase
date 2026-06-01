# Lessons — slides shape-with-text hit-test

## Test the production ctx, not just the test ctx

The unit-test stub `createTestCanvas(1, 1).getContext('2d')` in
`packages/slides/src/view/canvas/test-canvas-env.ts` implements
`isPointInPath` by walking the path commands in their own coordinate
space — it ignores the canvas current transform entirely. Production
`CanvasRenderingContext2D.isPointInPath(path, x, y)` does *not*
ignore the transform when given a `Path2D` argument: the path's
commands are interpreted through the current matrix while (x, y)
stay in canvas-pixel space.

This means a class of hit-test bugs — anything where the renderer
leaves a transform applied — is invisible to the unit tests but real
in the browser. Going forward:
- When a hit-test code path touches `ctx.isPointInPath` /
  `ctx.isPointInStroke` with a `Path2D` arg, reset the transform to
  identity for the duration of the call.
- When debugging a hit-test that "should work" but doesn't,
  instrument the call directly in the browser (monkey-patch
  `ctx.isPointInPath` and log `ctx.getTransform()` alongside the
  args + result) instead of trusting the unit test result.

## Don't conclude until live behaviour confirms

This session's first hypothesis — viewer-mode read-only short-circuits
`attachInteractions()` — was based purely on the share-link default
role being `viewer` in the codebase. A 30-second curl against
`/share-links/<token>/resolve` proved the actual role on the reported
link was `editor`, invalidating the entire branch. Before writing a
diagnosis based on "the code says X happens", verify X actually
happens *for this specific reproduction*.

## Look for downstream regressions when folding shapes

PR #321 ("Slides: edit text inside shapes") folded inline text into
`ShapeElement.data.text`. The renderer side was updated to paint text
on top of the shape body, but the *hit-test* side
(`element-hit.ts:hitShape`) kept its old visibility gate
(`!hasFill && !hasStroke → reject`). When a new field can make an
element visible, every gate that decides whether the element is
present needs a matching update — including selection, hit-test, and
export. Worth adding to the slides-shapes design doc as a
maintenance checklist.

## Vite serves workspace packages via alias to src

`packages/frontend/vite.config.ts:154-156` aliases
`@wafflebase/{sheets,docs,slides}` to `../<pkg>/src/index.ts`. Editing
slides source is enough — no need to `pnpm slides build` for the dev
server to pick the change up. (Rebuilding `dist/` is only required
for the production bundle and for non-frontend consumers like the
backend tests.)
