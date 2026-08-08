# Board background grid — lessons

## The transparent canvas was the whole design

The decision that made this cheap was noticing that board-mode `drawSlide`
already `clearRect`s and paints no background. Everything else followed:
no slides API change, no per-frame cost, no minimap leak. The lesson is to
look for the seam that already exists before adding an option to a shared
renderer — the "obvious" implementation (a `grid` option on
`SlideRendererOptions`) would have been strictly worse on all three axes.

## A copy-pasted call site is where a feature goes missing

`editor.setViewport` + `minimap.repaintViewport` were repeated inline at
four call sites. Adding a third consumer (the grid) to all four by hand
would have worked until someone added a fifth pan path. Folding them into
`commitViewport` first, then adding the grid once, was less work AND the
safer order. When a new consumer has to be wired into N duplicated sites,
collapse the sites before wiring.

## Self-review caught what tests could not

The unit tests all passed while the grid failed to paint on an empty
board: `fitToContentOnce` never commits a viewport when there is nothing
to frame, and the mode/theme effect's first run lands before the container
exists (the component renders a loader until the document resolves). Two
independent "someone else will paint it initially" assumptions, neither
visible from a pure-function test. Reading the diff as a whole is what
surfaced it — for view wiring, trace the FIRST paint explicitly, not just
the update paths.

## Verify the build state before trusting a red gate

`pnpm verify:fast` failed twice on things that were not the change: an
uninstalled `mermaid` (the branch point had added it) and a slides
typecheck error that came from a stale `@wafflebase/docs` dist. Both
looked like a broken `main`. `pnpm install` + building the workspace
packages cleared both. Before reporting or fixing a failure in a package
you did not touch, confirm it reproduces from a current install and a
fresh build — otherwise you debug your own environment.

## Know what the smoke actually covered

The local stack has no dev auth bypass, so the automation browser could
not reach a board. The CSS mapping was verified for real by driving the
shipped module's output into a browser and screenshotting six
viewport/mode/theme cases; the in-app wiring (toolbar toggle, pan/zoom
sync, live theme switch) was not. Say which half was verified — "smoke
passed" would have been a false claim.
