---
title: Fix image duplication when splitting blocks past last image inline
status: in-progress
---

## Problem

When the cursor sits at the end of an inline image that is the **last
inline** of its block, pressing Enter creates a new block whose first
inline carries the image style with empty text. The Canvas layout
emits an image segment for any inline with `style.image` regardless of
text length, so the user sees the image rendered twice.

Reproduced in the saved Yorkie tree of
`/shared/d66c4ae3-6513-486e-8681-1c3f7612ba2f`:

```xml
<block ... id="block-1777815917096-0">
  <inline image.src="…d0361a60-….png" image.width="454" image.height="390">￼</inline>
</block>
<block ... id="block-1777815961131-5">
  <inline image.src="…d0361a60-….png" image.width="454" image.height="390"></inline>
</block>
```

The cache path (`applySplitBlock` + `getSplitPointStyle`) already strips
the image style for the empty side, but the Yorkie tree path in
`packages/frontend/src/app/docs/yorkie-doc-store.ts` at `splitBlock`
pushes `{ text: '', style: imageStyle }` to `afterInlines` because of
the `i === inlineChildren.length - 1` clause and forwards that to
`buildInlineNode`, which writes the `image.*` attributes to the tree.

`resolveBlockNodeOffsetForSplit` correctly bails out (no next inline to
redirect to) — that behaviour is asserted by
`block-helpers.test.ts:304`. The bug is downstream of that decision.

## Plan

- [x] Reproduce with a failing test in
  `packages/frontend/tests/app/docs/yorkie-doc-store.test.ts`
  (`splitBlock` describe block).
- [x] Strip the `image` style when pushing the trailing empty inline
  in `yorkie-doc-store.ts splitBlock` (mirror `getSplitPointStyle`).
- [x] Add a defensive read-time filter so existing Yorkie trees with
  empty image inlines render correctly without manual cleanup.
- [x] Run `pnpm verify:fast` and confirm pass.

## Follow-up: local Backspace did not match remote

After the read-time filter shipped, Backspacing past the only image
inline of a block left the local cache holding `{ text: '', style:
{ image } }`. Other clients reading from the tree saw the inline
filtered out, so remote views looked correct while the local view kept
showing the ghost image.

Root cause: `normalizeInlines` (block-helpers.ts) preserved the
original first-inline style when every inline collapsed to empty,
which retained `style.image` for image-only blocks.

- [x] Add failing test
  `applyDeleteText — image inline / drops image style from fallback…`
  in `packages/docs/test/store/block-helpers.test.ts`.
- [x] Strip `image` from the all-empty fallback in `normalizeInlines`.
- [x] Re-run `pnpm verify:fast` (738 tests pass).

## Out of Scope

- Cache path (`applySplitBlock`): already correct, has tests.
- One-time CRDT migration: the read-time filter is enough; the stale
  inline node remains in the CRDT but never renders. The user can
  delete the empty paragraph manually if desired.
