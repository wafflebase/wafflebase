# Docs unlink doesn't remove hyperlink (Yorkie store)

## Problem

Clicking the unlink button in the docs editor does not remove the
hyperlink. The link reappears after re-reading from the Yorkie tree
(remote change / reload) and never disappears for other collaborators.

## Root cause

`editor.removeLink()` clears the link via
`doc.applyInlineStyle(range, { href: undefined })`. In the Yorkie store
(`packages/frontend/src/app/docs/yorkie-doc-store.ts`) this intent is
dropped at two layers:

1. `serializeInlineStyle` only emits defined keys
   (`if (style.href !== undefined) attrs.href = style.href`), so
   `{ href: undefined }` serializes to `{}`.
2. `applyStyle` writes styles with `tree.styleByPath(path, { ...existing, ...styleAttrs })`.
   `styleByPath` only *merges* attributes — it never removes one. So the
   old `href` attribute survives on the Tree node (the CRDT source of
   truth). The optimistic in-memory cache removes it, which is why the
   link looks gone until the next tree re-read.

Other code paths already handle attribute removal with
`tree.removeStyleByPath(...)` (see lines ~1026-1047, ~2086-2091), but
`applyStyle` never did.

## Fix

In `applyStyle`, detect inline-style keys explicitly set to `undefined`,
map them to their Yorkie attribute name(s), and call
`tree.removeStyleByPath(...)` for the styled inline range — in addition
to the existing `styleByPath` merge. General enough to cover any
undefined-clearing key, not just `href`.

## Checklist

- [x] Add `removedInlineStyleAttrs(style)` helper mapping undefined keys → attr names
- [x] Call `removeStyleByPath` per styled inline in `applyStyle`
- [x] Regression test: apply href then clear it, verify removed from the Tree (fresh store re-read)
- [x] `pnpm verify:fast` green
- [x] Self code review over branch diff
- [x] Open PR

## Review

Root cause confirmed and fixed in
`packages/frontend/src/app/docs/yorkie-doc-store.ts`:

- `applyStyle` now computes `removedInlineStyleAttrs(style)` and calls
  `tree.removeStyleByPath([...blockPath, i], [...blockPath, i + 1], removeAttrs)`
  per styled inline, alongside the existing `styleByPath` merge. The
  inline path range matches the established single-node removal pattern
  used by `setBlockType` / `updateTableCellSpan`.
- The fix is general: any `InlineStyle` key explicitly set to `undefined`
  is removed, not just `href`.

Verification:
- New tests in `tests/app/docs/yorkie-doc-store.test.ts`
  ("applyStyle attribute removal") assert href is gone after a fresh
  re-read from the CRDT tree, and that unrelated styles (bold) survive.
- Confirmed the tests FAIL on the unfixed source (git stash) and PASS
  with the fix.
- `pnpm verify:fast` green (lint + all unit tests, exit 0).

No design-doc change: this is a bug fix, not an architecture change; the
gotcha is documented inline and in the lessons file.
