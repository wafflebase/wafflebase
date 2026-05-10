# Slides Snap Guides + Align / Distribute — Lessons

**Created**: 2026-05-11

Lessons captured while shipping the slides snap-guide overlay and the
align / distribute toolbar group (paired with
`20260511-slides-guides-align-todo.md`).

## Design / refactoring

- **Tag, don't index.** Phase 1 originally classified snap guides
  via `winnerIndex === 0` because the candidate list happened to put
  the slide-center option first. Code review flagged the implicit
  invariant; the refactor attached an explicit `kind` to each
  candidate and made `bestSnapAdjust` return the winning candidate
  rather than its index. Eliminated the magic index, deduped X/Y
  guide construction, and future-proofed against new candidate
  kinds (e.g. element midlines, page margins). **When a numeric
  index encodes meaning, hoist that meaning into a tagged union.**

- **`render()` only repaints canvas, not overlay.** Phase 3: the
  drag-commit `onUp` path needed an explicit `this.repaintOverlay()`
  call after `markDirty()` / `render()` to clear lingering guide
  DOM nodes. Discovered by tracing the post-commit code path
  (canvas was repainting fine, magenta lines stayed). Worth
  remembering whenever the overlay holds transient state — if a
  future feature (rotate hints, snap dots, ruler measurements)
  introduces overlay state, the same dual call may be needed.

## Testing

- **Tighten test assertions to surface latent bugs.** Phase 1
  refactor flipped `toContainEqual` → full-array `toEqual` on snap
  guide tests. The tighter form immediately revealed that two test
  fixtures shared `y=0` with the dragged bbox, silently producing a
  phantom y-axis edge guide with `position: 0`. Fix was to move
  fixtures off-axis. **Prefer total-equality on small collections
  whenever possible — `toContain*` hides extra elements.**

- **Empty-update batch suppression matters.** Phase 4/5:
  `alignFrames` / `distributeFrames` skip no-op frames in their
  result Map; `applyFrameUpdates` early-returns on empty Map.
  Without both layers, calling `align('left')` on already-left-aligned
  frames would emit empty undo entries — silent UX degradation
  ("undo did nothing? oh wait, it ate one"). Both early-return
  layers are load-bearing; tests at both levels.

## Spec / behavior

- **Push back on spec assumptions.** Phase 5 fixup: the prompt
  asked for a test asserting `frame.x === 100` for two rotated
  boxes, and JSDoc saying "rotated elements aligned by unrotated
  bounds". Implementer read `combinedBoundingBox` (rotation-aware
  AABB over rotated corners), discovered the reference IS
  rotation-aware, and wrote a truthful test
  (`a.frame.x === b.frame.x` + `rotation preserved`) plus
  reworded JSDoc. **Side-effect:** surfaced a real semantic
  divergence from Google Slides — the *visible* left edges of
  rotated elements don't coincide because the value is written to
  unrotated `frame.x`, not to the rotated AABB origin. Captured as
  a follow-up in `slides.md` "Known limitations". The lesson:
  read the source before mirroring the prompt's claims.

- **Distribute float drift is a real (mild) bug.** Code review
  noted: `distributeFrames` uses exact equality (`!==`) for no-op
  detection. Repeated distribute calls on already-distributed
  frames may produce sub-pixel float drift
  (`225.0000000000001 !== 225`) and emit phantom undo entries.
  Acceptable for v1 since slide coordinates are integer-typed in
  the toolbar, but worth an EPSILON tolerance if undo-stack bloat
  is reported. Documented as a known limitation rather than fixed
  speculatively.

## Workflow

- **Subagent-driven flow worked well at this size.** 7 phases × 3
  subagent dispatches each (implementer + spec reviewer +
  code-quality reviewer) was tight enough that controller context
  never bloated, and the two-stage review caught real issues at
  every phase: spec mismatches in P1 (winnerIndex invariant),
  naming in P2 (guide property names), missing edge cases in P5
  (rotated multi-select). **Don't skip the second review even when
  the first passes** — they catch different things, mirroring the
  shapes-p1 lesson about `code-reviewer` finding what
  `spec-reviewer` missed.
