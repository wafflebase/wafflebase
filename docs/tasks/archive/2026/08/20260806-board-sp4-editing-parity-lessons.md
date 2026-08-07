# Board SP4 Editing Parity — Lessons

Captured while implementing `docs/design/board/board-editing-parity.md` on
branch `board-sp4-editing-parity`.

## Scoping: read the engine before believing the package README

Two of the five features scoped for SP4 turned out to be partly or wholly
built already, and both misreads came from searching the wrong layer.

- **The canvas context menu already existed.** Grepping
  `packages/frontend/src/app/slides/` for `ContextMenu` found nothing, so
  the initial scope treated a board right-click menu as net-new UI. It
  lives in the *engine* (`packages/slides/src/view/editor/editor.ts`,
  `onContextMenu` → `elementContextItems` / `canvasContextItems`), and the
  board already consumed it — `board-view.tsx` was already passing
  `suppressSlideChrome: true` to drop the slide-scoped "Change layout…"
  entry. A whole sub-project collapsed into adding two menu entries.
- **`Mod+A` select-all already existed** as a keyboard rule
  (`shortcuts-catalog.ts`), with no menu affordance. The menu entry
  dispatches it rather than adding selection logic.

Rule: when a feature might already exist, grep the engine package and the
`view/editor/` internals, not just the React mount directory. Absence in
`app/<feature>/` proves nothing.

## Reuse traps hide in the *semantics*, not the types

Every slides toolbar control typechecked against `YorkieBoardStore`
immediately — `read()` returns a real `SlidesDocument` whose single
synthetic slide is the board. That made the reuse look free. The two real
problems were behavioural and invisible to the compiler:

- **`editor.align()` aligns a single selected element to the 1920×1080
  slide canvas.** On an unbounded plane that teleports a lone element into
  a phantom rectangle near the world origin. Fixed by raising the board's
  Align threshold (`minAlignSelection`), not by changing `align()` — the
  slide rule is correct for slides.
- **`Fit` means different things in the two products.** On slides it is an
  idempotent sizing *mode*; on a board it is an *action* ("re-frame the
  content now"). Reusing the slides `ZoomController` shape meant
  `set(FIT_ZOOM)` early-returned on an unchanged value, so the dropdown's
  Fit was **dead in the board's default state** — the controller starts at
  `FIT_ZOOM`. Resolved with a `createBoardZoomBinding` that applies on the
  *intent* rather than on the value-change notification.

Rule: when reusing a component across two products, diff the *meaning* of
its states, not just its interface. A clean typecheck is not evidence.

## Clamp ranges are a semantic boundary too

The board viewport clamps zoom to `[0.1, 8]`; the slides controller clamps
to `[0.25, 4]`. Reusing slides' `createZoomController` verbatim would have
clipped the wheel-zoom write-back and left the toolbar reporting a scale
the canvas was not at. Two independently maintained copies of a range that
*happen* to match today are also a latent bug: the first wheel write-back
design was an accidental identity that only held because the two ranges
were equal.

## Tests that all start from the identity case prove nothing

Every `applyZoomValue` test seeded `DEFAULT_VIEWPORT`, whose `zoom` is `1`
— so `target / vp.zoom` and a plain `target` were indistinguishable, and
deleting the division left the suite green. The conversion is the module's
entire reason to exist, and it was untested for the case (`zoom != 1`)
that becomes the common case on the first wheel tick.

Rule: for any function that transforms a value, at least one test must
start from a non-identity input. Mutation-test the core expression before
believing a green suite.

## The manual smoke was the gap that mattered

No dev server was available, so the two-tab smoke was skipped on every
task. The final whole-branch review found a **Critical** defect that every
unit test structurally could not see:

A peer's cursor tick → `setPeers` → `repaintOverlay` → `overlay.innerHTML
= ''` detached the docs IME textarea (it lives inside the text-box
container, inside the overlay); `reattachEditingTextBox` re-appended it but
never restored focus. With two tabs open, typing in a sticky lost focus
~60×/s while the other user moved their mouse, and keystrokes fell through
to the global key rules — `Delete` deleted the selected element.

Every board test mocks the text box (`makeMockMount`), stubs the store, or
exercises pure functions. None mounted a real editor with a real peer
stream, which is exactly the axis that broke. The fix is now pinned by a
regression test that mounts the **production** text-box mount and asserts
focus survives a cursor-only `setPeers`.

Rule: when a feature's failure mode is cross-component and DOM-level,
either run the manual smoke or write one test that mounts the real thing.
"Unit tests green" is not a substitute, and a skipped smoke should be
recorded as an open risk rather than a formality.

## Fixing a hot path can introduce a colder bug

The Critical fix's companion change — an audience gate skipping the
presence write when no peers are watching — removed a real 60 Hz
solo-user re-render, and introduced a regression: the gate skipped the
write *and* left the publisher's bookkeeping untouched, so a stationary
cursor stayed invisible to a peer who joined later, and a swallowed
`pointerleave` stranded a ghost cursor at the last published position.

Rule: a gate that suppresses writes needs a replay path for when it
re-opens, and must not record a suppressed write as delivered.

## Repo-specific gotchas

- **`pnpm verify:fast` fails with a phantom `stepSelectionFontSize` /
  `TextBoxEditorAPI` typecheck error** when the docs `dist` is stale.
  `pnpm --filter @wafflebase/docs build` fixes it. CI builds first, so it
  is green there and only bites locally.
- **`.githooks/pre-commit` re-runs the full suite**, so `git commit` takes
  4–5 minutes. A 2-minute tool timeout reads as a hang; it is not.
- **`@wafflebase/frontend` has no `typecheck` script** — `verify:fast`
  gates it with lint + test. Use `tsc -b --noEmit` directly (it reports
  ~141 pre-existing errors elsewhere in the package; check the touched
  files, not the total).
- **Backticks in `git commit -m` bodies get shell-expanded.** Commit from
  a file, or avoid backticked identifiers in the body.
- **`docs/` layout is hook-enforced**: only `docs/design/` and
  `docs/tasks/` are accepted. The superpowers default plan location
  (`docs/superpowers/plans/`) is rejected.

## Process note

Six of the seven tasks went through implement → review → (fix → scoped
re-review). Reviewers that *reproduced* claims rather than reading them
found every real defect: the Align phantom-rect trap, the identity-only
zoom tests, the dead `Fit`, the focus-blur Critical, and the audience-gate
regression were all caught by mutation- or revert-testing, never by
inspection alone.
