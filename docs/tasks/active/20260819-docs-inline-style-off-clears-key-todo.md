# Docs: turning an inline style off must clear the key, not store `false` (#749)

## Problem

Toggling a boolean inline style on and then off over the same selection leaves
the run permanently split, carrying an explicit `italic: false` (or
`bold: false` / `underline: false`) where the key was previously absent.

Two mechanisms compound:

1. **The write bakes a `false`.** Every toggle caller computes
   `{ italic: !isStyleOn(...) }` and hands the `false` straight through
   `Doc.applyInlineStyle` → `store.applyStyle` → `applyInlineStyle`
   (`packages/docs/src/store/block-helpers.ts:310`), which merges it into the
   run style verbatim.
2. **`false` never re-merges.** `normalizeInlines` merges neighbours only when
   `inlineStylesEqual` agrees, and that comparison is strict identity
   (`packages/docs/src/model/types.ts:404`), so `false === undefined` is
   `false` and a run carrying a dead flag can never rejoin an identical
   neighbour that simply lacks the key.

The consequence beyond tidiness: style resolution layers named-style defaults
*underneath* the explicit run style (`{ ...defaults, ...inline.style }`), so a
run carrying `italic: false` will not follow a named style later redefined to
be italic. That is exactly the lazy-cascade hazard `getSelectionStyleImpl`
already documents (`packages/docs/src/view/editor.ts:990-996`); the off-toggle
bakes such a value in by a different route.

## Approach

Clear the key instead of writing `false`, at the one layer every toggle caller
already funnels through — `Doc.applyInlineStyle` /
`Doc.applyInlineStyleToCells` (`packages/docs/src/model/document.ts`). Fixing
it there covers the keyboard toggles (`TextEditor.toggleStyle`), both docs
toolbars, the slides text-box editor, and the pending-style flush, without
touching four call sites that each recompute the same boolean.

`undefined` is already the established "strip this key" convention: it is what
`CLEAR_INLINE_STYLE` passes, and what `YorkieDocStore.removedInlineStyleAttrs`
turns into a `removeStyleByPath` so the clear lands in the CRDT.

**One case genuinely needs an explicit `false`:** when the block's named style
supplies the style (Heading 6 is italic), clearing the key would leave the run
italic and the toggle-off would be a visual no-op. So the demotion is
conditional — `false` survives only where the block's resolved named-style
inline defaults set that key truthy, which is precisely where `false` carries
information.

## Scope

- [x] `Doc.applyInlineStyle` / `Doc.applyInlineStyleToCells`: per block slice,
      demote a boolean inline key explicitly set to `false` to `undefined`
      unless the block's named-style defaults set it truthy.
- [x] `applyInlineStyle` (block-helpers): drop keys whose merged value is
      `undefined` from the styled run, so the stored style has the key
      *removed* rather than present-with-`undefined`.
- [x] Tests: on/off round-trip restores a single run with no dead flag;
      the named-style case still stores `false`; cell rectangles too.

## Non-goals

- Merging adjacent Yorkie Tree inline nodes back together. The CRDT keeps the
  structural split from the first (correct) style write; this task removes the
  dead flag and restores the model-level merge that `normalizeInlines` does.
- Changing how the toggles *decide* add-vs-remove (issue #715's mechanism).
- Any non-boolean style key.
