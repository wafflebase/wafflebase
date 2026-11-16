# Notes source/preview contrast — lessons

- **"Recede the markup" can overshoot into "no markup".** The #1160 theme
  muted every mark and put both panes on paper; in split view it read as
  the same page twice. Distinguish the panes by surface and give the syntax
  hues, and keep only inline punctuation muted.
- **lezer's markdown tags `#`, `-`, `>`, `**` all as `processingInstruction`.**
  Colouring block marks apart needs `styleTags` sub-tags passed through
  `markdown({ extensions })`; equal-depth rules added later win.
- **Class-string tests prove nothing for highlight tags.** Inherited classes
  make every span's class unique anyway, so a "classes differ" test passed
  with the change reverted. Compare computed colours (jsdom resolves the
  style-mod sheets), and confirm the test fails without the change.
- **Look without a login:** a throwaway `packages/frontend/*.html` page that
  imports `/src/index.css`, `notes-preview.css` and `@wafflebase/notes` and
  mounts `initialize()` on a `MemNoteStore` is served by Vite directly,
  with no backend or auth involved. Delete it before committing.
- A fresh checkout may lack `node_modules` links (`@codemirror/language`
  unresolved in Vite): run a root `pnpm install` first.
- **`@codemirror/legacy-modes` 6.5 does not typecheck against
  `@codemirror/language` 6.12** — it types parsers from the new
  `@codemirror/streamparser` package (private `tabSize` mismatch). Pin
  6.4.x until `language` moves up.
- **`lang-markdown` already pulls in `lang-html` (with JS and CSS).** Those
  grammars were in the notes engine before this change; only the extra
  languages are new weight.
- **A dev page open while Vite re-optimizes new deps crashes in
  `hasChild`**: two `@lezer/common` copies. It is a stale page, not a bug;
  reload. A production build has one copy.
