# Lessons — Docs: Highlight "None" must clear `backgroundColor`

Issue: #793

## What the bug really was

Not a rendering bug: the highlight *stops painting* because `""` is falsy, so the
defect is invisible in the editor and only shows in the stored document. Two
values meant "no highlight" (`undefined` and `""`) and only one of them compared
equal to "unset", so `normalizeInlines` could never merge the run back.

## Why the fix went in the docs package, not the toolbar

The issue points at `onReset={() => handleColor("")}`, but four docs picker call
sites pass `""` and each one is a place the bug can come back. The write path is
the single point where a stored run is produced, so defining `""` as a clear
there fixes every surface at once — and, because the Yorkie path then routes the
key through `removeStyleByPath`, it also removes the attribute from documents
that already stored `""` the next time the user hits **None**.

## Convention worth remembering

"Clear an inline style key" in `@wafflebase/docs` means *the key present with the
value `undefined`* — not absent, and not falsy. Absent means "don't touch this
key"; `undefined` is what `removedInlineStyleAttrs` looks for to emit a Yorkie
`removeStyleByPath`. Anything that assigns a falsy placeholder (`""`, and per
#749 `false`) leaves a dead value behind.
