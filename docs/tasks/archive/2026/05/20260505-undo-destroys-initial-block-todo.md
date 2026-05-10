# Undo destroys initial block

**Created**: 2026-05-05

## Problem

Reproduction: open a freshly-created docs document, type "asdf",
press Enter, type "asdf", press Enter, type "asdf", then press
Cmd+Z enough times. The next keystroke crashes with:

```
document.ts:134 Uncaught Error: Block not found: block-1777984770574-0
    at Doc.getBlock (document.ts:134:11)
    at HTMLTextAreaElement.handleInput (text-editor.ts:331:35)
```

The block id has counter `0` — it is the very first `generateBlockId()`
of the session, i.e. the document's initial block.

## Root Cause

`docs-view.tsx:ensureTree()` was responsible for installing the
`yorkie.Tree` CRDT and the initial paragraph block. It did so via
`doc.update(...)` after `client.attach()`. Because that update ran
*after* attach, it landed on the document's undo stack.

`YorkieDocStore.setDocument()` records `undoFloor =
getUndoStackForTest().length` to prevent users from undoing past the
initial document load. But `setDocument()` is only called from
`editor.ts:388` when `getDocument().blocks.length === 0`. Once
`ensureTree` had populated the Tree, the body already had one block,
so `setDocument` was skipped and `undoFloor` stayed at 0.

A long enough Cmd+Z sequence then unwound `ensureTree`'s update,
removing the initial block from the Tree while the cursor was still
holding its id. The next `handleInput` looked the block up via
`getBlock` and threw.

## Fix

Two complementary changes:

1. **Move Tree CRDT creation into `initialRoot`.**
   `docs-detail.tsx` and `shared-document.tsx` now pass
   `initialDocsRoot()` (returning `{ content: new Tree({...}) }`) to
   `DocumentProvider`. yorkie-js-sdk PR #1238 (in 0.7.8) calls
   `doc.clearHistory()` immediately after applying `initialRoot`, so
   the setup is never on the undo stack. New docs no longer need
   `ensureTree`'s fallback path.

2. **Make legacy fallback safe and YorkieDocStore robust.**
   - `ensureTree` calls `doc.clearHistory()` after its fallback
     `doc.update`, mirroring what the SDK does for `initialRoot`.
   - `YorkieDocStore` constructor records the current undo-stack
     length as `undoFloor`. Anything already in the stack at
     construction time (from `initialRoot`, `ensureTree`, or any
     future setup) is not undoable — defense in depth.

## Tasks

- [x] Reproduce the bug (manual + regression test)
- [x] Move initial Tree to `initialRoot` in docs-detail.tsx and shared-document.tsx
- [x] Add `clearHistory()` to `ensureTree` fallback
- [x] Initialize `undoFloor` in YorkieDocStore constructor
- [x] Add regression test in yorkie-doc-store.test.ts
- [x] `pnpm verify:fast` — all 741 tests pass
- [x] Manually verify in browser: new doc → "asdf"<Enter>"asdf"<Enter>"asdf"<Cmd+Z×N>typing → no crash
- [x] Commit, push, open PR — shipped as PR #189 (`cddefc3a`)

## Notes

- The earlier `validateCursorPosition()` patch on the
  `fix-undo-cursor-validation` branch was a band-aid that could
  not reach this scenario — when the Tree itself is unwound,
  `doc.document.blocks` is empty and the helper has no first block
  to fall back to. That branch is being abandoned.
- The 0.7.8 SDK upgrade in #187 is unrelated to this bug but does
  ship the `clearHistory()` API and the post-attach call that
  this fix relies on.
