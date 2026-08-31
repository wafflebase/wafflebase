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
- [x] Sweep the `false` that exception 1 keeps once its named-style layer stops
      supplying the key: `Doc.setBlockType` (the block it just retyped), the
      four named-style redefinition entry points via `afterNamedStyleChange`,
      and both internal-clipboard paste branches
      (`dropStaleStyleOff` / `dropStaleStyleOffAll`).
- [x] Fold `Doc.mergeCells`' private inline-merge copy into `normalizeInlines`,
      which is the one rule that knows structural inlines never merge.

## Follow-ups

Deliberately deferred rather than forgotten. Each is a consequence of the
same missing seam, so they are cheapest done together.

- [x] **`DocStore.batch()` seam.** Every sweep is a second store write, and
      `YorkieDocStore.snapshot()` is a no-op (Yorkie takes undo units from
      `doc.update()`), so a redefinition that strands a flag costs two Cmd+Z.
      The slides store already has the seam
      (`docs/design/slides/slides-native-undo.md`).
      **Shipped as #983** in the v0.6.7 window, which also folded named-style
      updates into one undo unit. The two sweeps below are what it unblocks —
      #983 states explicitly that it does not carry them, since each needs its
      own tests. This task stays active for them.
- [ ] **Sweep on block merge**, behind that seam. Backspace at the start of a
      Heading 6 strands the flag in a paragraph; the sweep is one line, but
      unbatched it doubles the undo units on the hottest editing path, so it
      is off until batching lands. Pinned by the `mergeBlocks` test.
- [ ] **Sweep on block split.** `applySplitBlock` copies the split-point style
      onto the empty side, so Enter at the end of a Heading 6 carries
      `italic: false` into the new paragraph's zero-length run — which
      `collectStaleStyleOff` skips, since a style patch over an empty range
      writes nothing. Needs the caret/pending-style path, not a range patch.
- [ ] **Two more copies of the adjacent-inline merge rule.**
      `clipboard.ts:mergeInlines` (no structural guard; reachable only from
      the HTML/markdown parsers, which never emit `style.image`) and
      `TextEditor.normalizeInlineList` (its own `inlineStylesMatch` compares a
      key subset, so it can disagree with `inlineStylesEqual` about a cleared
      key). Both should reduce to `normalizeInlines`.

## Non-goals

- Merging adjacent Yorkie Tree inline nodes back together. The CRDT keeps the
  structural split from the first (correct) style write; this task removes the
  dead flag and restores the model-level merge that `normalizeInlines` does.
- Changing how the toggles *decide* add-vs-remove (issue #715's mechanism).
- Any non-boolean style key.
