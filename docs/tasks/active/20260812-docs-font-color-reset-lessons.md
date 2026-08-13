# Lessons — Docs font color reset (#728)

## `ctx.fillStyle = ''` fails silently

Assigning an invalid CSS color to `fillStyle` / `strokeStyle` is not an error
and does not reset to black — the canvas keeps the previous value. A cleared
style that leaks an empty string therefore does not render "uncolored", it
renders in whatever color the previous paint pass happened to set. In
`paintLayout` that is the selection fill, which made the bug look like the
text had adopted the selection color.

Takeaway: for canvas color values, `??` is not a safe fallback operator —
`||` is, because every legal color in this codebase is truthy (hex strings
start with `#`, `StoredColor` role/srgb forms are objects).

## "Clear a style" means removing the key, not writing an empty value

`YorkieDocStore` already distinguishes the two: `serializeInlineStyle` drops
`undefined` keys and `removedInlineStyleAttrs` turns an explicitly-`undefined`
key into a `removeStyleByPath` call. An empty string bypasses that machinery
entirely and is stored as a real attribute. Toolbar "Reset" controls should
pass `undefined`, never `""`.

The corollary found in review: the cell path had only *half* that machinery.
`serializeCellStyle` dropped falsy keys but `applyCellStyle` had no removal
list, so the table "No fill" reset could never clear a fill at all. When a
store grows a second style surface, the clear path has to be duplicated with
it — `removedCellStyleAttrs` now mirrors `removedInlineStyleAttrs`.

## Normalizing at a sink covers every writer; validating at one API does not

Colors reach the OOXML exporters from import, HTML paste and the content PUT
API, so the fix belongs at the sink (`toRgbHexColor` → attribute dropped when
unexpressible). Review found the sibling attribute in the same function,
`<w:jc w:val>`, still interpolating `style.alignment` raw. The rule that falls
out: an OOXML attribute takes a *value-typed* string only through a converter
that can fail closed (a closed lookup or a normalizer returning `undefined`);
escaping is for free-text attributes like `w:ascii` where any value is legal.
