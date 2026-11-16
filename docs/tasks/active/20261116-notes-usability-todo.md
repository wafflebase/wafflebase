# Notes usability pass

Opened a note in `pnpm dev` with a representative markdown sample (headings,
nested lists, tasks, quote, code, table, long paragraph) in Split and Preview
modes, light and dark. Findings, in order of how often they cost a writer:

1. **No formatting shortcuts.** Bold / italic / link / lists exist only as
   toolbar clicks. `Mod-i` even runs CodeMirror's "select parent syntax".
   Product principle 2 says behave like Google's suite.
2. **No heading control.** The most common markdown structure has no toolbar
   entry and no shortcut.
3. **Preview reads at full pane width.** In Preview mode a paragraph runs
   ~150+ characters per line on a laptop, more on a monitor.
4. **Preview links are not links.** They render as underlined body text, not
   the `link` token (DESIGN.md → Links).
5. **Task items show a bullet and a checkbox.**
6. **Empty note is two blank panes** with no hint of what to do.
7. **View mode hides behind an icon-only dropdown**; Editor / Split / Preview
   is the note's most-used layout control.
8. **Editor pane is another product's palette.** The Xcode theme paints a
   blue-slate pane and red markup next to zinc chrome, a second accent in
   editor chrome (DESIGN.md → One Accent Rule).

## Plan

- [x] Branch `notes-usability-pass`
- [x] `packages/notes`: `setHeading(level)` command (0 = paragraph), keeps
      list/quote prefixes intact; `heading` in `NoteInlineFormats`
- [x] `packages/notes`: formatting keymap at `Prec.high` — Mod-B, Mod-I,
      Mod-Shift-X, Mod-K, Mod-Shift-7/8/9, Mod-Alt-0…6 (vim mode binds them
      on a Mac only — Ctrl-B/I/K are vim's own keys; read-only mounts get none)
- [x] `packages/notes`: placeholder for an empty note
- [x] `packages/notes`: Wafflebase CodeMirror theme (zinc surface, syrup
      caret/selection, muted markup, heading weight) replacing Xcode
- [x] Frontend toolbar: heading dropdown, shortcut in every tooltip,
      Editor / Split / Preview as a visible segmented toggle group
- [x] Preview CSS: reading measure in preview-only mode, link token,
      no bullet on task items
- [x] Unit tests for `setHeading`, keymap, formats
- [x] Source parser switched to GFM (found in the browser: `[x]` painted
      as a link reference under CommonMark)
- [x] Browser check light/dark, split/preview, empty note, 390px phone
- [x] `pnpm verify:fast`
- [x] Self review (3 rounds, bound reached)
- [ ] PR

## Review

All eight findings addressed. Verified in a browser on this branch (frontend
5176 / backend 3001; 5173 serves a sibling checkout): split, preview-only
reading column, light and dark, empty note, 390px phone, Mod-Alt-2 / undo,
the heading menu, a mixed task/plain list, a `#` line inside a fence.

Self-review: round 1 test-adequacy (setHeading in the read-only guard),
round 2 design fit (mixed-list bullets, headings inside code) and
test-adequacy (leaving Preview on a phone), round 3 correctness (lazy parse
vs. the code check). All fixed; the round 3 fix had no further panel round.

Known limitations (deferred):
- The shortcut table lives in the engine keymap and again in the toolbar;
  a shared catalog like docs' `shortcuts-catalog.ts` would keep them in step.
- Editor / Split / Preview are a group of pressed toggles, not a radiogroup.
- Setext headings (`Title` over `===`) read as Normal text in the picker.
- The toolbar's `isMac` and CodeMirror's own Mac detection can disagree on
  an unusual user agent (vim-mode tooltips only).
- `pnpm install` also moved `lightningcss`'s `detect-libc` 2.0.3 → 2.1.2 in
  the lockfile.
