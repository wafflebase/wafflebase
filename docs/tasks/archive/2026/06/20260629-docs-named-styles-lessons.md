# Docs Named Styles — Lessons

Capture patterns and corrections discovered while implementing named styles.

## Lessons

### Toolbar must show the *computed* style, not the raw run style
Named-style inline defaults (font/size/color/bold/italic) are resolved **lazily
at layout** via `resolveBlockInlines`; they are never stored on the inline run.
So any UI that reads the raw run style (`getSelectionStyle` /
`getRangeStyleSummary` → font-family/size pickers) shows the *document* default,
not the style's effective value — a Heading 1 with no explicit run style read as
Arial 11 instead of 20pt. This was latent for the old hardcoded heading defaults
too; named styles made it visible.
**Fix:** layer `resolveStyleInline(blockStyleId(block), doc.styles)` underneath
the run style at the read-out boundary only. Keep the *apply/pending* path raw
(`getSelectionStyleImpl(false)`) — baking a resolved default into a stored run
would freeze it against later style redefinition (breaks the lazy cascade).

### Eager block spacing must be re-materialized on every registry replace
Block spacing is materialized into `block.style`, not resolved lazily. Any op
that swaps the registry (`setDocStyles` for "Use my default styles", plus
update/reset) must call `rematerializeDocSpacing` or existing blocks keep stale
spacing. Inline defaults reflow on their own; spacing does not.

### "Update to match" reads the caret run, not `inlines[0]`
Capture formatting at `cursor.position.offset` (reuse `getSelectionStyleImpl`)
and copy only character props, so a caret over a later/structural run doesn't
capture the wrong or non-character (image/link) style.
