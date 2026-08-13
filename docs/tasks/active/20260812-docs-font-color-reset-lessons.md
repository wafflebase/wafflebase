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

## A Yorkie "remove style on this node" is a *subtree* range

`removeStyleByPath(cellPath, cellPath+1, ['backgroundColor'])` reads like it
addresses one node, but the path range spans the node's whole subtree and
Yorkie removes the attribute from every element node in it — the cell's
inline highlights and every nested-table cell included. The existing
block-level calls get away with the same shape only because the keys they
remove (`listKind`, `listLevel`) exist on no descendant; the moment the key
is shared with a child node type the range is wrong. Yorkie has no
single-node removal, so `removeCellNodeStyle` drops to the index API and
removes over `[pathToIndex(cell), +1)` — the cell's opening tag alone.

Takeaway: before reusing a `removeStyleByPath` range, ask whether any
descendant node type carries the same attribute name.

## Normalizing at a sink covers every writer; validating at one API does not

Colors reach the OOXML exporters from import, HTML paste and the content PUT
API, so the fix belongs at the sink (`toRgbHexColor` → attribute dropped when
unexpressible). Review found the sibling attribute in the same function,
`<w:jc w:val>`, still interpolating `style.alignment` raw. The rule that falls
out: an OOXML attribute takes a *value-typed* string only through a converter
that can fail closed (a closed lookup or a normalizer returning `undefined`);
escaping is for free-text attributes like `w:ascii` where any value is legal.

Two follow-ups from the next review round sharpen this:

- A lookup written as an object literal is **not** closed — `align` of
  `toString` / `constructor` resolves through `Object.prototype`, survives the
  `?? 'left'` fallback and gets stringified into the attribute. Use a `Map`.
- The converse also held: the API-side alignment allowlist added alongside it
  never ran on header/footer blocks or on the slides arm of the same endpoint,
  so it advertised a guarantee it did not have. It was dropped — the sinks are
  where the guarantee lives — and the writer was made to normalize instead of
  trusting a partial style (`style: {}` used to persist the literal string
  `"undefined"` and read back as `NaN` geometry).

The round after that reversed the reversal, and the reason is the useful part:
the allowlist was not wrong, its *coverage* was. Restoring it while making
`assertValidBlock` the single walker every region goes through — body blocks,
header blocks, footer blocks and table-cell blocks alike — costs one call site
and makes the advertised guarantee true. The lesson is not "validate at the
sink instead of the API" but "a validator that walks only one of the writer's
inputs is worse than none, because it reads as coverage."

## Duplicated codecs have to be hardened in pairs

`serializeBlockStyle`/`parseBlockStyle` exist twice — in
`packages/backend/src/yorkie/docs-tree.ts` and in
`packages/frontend/src/app/docs/yorkie-doc-store.ts` — and they encode the
*same* Yorkie Tree attributes. Hardening only the backend copy left the editor
still reading a poisoned document as `NaN` and still able to write the poison
itself. Same for `marginFromEdge`, which sat two functions below the fix and
kept writing `String(undefined)`.

Takeaway: when a fix lands in a serializer, grep the attribute names — not the
function name — for the other end of the wire.

The round after *that* took the takeaway one step further: hardening the copies
in pairs is a discipline nobody can hold across a repo, so the codec stopped
being duplicated. `serializeBlockStyleAttrs` / `parseBlockStyleAttrs` /
`serializeMarginFromEdgeAttrs` / `parseMarginFromEdgeAttr` now live in
`@wafflebase/docs` (`model/crdt-attrs.ts`) and both writers import them. The
module is pure data-model code with no DOM or Yorkie dependency, which is what
lets the NestJS backend and the browser store share it — the "cannot import
React/browser code from a NestJS process" reason the duplication existed for
never applied to the attribute math itself.

Making the reader normalize (drop an alignment outside the allowlist, drop a
non-finite number) also turned out to be what keeps the API's stricter `PUT`
validation safe: the write side rejects exactly the values the read side
refuses to hand back, so `GET` → edit → `PUT` of a legacy document cannot 400
on a value the caller never touched. A validator stricter than its own reader
is a round-trip break waiting to happen.
