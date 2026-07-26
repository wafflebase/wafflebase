# Lessons — Notes empty nested bullet setext bug (#517)

## Context

Bug fix in the `@wafflebase/notes` markdown preview pipeline.

## Findings

- The bug is a genuine CommonMark ambiguity, not a Wafflebase-specific defect:
  strict CommonMark (and GitHub's cmark-gfm) also render `- 1\n  -` as an `<h2>`.
  A lone `-` after a paragraph is a setext-heading underline by spec. The fix is
  a deliberate, notes-scoped deviation toward the more intuitive "empty bullet".
- Two markdown-it guards conspire here: `lheading` claims the underline before
  `list` runs, AND `list` forbids an *empty* bullet from interrupting a
  paragraph. Relaxing only one is not enough — disabling `lheading` alone yields
  literal `1<br>-` lazy-continuation text.
- `Ruler.at(name, fn, options)` REPLACES the rule's `alt` chain with
  `options.alt || []`. When replacing `list`, its original
  `alt: ['paragraph','reference','blockquote']` must be passed back or it stops
  acting as a paragraph terminator.

## Follow-ups

- (fill in during/after review)
