# Lessons — thread lineAffinity through getVisualLine* (issue #67)

## What the issue got right, and where it was optimistic

The issue's own "why it is currently safe" argument — `getVisualLineEnd()`
trims trailing spaces, so `End` never lands on a wrap boundary — only
covers text that wraps at spaces. `layoutBlock()` has a character-level
fallback for a segment wider than the line (`layout.ts`, "Character-level
fallback for segments wider than effectiveWidth"), and those boundaries
have no trailing space. So the ambiguous case was reachable in two
keystrokes (`End`, then `Home`) on a long unbroken token, not merely
theoretical. That made the fix testable end-to-end rather than only at the
helper level.

## Affinity conventions in this package are not uniform

`findPageForPosition()` (pagination.ts) and `findPositionAtPixel()` both
default `lineAffinity` to `'backward'`, meaning "boundary belongs to the
earlier line". `findVisualLine()` predates the affinity field and hard-codes
the opposite. Its new parameter therefore defaults to `'forward'` — the
value that preserves its existing behaviour for `moveVertical()` and for the
existing unit tests — rather than to the package-wide `'backward'`. When
adding an affinity parameter to an older helper, default it to whatever
keeps current callers unchanged and say so in the doc comment; picking the
"nicer" default silently changes unrelated call sites.

## The table-cell branch is a second implementation

`getVisualLineRange()` does not delegate to `findVisualLine()` for blocks
inside a table cell — it walks `layoutCell.lines` with its own copy of the
same boundary condition. Any change to visual-line resolution has to be
applied twice; grep for `blockBoundaries` when touching this area.
