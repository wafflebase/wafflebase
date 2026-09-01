# Lessons — notes list commands inside blockquotes (#754)

## What made the fix small

Everything the list commands do already keys on `indent`, which is a *column
count inside the line*. Once the quote prefix is peeled off before `LIST_RE`
runs and glued back on in `prefixOf`, `indent` becomes "columns inside the
blockquote" and the indent/outdent maths, the per-level ordered numbering and
the `contentColumn` nesting step all keep working without knowing quotes
exist. The quote floor asked for in the review is not a new clamp — it falls
out of measuring the indent after the prefix.

The one place that genuinely needed new logic is neighbour lookup:
`itemAbove` / `parentOf` walk upwards looking for a list line, and a line at a
different quote depth is a different container, so it has to terminate the
walk rather than be treated as a parent.

## `label: true` vs `aria-label`

The review asked for `markdown-it-task-lists`' `label: true` back for the
accessible name. Restoring it literally would regress the click-anywhere
toggle #925 added: a `<label>` wrapping the item text forwards its click to
the checkbox inside it, so the delegated `onTaskClick` handler sees two clicks
for one tick. Naming the checkbox from its own item text gives the same
accessible name with no second click, and works on read-only mounts (where
there is no handler at all) identically.
