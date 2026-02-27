# Filter Sort — Column-Scoped Sorting: Lessons

## Lesson 1: Prefer grid-level operations over row-level moves for scoped changes

When reordering cells within a sub-region of the sheet, using
`getGrid`/`deleteRange`/`setGrid` with a row mapping is simpler and more
correct than looping `moveCells` calls. `moveCells` moves entire rows
(including metadata like styles, merges, dimensions), which is overkill when
only a column subset needs reordering.

## Lesson 2: Clean up dead options when removing callers

When `skipFilterStateRemap` was introduced solely for `sortFilterByColumn`,
removing the caller means the option itself should be removed from `moveCells`
to avoid dead code.

## Lesson 3: Always update design docs and task files post-task

Design docs should reflect the current implementation. Missing this step
causes future contributors (and AI agents) to work from stale assumptions.
Added a Post-Task Checklist to `CLAUDE.md` to enforce this.
