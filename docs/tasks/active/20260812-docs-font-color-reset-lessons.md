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
single-node removal, so `removeNodeStyle` drops to the index API and removes
over `[pathToIndex(node), +1)` — the node's opening tag alone. The helper is
deliberately generic, not cell-specific: `setBlockType`'s stale-attribute
removal needs exactly the same scoping on a table block.

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

## Repairing "the empty shape" means every field of it, not the one that crashed

The slides PUT walk grew a repair for an absent `Block.inlines` (the docs
layout engine dereferences it unconditionally) and, one round later, for an
absent `Inline.style`. Both were found the same way: someone traced *one*
consumer. Review then pointed out the two siblings that crash exactly the same
consumers and were still accepted — `TextBody.blocks` (`body.blocks.map` in the
slides text renderer, `for (const block of body.blocks)` in the PDF exporter,
`data.blocks.length` in the animation paragraph counter) and `Block.style`
(`ALGN.get(block.style.alignment)` in the PPTX exporter).

The asymmetry is the tell. Once a validator decides that *absent* means
"fill in the empty shape" rather than 400 (which is the right call on a
`replace` endpoint whose readers hand back legacy shapes), that decision is
about the whole model shape, not about the one field whose TypeError got
reported. Enumerate the required fields of the type — `TextBody.blocks`,
`Block.inlines`, `Block.style`, `Inline.style` are all non-optional in
`packages/docs/src/model/types.ts` — and repair each one, rather than adding
them one blocking review round at a time.

Corollary from the same round: `typeof x === 'object'` is not an object check.
`typeof [] === 'object'`, so a block style arriving as an array passed a guard
whose whole job was to keep non-records out of a field every reader spreads.

## A `Record` lookup keyed by untrusted data is not a closed set

The OOXML hardening pass converted every attribute lookup to a `Map` — except
`ROLE_TO_SCHEME[c.role]` in `export/pptx/color.ts`, whose doc comment then
claimed the emitted attribute was "either `[0-9A-F]{6}`, a closed
`ROLE_TO_SCHEME` value, or a finite number". It was not: `ThemeColor.role` is a
closed union to TypeScript but holds whatever the importer or the content PUT
API stored, and `role: 'constructor'` stringified the entire `Object`
constructor into `<a:schemeClr val="…">`. An out-of-set role emitted
`val="undefined"`.

Takeaway: a `Record` with an untrusted key reaches `Object.prototype`. When a
hardening pass converts lookups to `Map`, the one that got skipped is the one
whose comment now lies about it — grep the pass for the pattern, don't trust
the prose.

## A repair pass has to cover the container, not just its contents

The round above filled in every required field *inside* a slide text body —
`blocks`, `inlines`, a block's `style`, an inline's `style`. The next review
round found the walk still returned early one level up: `assertValidElementData`
opened with `if (!data || typeof data !== 'object') return;`, and a text
element's `data` **is** its `TextBody`. So an element with no `data` at all
skipped the whole repair pass and was stored in precisely the shape the pass
exists to prevent — `isElementEmpty` reads `el.data.blocks` unconditionally,
and `migrateElement` repairs nothing but shapes. The same early `continue`
skipped a table cell with no `body`, which the table renderer reads as
`cell.body.blocks`.

Takeaway: when a validator's guard clause is "nothing here, nothing to check",
ask whether *the missing thing itself* is required by the model. A walk that
repairs a container's contents but tolerates the container's absence has a
hole exactly the size of the type it is protecting.

Second-order, from the same finding: a repair can only be applied to a value
the writer will actually persist. `typeof [] === 'object'`, so `data: []`
would have taken the repair as an array expando (`[].blocks = []`) that JSON
serialization silently drops — the endpoint would have echoed a "repaired"
body and stored the crashing one. Where the empty shape cannot be written
back, reject instead of repairing.

## Check a lens finding against the head commit, not the diff it read

One of the two blocking correctness findings this round — "a slide block with
no `style` is accepted, but the PPTX exporter dereferences `block.style`" —
quoted `docs-content.controller.ts:694` as
`if (block.style !== undefined && block.style !== null)`. That is verbatim the
*previous* commit (`d14be04d5`); the head commit (`eab6825ed`) already replaced
it with the repair at line 706. The finding was true when the code it quoted
was written and stale by the time it was reported.

Takeaway: before implementing a review finding, open the cited `file:line` on
the head commit and confirm the quoted text is still there. `git show
<prev>:<file>` will usually tell you which revision a stale quote came from,
which is stronger counter-evidence than "I could not reproduce it".

## An authz check written per handler is an absence waiting to happen

The critical finding this round was that `PUT /api/v1/…/content` never checked
the API key `write` scope, so a key minted with `scopes: ['read']` could
destructively replace the content of every doc, deck and note in a workspace.
The reason it survived is the shape of the surrounding code: two of the nine
mutating v1 handlers *did* carry the check, hand-written inline, each with a
comment explaining exactly why it was needed. Anyone grepping `scopes` found
hits under `api/v1/` and moved on. Seven routes were open.

Takeaway: a cross-cutting authorization rule belongs in one enforcement point
that cannot be forgotten — here a guard keyed on the HTTP method, mounted on
every v1 controller — not in the handlers written by whoever remembered it.
Two correct copies are worse than zero: zero looks like a gap, two look like
coverage. When you close a finding of this kind, delete the copies too, or
"one mechanism" quietly becomes "one mechanism plus two things that can
drift". Then enumerate the call sites in a test — the guard spec here asserts
the guard is mounted on all six v1 controllers, so a seventh that forgets it
fails CI instead of shipping.

## "Repairs the contents" is not "repairs the container" — one level up again

The previous round's lesson was that a walk repairing a container's contents
while tolerating the container's absence has a hole the size of the type it
protects. This round found the same hole one level up *again*, which means the
lesson needed a stronger form. The fix repaired `data` for `type === 'text'`
and `cell.body` for a table cell, and left every other element type, plus
`data.children`, `data.rows`, `data.columnWidths`, `row.cells` and
`cell.style` — all read without a guard, and several of them read *earlier* in
the same render pass than the field that was repaired.

Takeaway: do not derive the repair list from the failure you were shown.
Derive it from the consumers — grep the renderers, the layout engine and the
exporters for every unguarded dereference of the value, and repair that whole
set. A field repaired at the end of a pass is worthless if the pass throws on
a sibling field at the start of it. And state the resulting coverage in the
design doc as an enumerated table with its limits, not as prose: the prose
version here ("no deck is ever persisted in a shape that would be a TypeError
for its viewers") was three findings' worth of overclaim.

## Scope a defect-class sweep by the class, not by the directory

This file already said, of the `ROLE_TO_SCHEME[c.role]` prototype-chain fix,
"grep the pass for the pattern, don't trust the prose". The sweep still missed
`LAYOUT_ID_MIGRATIONS[slide?.layoutId]` in `packages/slides/src/model/migrate.ts`,
because it was scoped to the export path where the first instance was found
and this lookup lives in the model.

Takeaway: scope the sweep by the class (an untrusted key into a plain-object
map), not by the directory. `migrate.ts` is where such a lookup does the most
damage: it runs on every read of every stored deck, so the corrupted value
enters the live model rather than one output file. The remaining instances in
this repo are on the PPTX/DOCX *import* path (`EXT_TO_MIME`, `PRESET_COLORS`,
`TYPE_TO_BUILT_IN`, `PH_TYPE_ALIAS`, `HIGHLIGHT_COLORS`, …); they predate this
branch and are left for a dedicated pass rather than widened into it.
