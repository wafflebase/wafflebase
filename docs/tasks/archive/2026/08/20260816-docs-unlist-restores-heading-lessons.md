# Lessons — Docs: un-listing a heading restores the heading (#783)

## What we learned

- Every `headingLevel` reader in the repo is already guarded by
  `block.type === 'heading'` (docx exporter, pdf outline, markdown
  serializer, `blockStyleId`, the toolbar's `getBlockLabel` /
  `blockTypeToStyleId`). That is what made "let a `list-item` carry its
  heading level" a safe representation instead of a new model field: nothing
  reads the level while the block is a list item.
- `setBlockType` is implemented three times — `MemDocStore`,
  `YorkieDocStore` (tree attrs *and* an in-memory block cache that must be
  kept in sync by hand), and `createBlock`'s defaults. A rule about
  type-specific attributes has to be applied in each.
- `toggleList` likewise exists three times (`editor.ts`, `text-editor.ts`,
  `text-box-editor.ts`); a shared helper in the model layer is the only thing
  keeping them from drifting. Only the `editor.ts` one is reachable from
  `EditorAPI` — the `text-editor.ts` one is private behind
  Cmd/Ctrl+Shift+7 / +8, so it needs a *keydown-dispatching* test
  (`pressListShortcut` in `test/view/list-heading-roundtrip.test.ts`) to be
  covered at all.
- Because the level now lives on a block whose text can be replaced, the
  memory needs provenance rules, not just a restore path: a split must not
  copy it onto the new bullet, and a **merge** into an emptied bulleted
  heading must drop it (`mergeDropsHeadingMemory`). Review round 1 caught the
  merge case — Backspace at the start of the following bullet moved body text
  into the block holding the memory, so un-listing promoted text that was
  never a heading.
- "Every reader gates on `type === 'heading'`" is an invariant worth
  *asserting*, not just documenting: the export / serialize / toolbar readers
  now have tests that feed them a `list-item` carrying a level.
