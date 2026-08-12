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
