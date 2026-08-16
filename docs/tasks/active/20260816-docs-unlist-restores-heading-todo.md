# Docs: un-listing a heading restores the heading (#783)

## Problem

Bulleting a `Heading 2` and then un-bulleting it leaves body text. The
heading level is destroyed by an action that looks reversible.

Two independent causes:

1. `MemDocStore.setBlockType` (`packages/docs/src/store/memory.ts`) deletes
   `headingLevel` unconditionally, so the level is gone the moment the list
   is applied. `YorkieDocStore.setBlockType`
   (`packages/frontend/src/app/docs/yorkie-doc-store.ts`) does the same in
   both the tree attrs (`toRemove`) and the block cache.
2. `toggleList` hardcodes `'paragraph'` on the way out (three call sites in
   the docs package), so there is nothing to restore from.

## Approach

Model the "bulleted heading" the way Google Docs does — the bullet is applied
*to* the heading — with the smallest possible model change: a `list-item`
block **keeps** its `headingLevel`. No new field, no new CRDT attribute name
(`headingLevel` already round-trips through the Yorkie tree attrs), and every
existing `headingLevel` reader is already guarded by `type === 'heading'`
(docx/pdf/markdown export, `blockStyleId`, toolbar labels), so a retained
level is inert until the list is removed.

`toggleList` then restores `heading` + level when the level is present, else
`paragraph`, via one shared helper so the three editors cannot drift.

Explicit "Normal text" commands (style dropdown, ⌥0, heading toggle) keep
clearing the level — only the list round trip restores.

## Steps

- [x] `model/types.ts`: document the retention on `Block.headingLevel`, add
      `unlistedBlockType(block)` helper.
- [x] `store/memory.ts`: preserve `headingLevel` when the new type is
      `list-item`.
- [x] `yorkie-doc-store.ts`: same, in the `toRemove` attrs and the cache.
- [x] `view/editor.ts`, `view/text-editor.ts`, `view/text-box-editor.ts`:
      `toggleList` exits through `unlistedBlockType`.
- [x] Unit tests: store-level round trip (the issue's repro), editor-level
      round trip, paragraph unaffected, explicit Normal text still clears.

## Non-goals

- How a list item is *styled* while it is a list item (`blockStyleId` maps
  `list-item` → `normal`; the issue calls this working as intended).
- Splitting a bulleted heading (Enter) — the new item stays a plain list
  item, as today.
- DOCX/PPTX export of a bulleted heading's `pStyle`.
