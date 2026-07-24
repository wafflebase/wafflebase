# Board Canvas Skeleton (SP1) — Lessons

Companion to `20260723-board-canvas-skeleton-todo.md`. Design: `docs/design/board/board.md`.

## Context

Built `@wafflebase/board` (new `"board"` document type) as an infinite pan/zoom
canvas that reuses the `@wafflebase/slides` scene engine via an injected
`Viewport {panX,panY,zoom}` transform instead of forking the editor. Landed
across 13 tasks + a final-review fix wave, all via subagent-driven development.

## Lessons

### The reuse premise had a sharp edge the per-task reviews missed
"A board is one unbounded slide; the editor never calls slide-scoped store
methods on it" held for *most* paths — but the reused editor auto-attaches a
`contextmenu` listener whose empty-canvas menu has **"Change layout…"**
(`store.applyLayout` → `notSupported` throw), and the **keymap** calls
`duplicateSlide`/`addSlide` directly (Cmd+D no-selection, Cmd+Shift+D, Cmd+M).
Both crash a board on a common gesture. Per-task reviews (scoped to each diff)
could not see this — only the whole-branch review, which traced *reachability
from a bare editor mount*, caught it.
- **Rule for "reuse an engine via a stub-store adapter":** enumerate every path
  the reused engine can invoke on its own (context menus, keymaps, auto-attached
  listeners) — not just the ones the new UI wires. A `notSupported()` throw is
  only safe if truly unreachable; prove unreachability per gesture, don't assume.
- **Fix pattern:** an editor option (`suppressSlideChrome`) that omits the
  slide-scoped menu items + gates the slide-scoped keymap shortcuts — *not*
  converting the store throws to silent no-ops (the throw is the bug-surfacing
  safety net; the UI just shouldn't offer the action).

### The scene engine was already viewport-agnostic — the seam was tiny
Slides' element model / `drawElement` / hit-test / snap / group math already
worked in a 1920px world space. The ENTIRE screen↔world coupling was three
fit-scale chokepoints (`drawSlide`, `editor.scale()/clientToLogical()`,
`overlay`). Making them viewport-aware (default = fit-scale, so slides is
byte-identical) unlocked the whole reuse. The upfront exploration that found
this (two Explore agents mapping the engine surface) was worth far more than it
cost — it turned "build an infinite canvas" into "inject one transform."

### Workspace module resolution has two faces — wire both
`@wafflebase/board` importing from `@wafflebase/slides`:
- **vitest** resolves via `vite.config.ts` `resolve.alias` → `../slides/src` (SOURCE);
  new barrel exports are visible immediately.
- **tsc** resolves via `package.json` `exports` → `dist/*.d.ts` (BUILT); after
  adding a NEW slides barrel export you MUST `pnpm --filter @wafflebase/slides build`
  or board typecheck won't see it.
- **frontend** also needs its own `vite.config.ts` alias for each new workspace
  package (`@wafflebase/board` → `../board/src`), plus a real `package.json`
  dependency (tsc/IDE resolution needs it in node_modules).
An implementer that hit this reimplemented `screenToWorld` locally as a
workaround — the wrong fix. The right fix was the alias + rebuild.

### `readOnly` was already in the reused engine
The shared-viewer authorization gap (a viewer-role board share link was fully
editable) closed for free: `SlidesEditorOptions.readOnly` already skips
`attachInteractions()` wholesale (pointer + keyboard + contextmenu). BoardView
just forwards a `readOnly` prop; SharedBoardLayout passes `role==='viewer'`.
Check what the reused engine already supports before building gating anew.

### Frontend chunk-count gate is a real merge gate
`verify:self` failed on `verify:frontend:chunks` (140 > limit 135) — the board
lazy chunks (board-detail, board-view) tripped it. Legit new feature → bump
`maxChunkCount` in `harness.config.json` with a documented reason appended to
`maxChunkCountReason` (the repo's established pattern). Not a code problem.

### Process notes (subagent-driven)
- One interrupted implementer (session limit mid-Task-3) left partial uncommitted
  edits: discarded them (`git checkout HEAD -- ...` + rm untracked) and
  re-dispatched fresh rather than building on unverified partial state.
- When the agent-dispatch safety classifier was temporarily unavailable, did the
  Task-12 review myself from the diff (read-only ops don't need the classifier).
- Model tiering worked: haiku for transcription+config tasks and small reviews,
  sonnet for integration/investigation, opus for the whole-branch review (which
  is exactly where the extra reasoning found the Critical).

## Verification notes

- The slides regression gate (full suite green with no-viewport path unchanged)
  held across all four slides-touching changes (viewport seam ×3 + suppressSlideChrome/keymap).
  Final counts: slides 2626, frontend 874, backend 345, sheets 1414, docs 1120,
  notes 27, cli 231; `verify:self` all 11 lanes green.
- Board's own tests: viewport ops (3), deck synthesizer (2), wheel→viewport
  helper (5), YorkieBoardStore (4), + slides suppressSlideChrome/keymap (10 new).

## Deferred to SP2 (tracked)

Guides round-trip (store writes `root.guides`; `read()` drops them — dead until
ruler UI); group/ungroup direct tests; peer-cursor dot rendering in the editor
overlay (cursor is published to presence but PeerView has no cursor field);
BoardView `read()` O(n) → spatial index; paste-group-containing-table drops the
whole group (top-level filter granularity); Cmd+C table-filter symmetry;
`readMeta()` fast-path.
