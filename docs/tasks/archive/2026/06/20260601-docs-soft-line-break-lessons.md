# Lessons — Soft line break in docs

## Cursor / selection don't need any code change

The model-level `\n` is just a 1-character offset like any other.
Cursor up/down works because keyboard nav already operates on
`LayoutLine[]` (each `\n` creates a new visual line). Selection
rendering already paints per-line rectangles. Find/replace already
operates on inline text strings. The model didn't need a new node
type — only the layout step needed to recognise the existing
character.

## Trailing `\n` is a real visual line

A block ending on `\n` (e.g. "abc\n") should render TWO lines —
"abc" and an empty line for the cursor. Without an explicit
`lastWasSoftBreak` tracker the final-flush branch (which only fires
when `currentRuns.length > 0`) would drop the trailing empty line
silently. PowerPoint's Shift+Enter-at-end-of-paragraph parity
requires this.

## splitWords ordering matters

The pre-fix `splitWords` only broke on space, attaching the trailing
space to the preceding word. After adding `\n`, the splitter needs
to check `\n` BEFORE accumulating into `current` — otherwise the
`\n` would be glued onto a preceding non-space character ("abc\n"
→ ["abc\n"] instead of ["abc", "\n"]). Also: the space-keeps-with-
word rule must skip when the next char is `\n` so the standalone
`\n` segment stays distinct.

## Paint paths > 1 — both need the skip

`fillText('\n', ...)` paints a fallback tofu box on fonts without a
glyph for U+000A. Two paint sites needed updating:
- `paint-layout.ts:renderRun` for body text.
- `table-renderer.ts` inner loop for in-table runs.

Background fills via `fillRect(x, y, run.width, h)` are naturally
no-ops because `run.width === 0` for `\n` runs — no extra guard
needed there.

## What was non-obvious

`measureSegments` short-circuits the measurer for `\n` (skips
`cachedMeasureText` entirely) so the stub measurer in tests, which
returns `text.length × charWidth`, doesn't accidentally measure
`\n` as 8 px. Width = 0 is enforced at the segment construction
site, not at layout.

## Out of scope follow-ups

- Editor Shift+Enter binding to insert `\n` (currently no producer
  inside the editor; only the PPTX importer creates `\n` inlines).
- DOCX export `<w:br/>` round-trip.
- PDF export `\n` handling.
- Find/replace pattern matching across `\n` (current behavior
  matches `\n` as a literal character; that's probably fine).
