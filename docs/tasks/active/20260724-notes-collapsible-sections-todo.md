# Notes collapsible sections — `<details>`/`<summary>` (issue #542)

PR: (to be filled after opening)

## Goal

Support GitHub/MDN-style collapsible sections in the Notes markdown
preview: wrapping content in `<details>` / `<summary>` renders a
folded-by-default disclosure that expands on clicking the summary label.
`<details open>` renders expanded by default.

## Constraint (load-bearing)

The notes preview is built with `markdown-it` configured `html: false`
on purpose — raw inline HTML in a collaborator's note is a stored-XSS
vector (see the SECURITY note in `packages/notes/src/view/preview.ts`).
We must NOT flip `html: true`. Instead we add a narrow, allowlisted
markdown-it block plugin that recognizes ONLY `<details>`/`<summary>`/
`</summary>`/`</details>` and emits safe `<details>`/`<summary>`
elements (fixed class, only the boolean `open` attribute). All inner
content and the summary label are still rendered through the normal
`html: false` pipeline, so no arbitrary HTML is ever emitted.

## Approach

- New `packages/notes/src/view/details-plugin.ts`: a markdown-it block
  rule registered before `paragraph` as a paragraph terminator
  (`alt: ['paragraph', 'reference', 'blockquote', 'list']`). It matches:
  - `<details>` / `<details open>` → `details_open` token (open attr)
  - `<summary>…</summary>` (single line) → `summary_open` + inline + `summary_close`
  - `</details>` → `details_close` (guarded by a depth counter so a
    stray close with no open falls through and is escaped as text)
  Content between the tags is parsed as normal markdown (nesting,
  fences, lists, even nested `<details>` all work for free).
- Custom renderers emit `<details class="note-details" [open]>` and
  `<summary class="note-summary">`.
- `preview.ts` uses the plugin via `md.use(detailsPlugin)`.
- CSS in `packages/frontend/src/app/notes/notes-preview.css` styles the
  disclosure (summary marker/cursor, light + dark).

## Tasks (TDD)

- [ ] `details-plugin.ts` block rule + renderers
- [ ] `md.use(detailsPlugin)` wired in `preview.ts`
- [ ] Tests in `preview.test.ts`:
  - [ ] collapsed-by-default `<details>` renders `<details>`/`<summary>`
  - [ ] `<details open>` sets the `open` attribute
  - [ ] inner markdown is rendered (e.g. bold, code fence)
  - [ ] summary label markdown is rendered
  - [ ] nested `<details>` works
  - [ ] stray `</details>` / `<script>` is NOT emitted as raw HTML (XSS guard)
- [ ] preview CSS for `.note-details` / `.note-summary` (light + dark)
- [ ] targeted unit test file green (`vitest run preview.test.ts`)

## Out of scope

- Editor-side (CodeMirror) affordance / toolbar button for inserting a
  disclosure — this is a preview-render feature only.
- Multi-line `<summary>` spanning several source lines (single-line
  summary is the GitHub-common form and what the issue example uses).
- Arbitrary raw HTML passthrough (explicitly rejected for security).
