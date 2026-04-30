# Cell Paragraph Layout Unification — Lessons

## What broke

Increase Indent silently no-op'd on paragraphs inside table cells.
`applyBlockStyle({ marginLeft })` updated the data model, but the cell
layout function (`layoutCellInlines`) ignored `block.style.marginLeft`
entirely. Bullet indent worked because list-item indent went through a
different path (`listLevel` increment) that the cell layout did handle.

## Why it stayed hidden

Two parallel layout implementations: `layoutBlock` for body paragraphs,
`layoutCellInlines` for cells. The cell version was a stripped-down
copy that re-implemented word-wrap, line-height, image scaling, and
character-level fallback — but skipped `marginLeft`, `textIndent`,
`lineHeight`, and heading/title/subtitle defaults. Every block style
added to the body side after the fork would silently skip cells.

## Lesson

When two paths "look like the same logic with one stripped down," they
will drift. Prefer one shared function with parameters over a copy with
subset behavior. The cost is paid every time a new block style is added
— without the shared path, every author must remember to update both,
and silence is the default failure mode.

## How to apply

Before adding a new `block.style.X` (or any new layout-time block
property), check if there is more than one place that reads
`block.style`. If so, consolidate first.
