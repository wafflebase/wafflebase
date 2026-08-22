# Lessons — notes foldout / code / quote toolbar (#756)

- markdown-it's built-in `code` (indented code block) rule runs *before* the
  custom disclosure rule registered with `md.block.ruler.before('paragraph',
  …)`. Any inserted skeleton that indents its inner tags by four spaces would
  therefore be parsed as a code block, not as a foldout — the insert has to be
  flush-left even though the issue's snippet shows it indented.
- `@tailwindcss/typography` emits its rules through `:where(...)`, so they have
  zero specificity. A plain `.note-preview .note-details > *` rule wins over
  them — which is why the child indentation uses `margin-left` rather than
  `padding-left`: `padding-left` would silently cancel a nested list's
  `padding-inline-start` and lose its bullet indentation.
- `prose` does not style `details`/`summary` at all, so "match normal text"
  means restating the prose-sm paragraph margin on the container explicitly.
