# Freeze Pane Gap — Lessons

## Pattern: Adding a layout parameter across rendering pipeline

When adding a new spatial parameter (like `gapX`/`gapY`) to a rendering
pipeline, the changes are highly mechanical but spread across many files:

1. **Data model first** — Add fields to the state type (`FreezeState`),
   update defaults and builders.
2. **Layout functions** — Update coordinate ↔ reference conversion functions
   that use the boundary.
3. **Rendering** — Update clip rects, scroll offsets, and draw positions.
4. **Input handling** — Update mouse → cell reference conversions and
   hit-test boundaries.

The key insight: every place that uses `frozenWidth` as a screen-space
boundary for the unfrozen region must add the gap. Places that use
`frozenWidth` as a data-model concept (e.g., "how many pixels do frozen
columns span") should NOT include the gap.

## Rule
- `frozenWidth + gapX` = screen boundary between frozen and unfrozen
- `frozenWidth` alone = data width of frozen columns (unchanged)
- Same pattern for `frozenHeight + gapY`
