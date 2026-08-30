# Notes: image width/height via a narrow `<img>` allowlist (issue #973)

## Problem

`![alt](url)` paints at the image's intrinsic size, so a Retina screenshot
fills the preview pane and a 32px icon stays tiny. Markdown has no sizing
syntax, and the HTML escape hatch everyone pastes from GitHub —
`<img src="x.png" alt="x" width="200" />` — is escaped to literal text
because `packages/notes/src/view/preview.ts` runs markdown-it with
`html: false` (raw HTML in a shared note is a stored-XSS vector).

## Approach

Follow the `<details>` / `<summary>` precedent (issue #542,
`view/details-plugin.ts`): keep `html: false`, and allowlist exactly one tag
with exactly one attribute set.

- New `packages/notes/src/view/img-plugin.ts`: an **inline** markdown-it rule
  registered before `html_inline` that recognizes `<img …>` / `<img … />` and
  pushes a normal `image` token.
- Accepted attributes: `src` (required), `alt`, `width`, `height` — nothing
  else. `width`/`height` must match `^\d+%?$`. `src` goes through
  `md.normalizeLink` + `md.validateLink`, the same gate the `![]()` path uses.
- Anything outside that shape (unknown attribute, bad dimension, rejected
  URL, missing `src`) makes the rule decline, so the source falls through to
  the normal `html: false` pipeline and is escaped as literal text — exactly
  what happens today.
- Reusing the `image` token means the existing `renderer.rules.image` hook in
  `preview.ts` (`loading="lazy"`, `decoding="async"`) applies for free, and
  the only attributes ever emitted are the four above.

## Tasks

- [x] `packages/notes/src/view/img-plugin.ts` — the rule + plugin
- [x] Wire `md.use(imgPlugin)` in `preview.ts`
- [x] `packages/notes/src/view/img-plugin.test.ts` — parse/render + rejection
      cases; a render case in `preview.test.ts` proving the pipeline is wired
- [x] `docs/design/notes/notes.md` — new subsection next to the `<details>`
      one, including the Tailwind-preflight note on `height`

## Acceptance criteria (from the issue)

- `<img src="drawing.jpg" alt="drawing" width="200" />` in a note renders an
  `<img>` sized to 200px in the preview.
- `html: false` stays on; no arbitrary HTML is emitted. `<img
  src=x onerror=alert(1)>`, `<img src="javascript:…">`, `<script>` etc. are
  still escaped text.
- Attribute order, single/double/unquoted values, and `>` vs `/>` all parse.
- Percentages (`width="50%"`) work; anything else (`200px`, `calc(...)`,
  `style=`) is refused rather than silently dropped.

## Notes / out of scope

- Tailwind preflight sets `img { max-width: 100%; height: auto }`. `width`
  therefore sizes the image (and `max-width` still keeps an oversized value
  inside the column); a `height` attribute contributes the intrinsic aspect
  ratio next to `width` but does not force a hard height on its own. No CSS
  change is made here — overriding preflight for preview images is a separate
  call, and `width` is what the issue asks for.
- No editor-side resize handle, no `=200x` / `{width=200}` markdown syntax
  (the issue names the HTML form as the highest-value shape).
