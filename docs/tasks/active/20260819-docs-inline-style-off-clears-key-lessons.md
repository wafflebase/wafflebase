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
