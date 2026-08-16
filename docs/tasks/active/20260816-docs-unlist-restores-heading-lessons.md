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
  keeping them from drifting.
