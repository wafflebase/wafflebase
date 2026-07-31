# Notes — Fix code-block copy-button drift and code styling in preview

## Context

The notes markdown preview renders fenced code blocks with a custom
`md.renderer.rules.fence` (in `packages/notes/src/view/preview.ts`) plus a
"Copy" affordance, styled by `packages/frontend/src/app/notes/notes-preview.css`.

Two problems:

- **Copy button drifts.** The button was a child of the `<pre>`, which is the
  horizontally-scrolling element. A long code line scrolled the button
  sideways out of view instead of keeping it pinned to the block's top-right.
- **Code styling gaps.** `.hljs` (shared by inline highlight targets and the
  fenced `<code>`) forced `background: transparent`, so inline code had no
  visual boundary and fenced blocks leaned on the wrong surface. The
  `@tailwindcss/typography` `prose` styles also inject decorative backtick
  pseudo-elements around `<code>`, which show as literal duplicate backticks
  because markdown-it already consumed the real ones.

## Work

- [x] `preview.ts` — wrap the fenced block in a non-scrolling
  `<div class="note-code-wrapper">`; move the copy `<button>` into the wrapper
  (a sibling of `<pre>`, not a child). The wrapper becomes the positioning
  context; the `<pre>` only owns overflow.
- [x] `notes-preview.css`:
  - Drop the forced `background: transparent` from `.note-preview .hljs` so the
    rule only carries the token color palette.
  - Add inline-code pill styling scoped to `:not(pre) > code` (light + dark),
    and `code::before/::after { content: none }` to cancel prose's backtick
    pseudo-elements.
  - Add fenced-block background + thin scrollbar styling on `pre.note-code`
    (light + dark).
  - Retarget the copy-button positioning/hover rules from `.note-code` to the
    new `.note-code-wrapper`.
- [x] `preview.test.ts` — assert the copy button anchors to the wrapper and
  sits outside the scrolling `<pre>`.

## Notes

- Pure view/styling change; no data-model or CRDT impact.
- Colors follow the existing GitHub-markdown-body palette already used in the
  file (light `#f6f8fa` / dark `#161b22`).
