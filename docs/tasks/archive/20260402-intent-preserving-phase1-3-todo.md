# Intent-Preserving Edits — Phase 1-3 (Completed)

**Status:** ✅ All phases shipped in PR #103

**Design doc:** `docs/design/docs-intent-preserving-edits.md`

## Phase 1: Character-Level Text Editing ✅

- [x] Create `block-helpers.ts` with resolveOffset, resolveDeleteRange
- [x] Add applyInsertText, applyDeleteText, normalizeInlines
- [x] Add insertText/deleteText to DocStore interface and MemDocStore
- [x] Implement insertText/deleteText in YorkieDocStore (character-level editByPath)
- [x] Wire Doc.insertText/deleteText to store methods

## Phase 2: Inline Styling ✅

- [x] Add resolveStyleRange and applyInlineStyle helpers
- [x] Add applyStyle to DocStore interface and MemDocStore
- [x] Implement applyStyle in YorkieDocStore (block replacement — styleByPath is element-level only)
- [x] Wire Doc.applyInlineStyle to store.applyStyle for single-block case

## Phase 3: Structural Editing ✅

- [x] Add applySplitBlock and applyMergeBlocks helpers
- [x] Add splitBlock/mergeBlock to DocStore interface and MemDocStore
- [x] Implement splitBlock/mergeBlock in YorkieDocStore (block replacement)
- [x] Wire Doc.splitBlock/mergeBlocks to store methods

## Post-Ship Fixes

- [x] Fix Yorkie Tree path format (3 levels, not 4)
- [x] Fix cache strategy (in-place update instead of invalidation)
- [x] Fix applyStyle to use block replacement (styleByPath limitation)
- [x] Upgrade @yorkie-js/sdk to 0.7.3
- [x] Switch deleteText to character-level with empty inline cleanup
- [x] Address CodeRabbit review feedback (6 items)
