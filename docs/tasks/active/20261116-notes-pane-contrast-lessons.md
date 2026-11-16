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
