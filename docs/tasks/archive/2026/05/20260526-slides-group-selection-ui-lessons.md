# Slides Group Selection UI — Lessons

Companion to `20260526-slides-group-selection-ui-todo.md`. Captures what
was non-obvious while making the selection overlay distinguish a selected
group (member outlines) from a drilled-in child (context box).

## What went well

- **Pure helper + thin wiring split.** Putting all world-frame math in a
  pure `groupOverlayFrames(slide, selectedIds, scope)` (in `frame-space.ts`)
  made the feature trivially unit-testable with plain objects, and kept
  `overlay.ts` (DOM) and `editor.ts` (`repaintOverlay`) as thin, obvious
  consumers. The three layers were reviewed and tested independently.
- **Reused existing test infrastructure.** `makeGroupedFixture()` and the
  `dblclick` drill-in dispatch already existed in `editor.test.ts`; the
  drill-in context-box test reused them instead of hand-rolling drill-in.

## Coordinate spaces (the easy thing to get wrong)

- `worldTightFrame(group).worldFrame` is in the group's **parent** space
  (same space as `group.frame`), NOT the group's local/child space.
- `applyGroupTransform(child.frame, group)` maps a child's **group-local**
  frame into the group's **parent** space.
- `toWorldFrame(frame, scope, slide)` lifts a frame from the innermost
  `scope` group's space to world.
- So: member outline = `toWorldFrame(applyGroupTransform(child, g), scope, slide)`;
  context box = `toWorldFrame(worldTightFrame(g).worldFrame, scope.slice(0,-1), slide)`.
  The `scope.slice(0,-1)` for the context box is the subtle bit — the
  innermost scoped group lives in its *parent's* space.

## Gotchas

- **`groupOverlayFrames` uses `selectedIds` only for member outlines** (it
  needs exactly one selected element that is a group). A text-edit element
  is never a group, so filtering the editing element out of the ids never
  changes the result — pass the raw selection and don't over-explain it in
  comments (an early review comment overstated a text-edit nuance that
  doesn't actually occur).
- **Accent color arithmetic.** `#3a7` expands to `#33aa77` = `rgb(51,170,119)`,
  not `rgb(58,...)`. The spec carried a wrong R value (58) that got copied
  into the code; the final review caught it. When a constant claims to
  equal a hex accent, verify the expansion.
- **Commit-msg hook: 80-char body lines.** The repo rejects any commit
  body line > 80 chars. Wrap every `-m` body line; a single long line
  fails the commit (hit this once).
- **Pre-existing flaky test.** `packages/frontend/.../text-edit-section.test.ts`
  occasionally times out at the 5s limit during the pre-commit hook; it is
  unrelated to this change and passes on retry.

## Process notes (subagent-driven execution)

- Ran the plan via subagent-driven development: one implementer + spec
  reviewer + code-quality reviewer per task, then a final whole-feature
  review. Each reviewer caught real (if minor) polish: a nested-scope test
  gap, a `!== 0` rotation-guard consistency nit, an `allSelectedIds`
  clarity extraction, and the color bug.
- `SendMessage` to resume a prior subagent's context was not available in
  this harness, so small (<~15 line) review fixes were applied directly by
  the controller rather than spinning up cold agents — cheaper and faster
  for trivial edits, and the changes were re-tested before commit.

## Verification

- `pnpm verify:fast` green (794 tests across packages).
- `pnpm slides test test/view/editor/` green (516 tests) incl. the new
  member-outline (group select) and context-box (drill-in) editor tests.
- The jsdom editor tests drive the real production path
  (`initialize → setSelection`/`dblclick → repaintOverlay → renderOverlay`
  → DOM), standing in for most of a manual smoke.

## Remaining manual steps (not automated here)

- Quick visual confirmation in `pnpm dev`: select a group → faint dashed
  member outlines; double-click a member → faint dashed context box around
  the group; `Esc` pops out; a lone shape is unchanged; Korean IME still
  composes in a grouped text box.
- Optional: `pnpm verify:browser:docker` to add/refresh group-selected and
  drilled-in visual baselines.
