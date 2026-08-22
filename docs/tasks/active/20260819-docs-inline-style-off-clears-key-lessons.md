# Lessons — docs inline-style off clears the key (#749)

## What the codebase already knew

`CLEAR_INLINE_STYLE` (`model/types.ts:241`) had already settled the convention:
an inline-style patch key set to `undefined` means *remove this key*, and the
Yorkie store honours it (`removedInlineStyleAttrs` → `removeStyleByPath`,
because `styleByPath` can only merge, never delete). The boolean toggles were
the one write path that had not adopted it.

## The trap: `false` is not always dead

The obvious fix — never store `false` — is wrong. Style resolution paints
named-style defaults *under* the run style, and Heading 6's built-in style is
italic. In such a block an explicit `false` is the only representation of "the
user turned this off", so the demotion has to be conditional on the block's
resolved defaults. `caret-style.ts` had already learned the same lesson from
the other side (issue #715: Cmd+I inside a Heading 6 computed `!false` and was
a permanent no-op).

## Why `Doc`, not the callers

Four call sites compute the toggle boolean (keyboard `toggleStyle`, the shared
`TextFormatGroup`, the header/footer slim toolbar, the slides text box), but
all of them funnel into `Doc.applyInlineStyle` / `applyInlineStyleToCells`,
which is also where a *block* — and therefore its named-style defaults — is in
scope. One place, no drift.

## Review round 1: count the default layers, not the layer you thought of

Named styles were not the only layer painted *under* the run style —
`renderRun` underlines an `href` run whose `underline` key is absent, so on a
hyperlink the absent key means *underlined* and clearing it made underline-off
a permanent no-op. Same shape as the Heading 6 exception, reached from a
different direction; the guard now enumerates both. The transferable rule: when
a value's meaning depends on a default, find *every* place that supplies one
before deciding the value can be dropped.

## Review round 1: an exception conditional on the block can go stale

The `italic: false` a Heading 6 run legitimately keeps is a dead flag the
moment the block becomes a paragraph — the very hazard the change removes, just
re-entered through `setBlockType`. A conditional exception needs a sweep
wherever its condition can change (`dropStaleStyleOff`). The link exception
needs none: its condition is the run's own `href`.

## Review round 1: what "makes two runs equal" also merges what must not merge

Clearing a key is exactly what can make two adjacent runs compare equal, and
`normalizeInlines` merged any equal pair — including two identical images,
which the paste path had already learned to keep apart (`isStructuralInline`).
A change to *equality* is a change to every merge that reads it.
