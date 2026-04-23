# Block Attribute Intent-Preserving Edits

Extend intent-preserving editing to block/cell attribute changes.
Currently `setBlockType`, `applyBlockStyle`, `applyCellStyle`, and
`insertImageInline` use full block replacement (LWW). Migrate to
`styleByPath`/`editByPath` for CRDT-safe concurrent editing.

## Steps

- [ ] Step 1: Add `setBlockType` / `applyBlockStyle` to DocStore → `styleByPath`
- [ ] Step 2: Add `applyCellStyle` to DocStore → `styleByPath`
- [ ] Step 3: Add `insertImageInline` to DocStore → `editByPath`
- [ ] Step 4: Update design doc, verify, archive
