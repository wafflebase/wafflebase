# Lessons — Sheets cell hyperlinks (issue #537)

## Context

- PR #532 already unified Docs/Slides text-box + table hyperlink handling
  (typing space/enter → auto-link). The gap left by #537 was Sheets.
- Docs opens links via Ctrl/Cmd+Click in `text-editor.ts`
  (`window.open(href, '_blank', 'noopener,noreferrer')`); Sheets now mirrors
  this rather than inventing a new interaction.

## Notes

- Sheets has no per-cell inline-run model — a cell value is a single string,
  so hyperlink detection is whole-cell (render-time), not run-level like Docs.
- Formula cells are excluded from auto-link: `cell.f` present ⇒ `cell.v` is a
  computed result (e.g. a HYPERLINK() label), not a raw URL.

(Fill in after review.)
