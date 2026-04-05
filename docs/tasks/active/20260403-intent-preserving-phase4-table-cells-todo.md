# Intent-Preserving Edits — Phase 4: Table Cell Internal Edits

**Goal:** Extend Phase 1-3's character-level editing to table cell blocks via
deeper Yorkie Tree paths.

**Design doc:** `docs/design/docs/docs-intent-preserving-edits.md`

**Depends on:** Phase 1-3 (completed)

---

## Overview

Table cells contain blocks (`cell → block → inline → text`). Currently, cell
editing uses the old `updateBlock`/`updateTableCell` path. This phase routes
cell-internal text/style/structure edits through the new fine-grained store
methods with extended Yorkie Tree paths:

```
Top-level:  [blockIdx, inlineIdx, charOffset]
Table cell: [tableIdx, rowIdx, colIdx, cellBlockIdx, inlineIdx, charOffset]
```

## Tasks

### Task 1: Add table cell variants to DocStore and MemDocStore

- [ ] Add `insertTextInCell`, `deleteTextInCell`, `applyStyleInCell` to DocStore interface
- [ ] Implement in MemDocStore using existing block-helpers
- [ ] Add tests to `memory.test.ts`

### Task 2: Implement table cell variants in YorkieDocStore

- [ ] Implement `insertTextInCell` with character-level editByPath at deep path
- [ ] Implement `deleteTextInCell` with character-level editByPath + empty inline cleanup
- [ ] Implement `applyStyleInCell` with block replacement (same as top-level applyStyle)
- [ ] Verify path format: `[tIdx, rowIdx, colIdx, cellBlockIdx, inlineIdx, charOffset]`

### Task 3: Wire Doc methods to cell variants via blockParentMap

- [ ] Update `Doc.insertText` cell path to use `store.insertTextInCell`
- [ ] Update `Doc.deleteText` cell path to use `store.deleteTextInCell`
- [ ] Update `Doc.applyInlineStyle` cell path to use `store.applyStyleInCell`
- [ ] Add `getCellBlockIndex` helper to Doc

### Task 4: UI testing

- [ ] Table cell typing preserves concurrent edits (two users in same cell)
- [ ] Table cell Backspace/Delete works correctly
- [ ] Bold/Italic in table cells persists after refresh
- [ ] Existing table structural ops (row/column insert/delete) unaffected
