# Notes source/preview contrast

User report: in split view the source editor and the preview are hard to
tell apart, and the source pane's syntax highlighting is too faint to read
(it is nearly monochrome after the #1160 token theme).

- [x] Source pane sits on its own tinted work surface (pane + gutter), the
      preview stays on paper, in light and dark
- [x] Markdown markup gets distinct hues from the preview's GitHub code
      palette: headings, list/task marks, quotes, inline code, HTML; syrup
      stays the caret only (One Accent Rule)
- [x] Fenced code renders as one full-width band, not per-span washes
- [x] Verify in the browser (light + dark, split + edit-only)
- [x] Tests + `pnpm verify:fast`
- [x] Design doc (`docs/design/notes/notes.md`) + DESIGN.md note

## Review

Source pane on `NOTE_SOURCE_SURFACE`, preview on paper; markup coloured
from the preview's GitHub palette (light red/green deepened to clear 4.5:1
on the tint — measured 4.31 / 4.36 before, 5.15 / 4.78 after); code blocks
painted by `code-block-band.ts`. Checked in a browser at light and dark in
both split and edit-only modes, using a temporary page that mounts the engine
on a `MemNoteStore`. The new test fails with `noteMarkdownTags` removed.
`pnpm verify:fast` green.
