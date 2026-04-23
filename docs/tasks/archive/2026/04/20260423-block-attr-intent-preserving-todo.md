# Block Attribute Intent-Preserving Edits

Extend intent-preserving editing to block/cell attribute changes.
Currently `setBlockType`, `applyBlockStyle`, `applyCellStyle`, and
`insertImageInline` use full block replacement (LWW). Migrate to
`styleByPath`/`editByPath` for CRDT-safe concurrent editing.

## Steps

- [x] Step 1: Add `setBlockType` / `applyBlockStyle` to DocStore → `styleByPath`
- [x] Step 2: Add `applyCellStyle` to DocStore → `styleByPath`
- [x] Step 3: Add `insertImageInline` to DocStore → `editByPath`
- [x] Step 4: Update design doc, verify, archive
