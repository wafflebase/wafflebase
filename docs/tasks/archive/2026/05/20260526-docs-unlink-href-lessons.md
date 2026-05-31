# Lessons: Docs unlink doesn't remove hyperlink

## Yorkie Tree `styleByPath` only merges — it never deletes

`tree.styleByPath(path, attrs)` merges `attrs` into the node's existing
attributes. There is no way to delete an attribute by passing it as
`undefined` (Yorkie attribute payloads are flat string maps, and the
serializer drops undefined values anyway). To remove an attribute you
**must** call `tree.removeStyleByPath(fromPath, toPath, keys[])`.

This is documented inline in two existing call sites
(`setBlockType`, `updateTableCellSpan`) but the inline `applyStyle`
path missed it — so "clear a style" (e.g. unlink → `{ href: undefined }`)
silently no-op'd in the CRDT.

## The optimistic cache masked the bug locally

`applyStyle` updates an in-memory cache via `applyInlineStyleHelper`
(a plain object spread that *does* keep `href: undefined`), then writes
the CRDT. So the link looked removed locally until the next tree
re-read (remote change → `dirty = true`, or reload), and never changed
for other collaborators. When debugging CRDT writes, **assert against a
fresh re-read from the tree, not the optimistic cache** — in the test,
construct a second `YorkieDocStore` over the same `yorkie.Document`
(fresh stores start `dirty = true`, forcing a tree parse).

## Fix shape

`removedInlineStyleAttrs(style)` returns the Yorkie attribute name(s)
for any `InlineStyle` key explicitly set to `undefined`, mapped through
the same serialization scheme as `serializeInlineStyle` (e.g.
`image` → `image.src/width/height/alt`). `applyStyle` calls
`removeStyleByPath` per styled inline alongside the existing
`styleByPath` merge. General fix — covers any future cleared key, not
just `href`.
