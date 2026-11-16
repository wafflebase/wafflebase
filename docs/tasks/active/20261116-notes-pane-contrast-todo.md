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

## Follow-up: language highlighting in fences

- [x] Curated `codeLanguages` (16 languages) in one lazy chunk
- [x] Code token palette matching the preview's highlight.js roles,
      ≥4.5:1 on the code band in both modes (light keyword/function
      deepened: 4.42 / 4.16 → 5.55 / 5.37)
- [x] Test: a `ts` fence colours `export` / a string; untagged fence stays
      body colour; fails with `codeLanguages` removed
- [x] Chunk gate: 241 / 244 chunks, packs chunk 105 kB

## Follow-up: split-view scroll judder

- [x] Measured: per-frame editor scroll, 39/80 frames pulled back 8px,
      preview stepping every other frame
- [x] Root cause: rAF-released lock lifts before the destination's echo
      `scroll` (next frame) arrives
- [x] Fix: value-based echo detection; failing test first
      (`scroll-sync.test.ts`), then 0/80 overwritten, 0 stalled, both
      directions

## Review

Source pane on `NOTE_SOURCE_SURFACE`, preview on paper; markup coloured
from the preview's GitHub palette (light red/green deepened to clear 4.5:1
on the tint — measured 4.31 / 4.36 before, 5.15 / 4.78 after); code blocks
painted by `code-block-band.ts`. Checked in a browser at light and dark in
both split and edit-only modes, using a temporary page that mounts the engine
on a `MemNoteStore`. The new test fails with `noteMarkdownTags` removed.
`pnpm verify:fast` green.
