# Lessons — Fix note code-block copy-button drift and code styling

## What broke

The copy button lived inside the `<pre>`, the very element that scrolls
horizontally. `position` on the scrolling element doesn't hold a child fixed
against its viewport, so a long line pushed the button out of view. Separately,
a single `.hljs` rule was doing double duty — carrying both the syntax palette
and a `background: transparent` — which starved inline code and fenced blocks
of a proper surface.

## Lessons

- **Anchor overlays to a non-scrolling ancestor.** A "pinned" control must be a
  child of a static positioning context, not of the element that scrolls. The
  fix is structural (wrapper div owns position, `<pre>` owns overflow), so no
  amount of long lines can move the button.

- **Don't overload one selector across two render targets.** `.hljs` is applied
  to both inline highlight spans and the fenced `<code>`; forcing a background
  there fought both. Splitting responsibilities — palette on `.hljs`, pill on
  `:not(pre) > code`, block surface on `pre.note-code` — let each target get
  the right treatment.

- **Watch for framework-injected pseudo-content.** `@tailwindcss/typography`'s
  `prose` adds decorative backticks via `code::before/::after`. Because
  markdown-it already turned the real backticks into a `<code>` tag, those
  pseudo-elements were duplicate visible cruft; `content: none` is the targeted
  cancel.

- **A DOM-structure change deserves a DOM-structure test.** The regression is
  invisible to a snapshot of rendered text, so the test asserts parentage
  (button in wrapper, `<pre>` a sibling, button not contained by `<pre>`)
  rather than styling — that is what actually pins the behavior.
